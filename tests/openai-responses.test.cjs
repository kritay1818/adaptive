"use strict";
// OpenAI Responses API mapping (text, tool calls, tool results, images, limits) and the generic recovery from
// "parameter not supported" errors. Injected fixtures, no network.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { adapter, generation, output } = require("../src/provider-adapters.cjs");
const {
  toolGeneration,
  toolOutput,
  learnAdjustment,
  applyAdjustments,
} = require("../src/tool-adapters.cjs");
const { tools } = require("../src/wp-agent.cjs");
const { Provider } = require("../src/provider.cjs");

const openai = adapter("openai", "");
const png = { mime: "image/png", data: "iVBORw0KGgo=" };

test("plain requests go to /v1/responses with instructions, input items and max_output_tokens", () => {
  const spec = generation(
    openai,
    "gpt-4.1",
    [
      { role: "system", content: "Be brief." },
      { role: "user", content: "שלום", images: [png] },
      { role: "assistant", content: "היי" },
      { role: "user", content: "ועוד" },
    ],
    false,
    2000,
  );
  assert.equal(spec.url, "https://api.openai.com/v1/responses");
  assert.deepEqual(spec.body, {
    model: "gpt-4.1",
    instructions: "Be brief.",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "שלום" },
          {
            type: "input_image",
            image_url: "data:image/png;base64,iVBORw0KGgo=",
          },
        ],
      },
      { role: "assistant", content: "היי" },
      { role: "user", content: "ועוד" },
    ],
    max_output_tokens: 2000,
    store: false,
  });
});
test("tool requests: flat function tools, calls and results as items, images, effort and encrypted reasoning", () => {
  const call = { id: "call_1", name: "wp_list_pages", args: { page: 1 } };
  const native = [
    { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "enc" },
    {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "wp_list_pages",
      arguments: '{"page":1}',
    },
  ];
  const spec = toolGeneration(
    openai,
    "gpt-5.6-luna",
    [
      { role: "system", content: "Instructions" },
      { role: "user", content: "רשימת עמודים", images: [png] },
      { role: "assistant", content: "", calls: [call], native },
      { role: "tool", call, result: { untrusted: true, data: [] } },
    ],
    tools,
  );
  const b = spec.body;
  assert.equal(b.instructions, "Instructions");
  assert.deepEqual(
    b.input[0].content.map((p) => p.type),
    ["input_text", "input_image"],
  );
  assert.deepEqual(b.input.slice(1), [
    ...native,
    {
      type: "function_call_output",
      call_id: "call_1",
      output: '{"untrusted":true,"data":[]}',
    },
  ]);
  assert.equal(b.tools.length, tools.length);
  assert.deepEqual(Object.keys(b.tools[0]).sort(), [
    "description",
    "name",
    "parameters",
    "strict",
    "type",
  ]);
  assert.deepEqual(b.reasoning, { effort: "medium" });
  assert.deepEqual(b.include, ["reasoning.encrypted_content"]);
  assert.equal(b.tool_choice, "auto");
  assert.equal(b.parallel_tool_calls, true);
  assert.ok(b.max_output_tokens > 16000, "room for reasoning tokens");
  // An assistant turn without native items (for example a rejected batch) is rebuilt from its calls.
  const rebuilt = toolGeneration(
    openai,
    "gpt-4.1",
    [
      { role: "user", content: "x" },
      { role: "assistant", content: "מנסה", calls: [call] },
      { role: "tool", call, result: { error: "no" } },
    ],
    tools,
  ).body.input;
  assert.deepEqual(rebuilt[1], { role: "assistant", content: "מנסה" });
  assert.deepEqual(rebuilt[2], {
    type: "function_call",
    call_id: "call_1",
    name: "wp_list_pages",
    arguments: '{"page":1}',
  });
  assert.equal(rebuilt[3].type, "function_call_output");
});
test("responses are mapped: text, several tool calls, usage, cut-off and failures", () => {
  const text = toolOutput(openai, {
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: "שלום " },
          { type: "output_text", text: "עולם" },
        ],
      },
    ],
    usage: {
      input_tokens: 1000,
      output_tokens: 50,
      input_tokens_details: { cached_tokens: 400 },
    },
  });
  assert.equal(text.text, "שלום עולם");
  assert.deepEqual(text.calls, []);
  assert.deepEqual(text.usage, { input: 600, output: 50, cacheRead: 400 });
  assert.equal(
    output(openai, {
      output: [
        { type: "message", content: [{ type: "output_text", text: "x" }] },
      ],
    }),
    "x",
  );
  const tool = toolOutput(openai, {
    status: "completed",
    output: [
      { type: "reasoning", id: "rs", summary: [], encrypted_content: "enc" },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "בודק" }],
      },
      {
        type: "function_call",
        id: "fc1",
        call_id: "c1",
        name: "wp_list_pages",
        arguments: '{"page":2}',
      },
      {
        type: "function_call",
        id: "fc2",
        call_id: "c2",
        name: "wp_get_capabilities",
        arguments: "{}",
      },
    ],
  });
  assert.equal(tool.text, "בודק");
  assert.deepEqual(tool.calls, [
    { id: "c1", name: "wp_list_pages", args: { page: 2 } },
    { id: "c2", name: "wp_get_capabilities", args: {} },
  ]);
  assert.equal(
    tool.native.length,
    4,
    "all output items are echoed back (encrypted reasoning included)",
  );
  assert.equal(tool.invalid, undefined);
  // Reasoning without encrypted content cannot be sent back with store:false: the history becomes stateless (no ids).
  const stateless = toolOutput(openai, {
    status: "completed",
    output: [
      { type: "reasoning", id: "rs", summary: [] },
      {
        type: "function_call",
        id: "fc1",
        call_id: "c1",
        name: "wp_list_pages",
        arguments: "{}",
      },
    ],
  });
  assert.deepEqual(stateless.native, [
    {
      type: "function_call",
      call_id: "c1",
      name: "wp_list_pages",
      arguments: "{}",
    },
  ]);
  // Cut-off tool arguments are never run.
  const cut = toolOutput(openai, {
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [
      {
        type: "function_call",
        call_id: "c1",
        name: "wp_plan_add_step",
        arguments: '{"step":',
      },
    ],
  });
  assert.equal(cut.truncated, true);
  assert.deepEqual(cut.calls, []);
  assert.throws(
    () =>
      toolOutput(openai, { status: "failed", error: { code: "server_error" } }),
    (e) => e.detail === "server_error",
  );
  const bad = toolOutput(openai, {
    status: "completed",
    output: [
      {
        type: "function_call",
        call_id: "c1",
        name: "wp_list_pages",
        arguments: "{oops",
      },
    ],
  });
  assert.match(bad.invalid.reason, /JSON/);
});
test("Moonshot and Qwen stay on chat completions with nested function tools", () => {
  for (const [name, region] of [
    ["moonshot", ""],
    ["qwen", "singapore"],
  ]) {
    const a = adapter(name, region);
    const spec = toolGeneration(
      a,
      "m",
      [
        { role: "system", content: "s" },
        { role: "user", content: "u" },
      ],
      tools,
    );
    assert.ok(spec.url.endsWith("/chat/completions"), name);
    assert.equal(spec.body.tools[0].type, "function");
    assert.equal(spec.body.tools[0].function.name, tools[0].name);
    assert.ok(
      Array.isArray(spec.body.messages) && !("input" in spec.body),
      name,
    );
    assert.ok(
      "max_tokens" in spec.body && !("max_output_tokens" in spec.body),
      name,
    );
  }
});

