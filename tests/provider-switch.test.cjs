"use strict";
// Switching the model provider in the middle of a project: the stored history is provider-neutral (text, images, neutral tool
// calls and tool results). A provider's own "native" turn is echoed only back to the SAME provider; every other provider gets the
// turn rebuilt from the neutral calls, with tool results still paired to their calls.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { adapter } = require("../src/provider-adapters.cjs");
const { toolGeneration } = require("../src/tool-adapters.cjs");
const { Agent, tools } = require("../src/wp-agent.cjs");
const { WordPress } = require("../src/wordpress.cjs");

const PROVIDERS = [
  ["anthropic", "claude-sonnet-4-5"],
  ["openai", "gpt-5"],
  ["gemini", "gemini-2.5-pro"],
  ["moonshot", "kimi-k2"],
  ["qwen", "qwen-plus"],
];
const ad = (p) => adapter(p, p === "qwen" ? "singapore" : "");
const kindOf = (p) => ad(p).kind;
const calls1 = [{ id: "c1", name: "wp_get_capabilities", args: {} }];
const calls2 = [{ id: "c2", name: "wp_list_pages", args: { page: 1 } }];
// What each provider's own assistant turn looks like (with a marker that must never reach another provider).
const nativeOf = (kind, calls, text, marker) =>
  ({
    anthropic: [
      ...(text ? [{ type: "text", text }] : []),
      ...calls.map((c) => ({
        type: "tool_use",
        id: c.id,
        name: c.name,
        input: c.args,
        marker,
      })),
    ],
    openai: [
      ...(text ? [{ role: "assistant", content: text }] : []),
      ...calls.map((c) => ({
        type: "function_call",
        call_id: c.id,
        name: c.name,
        arguments: JSON.stringify(c.args),
        marker,
      })),
    ],
    gemini: {
      role: "model",
      parts: calls.map((c) => ({
        functionCall: { name: c.name, args: c.args },
        thoughtSignature: marker,
      })),
    },
    moonshot: {
      role: "assistant",
      content: text || null,
      reasoning_content: marker,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    },
    qwen: {
      role: "assistant",
      content: text || null,
      reasoning_content: marker,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    },
  })[kind];