// ---- generic recovery ----------------------------------------------------------------------------------------------------------
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from("MOCK:" + s),
  decryptString: (b) => b.toString().slice(5),
};
function setup(t, handler, models) {
  const dir = fs.mkdtempSync(
    path.join(process.env.TMPDIR || os.tmpdir(), "responses-"),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const posts = [];
  const fetcher = async (url, opts) => {
    if (opts.method === "GET")
      return {
        ok: true,
        json: async () => ({ data: models.map((id) => ({ id })) }),
      };
    const body = JSON.parse(opts.body);
    posts.push({ url, body });
    const message = handler(body, url);
    return message
      ? {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: { message } }),
        }
      : {
          ok: true,
          json: async () => ({
            status: "completed",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "OK" }],
              },
            ],
          }),
        };
  };
  return { p: new Provider(dir, storage, fetcher), posts };
}
const LUNA =
  "Function tools with reasoning_effort are not supported for gpt-5.6-luna in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.";
test("the exact gpt-5.6-luna error: retried once with reasoning effort 'none', remembered, and caught at connect", async (t) => {
  const { p, posts } = setup(
    t,
    (b) => (b.reasoning?.effort && b.reasoning.effort !== "none" ? LUNA : null),
    ["gpt-5.6-luna"],
  );
  const list = await p.discover({
    provider: "openai",
    key: "sk-test-1234567890abcdef",
  });
  const state = await p.connect({
    token: list.token,
    model: "gpt-5.6-luna",
    consent: true,
  });
  assert.equal(state.model, "gpt-5.6-luna");
  assert.deepEqual(
    posts.map((x) => x.body.reasoning?.effort),
    ["medium", "none"],
    "one retry with the suggested value",
  );
  assert.ok(
    posts.every(
      (x) => x.url.endsWith("/v1/responses") && x.body.tools.length > 20,
    ),
    "tools are kept on every attempt",
  );
  const reply = await p.step(
    [
      { role: "system", content: "s" },
      { role: "user", content: "hi" },
    ],
    tools.slice(0, 3),
  );
  assert.equal(reply.text, "OK");
  assert.equal(
    posts.at(-1).body.reasoning.effort,
    "none",
    "remembered for this model in the session",
  );
  assert.equal(posts.length, 3, "no further retries");
});
test("any unsupported tuning parameter is dropped once and remembered; tools, model and input are never touched", async (t) => {
  const unsupported = (name) =>
    `Unsupported parameter: '${name}' is not supported with this model.`;
  const { p, posts } = setup(
    t,
    (b) => {
      if ("parallel_tool_calls" in b) return unsupported("parallel_tool_calls");
      if (b.reasoning) return unsupported("reasoning.effort");
      if ("include" in b)
        return "Encrypted content is not supported with this model. Unsupported parameter: include";
      if ("tool_choice" in b) return unsupported("tool_choice");
      return null;
    },
    ["gpt-5-future-x"],
  );
  const list = await p.discover({
    provider: "openai",
    key: "sk-test-1234567890abcdef",
  });
  await p.connect({
    token: list.token,
    model: "gpt-5-future-x",
    consent: true,
  });
  const last = posts.at(-1).body;
  for (const gone of [
    "parallel_tool_calls",
    "reasoning",
    "include",
    "tool_choice",
  ])
    assert.equal(gone in last, false, gone);
  assert.ok(
    last.tools.length > 20 &&
      last.input.length &&
      last.model === "gpt-5-future-x",
  );
  assert.equal(posts.length, 5, "four corrections, each a separate parameter");
  await p.step([{ role: "user", content: "hi" }], tools.slice(0, 2));
  assert.equal(posts.length, 6, "no corrections needed afterwards");
});
test("errors that are not about an optional parameter are not retried, and a correction never loops", async (t) => {
  for (const message of [
    "tools are not supported with this model",
    "Invalid schema for function 'x'",
    "Unsupported parameter: 'input'",
    "The model `x` does not exist",
  ]) {
    const { p, posts } = setup(t, () => message, ["gpt-4o"]);
    const list = await p.discover({
      provider: "openai",
      key: "sk-test-1234567890abcdef",
    });
    await assert.rejects(
      p.connect({ token: list.token, model: "gpt-4o", consent: true }),
      (e) => e.status === 400,
    );
    assert.equal(posts.length, 1, message);
  }
  // The provider keeps complaining about a parameter that is already adjusted: stop instead of looping.
  const { p, posts } = setup(
    t,
    () => "Unsupported parameter: 'store' is not supported with this model.",
    ["gpt-4.1-loop"],
  );
  const list = await p.discover({
    provider: "openai",
    key: "sk-test-1234567890abcdef",
  });
  await assert.rejects(
    p.connect({ token: list.token, model: "gpt-4.1-loop", consent: true }),
    /400/,
  );
  assert.equal(posts.length, 2);
});
test("chat-completions providers use the same recovery (max_tokens renamed when the error says so)", async (t) => {
  const a = adapter("qwen", "singapore");
  const body = { model: "qwen-x", max_tokens: 4096, temperature: 0.2 };
  assert.equal(
    learnAdjustment(a, "qwen-x", body, {
      status: 400,
      detail:
        "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
    }),
    true,
  );
  assert.equal(
    learnAdjustment(a, "qwen-x", body, {
      status: 400,
      detail:
        "Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported.",
    }),
    true,
  );
  const fresh = applyAdjustments(a, "qwen-x", {
    model: "qwen-x",
    max_tokens: 4096,
    temperature: 0.2,
  });
  assert.deepEqual(fresh, { model: "qwen-x", max_completion_tokens: 4096 });
  assert.equal(
    learnAdjustment(a, "qwen-x", fresh, {
      status: 401,
      detail: "Unsupported parameter: 'temperature'",
    }),
    false,
    "only 400s",
  );
  assert.equal(
    learnAdjustment(
      a,
      "qwen-y",
      { model: "qwen-y", tools: [] },
      { status: 400, detail: "Unsupported parameter: 'tools'" },
    ),
    false,
    "tools are not tuning parameters",
  );
});