const history = (fromKind, marker) => [
  { role: "system", content: "You are the ADActive agent." },
  {
    role: "user",
    content: "בנה לי עמוד בית",
    images: [{ mime: "image/png", data: "QUJDRA==" }],
  },
  {
    role: "assistant",
    content: "אני בודק את ההרשאות",
    calls: calls1,
    native: nativeOf(fromKind, calls1, "אני בודק את ההרשאות", marker),
    nativeKind: fromKind,
  },
  { role: "tool", call: calls1[0], result: { data: { edit_pages: true } } },
  {
    role: "assistant",
    content: "",
    calls: calls2,
    native: nativeOf(fromKind, calls2, "", marker),
    nativeKind: fromKind,
  },
  { role: "tool", call: calls2[0], result: { data: [] } },
  { role: "user", content: "המשך" },
];
// Every tool result must follow a call with the same id (or the same name for Gemini), in the provider's own wire format.
function assertPaired(kind, body) {
  if (kind === "anthropic") {
    const seen = new Set();
    for (const m of body.messages) {
      if (!Array.isArray(m.content)) continue;
      for (const b of m.content) {
        if (b.type === "tool_use") seen.add(b.id);
        if (b.type === "tool_result")
          assert.ok(
            seen.has(b.tool_use_id),
            `tool_result ${b.tool_use_id} has its tool_use`,
          );
      }
    }
    assert.deepEqual([...seen].sort(), ["c1", "c2"]);
  } else if (kind === "openai") {
    const seen = new Set();
    for (const i of body.input) {
      if (i.type === "function_call") seen.add(i.call_id);
      if (i.type === "function_call_output")
        assert.ok(
          seen.has(i.call_id),
          `output ${i.call_id} has its function_call`,
        );
    }
    assert.deepEqual([...seen].sort(), ["c1", "c2"]);
  } else if (kind === "gemini") {
    let last = null;
    const names = [];
    for (const m of body.contents) {
      for (const p of m.parts) {
        if (p.functionCall) ((last = p.functionCall.name), names.push(last));
        if (p.functionResponse)
          assert.equal(
            p.functionResponse.name,
            last,
            "functionResponse follows its functionCall",
          );
      }
    }
    assert.deepEqual(names, ["wp_get_capabilities", "wp_list_pages"]);
  } else {
    const ids = new Set();
    for (const m of body.messages) {
      for (const c of m.tool_calls || []) ids.add(c.id);
      if (m.role === "tool")
        assert.ok(
          ids.has(m.tool_call_id),
          `tool message ${m.tool_call_id} has its tool call`,
        );
    }
    assert.deepEqual([...ids].sort(), ["c1", "c2"]);
  }
}
for (const [from] of PROVIDERS)
  for (const [to, model] of PROVIDERS) {
    test(`history started with ${from} continues with ${to}: tool calls, results and images are converted, nothing foreign leaks`, () => {
      const a = ad(to);
      const marker = `FOREIGN_${from.toUpperCase()}_ONLY`;
      const spec = toolGeneration(
        a,
        model,
        history(kindOf(from), marker),
        tools.slice(0, 3),
      );
      const body = spec.body;
      const wire = JSON.stringify(body);
      assertPaired(a.kind, body);
      assert.ok(wire.includes("בנה לי עמוד בית"), "the user text is kept");
      assert.ok(
        wire.includes("wp_get_capabilities") && wire.includes("wp_list_pages"),
        "tool calls are kept",
      );
      assert.ok(wire.includes("edit_pages"), "tool results are kept");
      assert.ok(
        wire.includes("QUJDRA=="),
        "the image is converted for this provider",
      );
      if (a.kind === kindOf(from))
        assert.ok(
          wire.includes(marker),
          "the same provider gets its own native turn back unchanged",
        );
      else
        assert.ok(
          !wire.includes(marker),
          "another provider's native data is never sent",
        );
    });
  }
test("a turn without any native data (older history) is rebuilt for every provider", () => {
  for (const [to, model] of PROVIDERS) {
    const plain = history("anthropic", "X").map(
      ({ native: _n, nativeKind: _k, ...m }) => m,
    );
    const spec = toolGeneration(ad(to), model, plain, tools.slice(0, 3));
    assertPaired(ad(to).kind, spec.body);
  }
});
test("end to end: a run with provider A leaves a neutral history that provider B can continue", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString(),
  };
  const wp = new WordPress(dir, storage, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async () => ({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: 7, capabilities: { edit_pages: true } }),
    }),
  });
  await wp.connect("p", {
    site: "https://public.example",
    username: "u",
    password: "PUBLIC-DUMMY",
  });
  const agent = new Agent(wp, dir);
  let second;
  let n = 0;
  await agent.run("p", [{ role: "user", content: "בדוק הרשאות" }], {
    step: async (messages) => {
      if (n++ === 0)
        return {
          text: "בודק",
          calls: [{ id: "toolu_1", name: "wp_get_capabilities", args: {} }],
          native: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "wp_get_capabilities",
              input: {},
              marker: "ANTHROPIC_ONLY",
            },
          ],
          nativeKind: "anthropic",
        };
      second = messages;
      return { text: "סיימתי", calls: [] };
    },
  });
  const assistant = second.find(
    (m) => m.role === "assistant" && m.calls?.length,
  );
  assert.equal(
    assistant.nativeKind,
    "anthropic",
    "the run records which provider produced the native turn",
  );
  for (const [to, model] of PROVIDERS) {
    const body = toolGeneration(ad(to), model, second, tools.slice(0, 3)).body;
    const wire = JSON.stringify(body);
    if (ad(to).kind !== "anthropic")
      assert.ok(!wire.includes("ANTHROPIC_ONLY"), to);
    assert.ok(wire.includes("wp_get_capabilities"), to);
    assert.ok(wire.includes("toolu_1") || ad(to).kind === "gemini", to);
  }
});
