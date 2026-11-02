"use strict";
// The real chat request (all current tools, history with images and tool results) is checked against each provider's documented
// limits and schema rules, and the connection check sends the same shape so a rejected request fails at connect time.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { adapter } = require("../src/provider-adapters.cjs");
const {
  toolGeneration,
  completionCap,
  capFromError,
  sentLimit,
} = require("../src/tool-adapters.cjs");
const { tools, toolsFor } = require("../src/wp-agent.cjs");
const { Provider } = require("../src/provider.cjs");

const png = { mime: "image/png", data: "iVBORw0KGgo=" };
const call = { id: "call_1", name: "wp_list_pages", args: { page: 1 } };
const messages = [
  { role: "system", content: "You are a site assistant." },
  { role: "user", content: "בנה לי עמוד", images: [png] },
  { role: "assistant", content: "", calls: [call], native: undefined },
  { role: "tool", call, result: { untrusted: true, data: [] } },
  { role: "user", content: "status", volatile: true },
];
// A native assistant turn per provider, as the provider returned it (needed to continue after a tool call).
const withNative = (kind) => {
  const native =
    kind === "gemini"
      ? {
          role: "model",
          parts: [{ functionCall: { name: call.name, args: call.args } }],
        }
      : kind === "anthropic"
        ? [{ type: "tool_use", id: call.id, name: call.name, input: call.args }]
        : kind === "openai"
          ? [
              {
                type: "function_call",
                id: "fc_1",
                call_id: call.id,
                name: call.name,
                arguments: JSON.stringify(call.args),
              },
            ]
          : {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: call.id,
                  type: "function",
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.args),
                  },
                },
              ],
            };
  return messages.map((m) => (m.role === "assistant" ? { ...m, native } : m));
};
const PROVIDERS = [
  [
    "openai",
    "",
    [
      "gpt-4o",
      "gpt-4.1",
      "gpt-4-turbo",
      "gpt-3.5-turbo",
      "gpt-5",
      "gpt-5-mini",
      "gpt-5-chat-latest",
      "o3",
      "o4-mini",
      "o1",
      "o3-mini",
    ],
  ],
  ["gemini", "", ["gemini-2.5-pro", "gemini-2.0-flash"]],
  ["moonshot", "", ["kimi-k2-0905-preview"]],
  ["qwen", "singapore", ["qwen-plus", "qwen-max"]],
  ["anthropic", "", ["claude-sonnet-4-5"]],
];
const ALLOWED_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "description",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "anyOf",
  "default",
  "pattern",
]);
// Rules shared by every provider's function-calling schema, plus the ones OpenAI documents for function parameters.
function checkSchema(
  node,
  where,
  errors,
  { allowAnyOf = true, allowAdditional = true } = {},
) {
  if (!node || typeof node !== "object") return;
  for (const key of Object.keys(node))
    if (!ALLOWED_KEYWORDS.has(key))
      errors.push(`${where}: keyword ${key} is not supported`);
  if (node.type !== undefined && typeof node.type !== "string")
    errors.push(
      `${where}: "type" must be one string, not ${JSON.stringify(node.type)}`,
    );
  if (node.type === undefined && !node.anyOf)
    errors.push(`${where}: schema without type`);
  if (node.anyOf) {
    if (!allowAnyOf) errors.push(`${where}: anyOf is not allowed here`);
    node.anyOf.forEach((s, i) =>
      checkSchema(s, `${where}.anyOf[${i}]`, errors, {
        allowAnyOf: false,
        allowAdditional,
      }),
    );
  }
  if (node.type === "array") {
    if (!node.items) errors.push(`${where}: array without items`);
    else
      checkSchema(node.items, `${where}.items`, errors, {
        allowAnyOf,
        allowAdditional,
      });
  }
  if (node.enum && node.type !== "string")
    errors.push(`${where}: enum only on strings`);
  if (node.type === "object") {
    if (!node.properties || typeof node.properties !== "object")
      errors.push(`${where}: object without properties`);
    if (node.required !== undefined) {
      if (
        !Array.isArray(node.required) ||
        node.required.some(
          (r) => typeof r !== "string" || !(r in (node.properties || {})),
        )
      )
        errors.push(`${where}: "required" must list existing properties`);
    }
    if (allowAdditional === false && node.additionalProperties !== undefined)
      errors.push(`${where}: additionalProperties not allowed`);
    for (const [name, sub] of Object.entries(node.properties || {}))
      checkSchema(sub, `${where}.${name}`, errors, {
        allowAnyOf,
        allowAdditional,
      });
  }
}
function functionsOf(a, body) {
  if (a.kind === "gemini") return body.tools[0].functionDeclarations;
  if (a.kind === "anthropic")
    return body.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    }));
  return body.tools.map((t) => {
    assert.equal(t.type, "function");
    // OpenAI Responses tools are flat; chat-completions providers nest them under `function`.
    return a.kind === "openai" ? t : t.function;
  });
}
for (const [provider, region, models] of PROVIDERS)
  for (const model of models)
    test(`${provider} ${model}: the real chat request follows the documented limits and schema rules`, () => {
      const a = adapter(provider, region);
      const spec = toolGeneration(a, model, withNative(a.kind), tools);
      const fns = functionsOf(a, spec.body);
      const errors = [];
      assert.equal(fns.length, tools.length);
      assert.ok(fns.length <= 128, "at most 128 tools");
      for (const f of fns) {
        assert.match(f.name, /^[a-zA-Z0-9_-]{1,64}$/, f.name);
        assert.ok(
          typeof f.description === "string" &&
            f.description.length >= 1 &&
            f.description.length <= 1024,
          `${f.name}: description 1..1024 characters`,
        );
        const parameters = f.parameters;
        if (parameters) {
          assert.equal(
            parameters.type,
            "object",
            `${f.name}: root is an object`,
          );
          assert.ok(
            !parameters.anyOf &&
              !parameters.oneOf &&
              !parameters.allOf &&
              !parameters.enum &&
              !parameters.not,
            `${f.name}: no combinators at the root`,
          );
          // Gemini's schema is an OpenAPI subset: no additionalProperties at all.
          checkSchema(parameters, f.name, errors, {
            allowAdditional: a.kind !== "gemini",
          });
        }
      }
      assert.deepEqual(errors, []);
      assert.equal(
        new Set(fns.map((f) => f.name)).size,
        fns.length,
        "unique tool names",
      );
      const sent = sentLimit(spec.body);
      assert.ok(
        Number.isSafeInteger(sent) && sent >= 1,
        "a token limit is sent",
      );
      assert.ok(
        sent <= completionCap(a, model),
        `${model}: ${sent} must not exceed the model's output limit`,
      );
      if (a.kind === "openai") {
        const body = spec.body;
        assert.equal(spec.url, "https://api.openai.com/v1/responses");
        for (const old of [
          "max_tokens",
          "max_completion_tokens",
          "messages",
          "reasoning_effort",
          "temperature",
        ])
          assert.equal(old in body, false, `Responses body has no ${old}`);
        assert.ok(
          Number.isSafeInteger(body.max_output_tokens) &&
            body.max_output_tokens >= 16,
        );
        assert.equal(body.store, false);
        const reasoning = /^(?:o3|o4|o1|gpt-5(?!-chat))/.test(model);
        assert.deepEqual(
          body.reasoning,
          reasoning ? { effort: "medium" } : undefined,
          `${model}: reasoning only on reasoning models`,
        );
        assert.deepEqual(
          body.include,
          reasoning ? ["reasoning.encrypted_content"] : undefined,
        );
        assert.equal(
          "parallel_tool_calls" in body,
          !/^(?:o1|o3-mini)/.test(model),
          `${model}: parallel_tool_calls`,
        );
        assert.equal(body.tool_choice, "auto");
        assert.equal(typeof body.instructions, "string");
        for (const t of body.tools) assert.equal(t.strict, false);
        const limits = {
          "gpt-4-turbo": 4096,
          "gpt-3.5-turbo": 4096,
          "gpt-4o": 16384,
          "gpt-4.1": 32768,
        };
        if (limits[model]) assert.ok(body.max_output_tokens <= limits[model]);
        // Input items: messages, the model's function calls, and function_call_output results that answer one of them.
        const ids = new Set();
        for (const item of body.input) {
          if (item.type === "function_call") ids.add(item.call_id);
          else if (item.type === "function_call_output") {
            assert.ok(
              ids.has(item.call_id),
              "tool result follows its function call",
            );
            assert.equal(typeof item.output, "string");
          } else if (item.type === "reasoning")
            assert.equal(typeof item.encrypted_content, "string");
          else {
            assert.ok(
              ["user", "assistant"].includes(item.role),
              "system text travels as instructions",
            );
            if (Array.isArray(item.content))
              for (const part of item.content)
                assert.ok(
                  part.type === "input_text" ||
                    (part.type === "input_image" &&
                      /^data:image\/png;base64,/.test(part.image_url)),
                );
          }
        }
        assert.ok(body.input.some((i) => i.type === "function_call_output"));
        assert.ok(
          body.input.some(
            (i) =>
              Array.isArray(i.content) &&
              i.content.some((p) => p.type === "input_image"),
          ),
          "images are input_image parts",
        );
      }
      if (a.kind === "gemini") {
        assert.ok(spec.body.generationConfig.maxOutputTokens <= 65536);
        assert.deepEqual(spec.body.toolConfig, {
          functionCallingConfig: { mode: "AUTO" },
        });
        for (const f of fns)
          assert.match(f.name, /^[a-zA-Z_][a-zA-Z0-9_.:-]{0,63}$/);
      }
      if (a.kind === "anthropic")
        assert.ok(
          spec.body.max_tokens >= 1 && spec.body.tool_choice.type === "auto",
        );
    });
test("the tool set is filtered by what the conversation needs, and every subset stays valid", () => {
  const plain = toolsFor([{ role: "user", content: "הוסף עמוד צור קשר" }]);
  const importing = toolsFor([
    { role: "user", content: "ייבא את https://example.com" },
  ]);
  for (const name of [
    "wp_read_import_site",
    "wp_prepare_upload_scan_graphic",
    "wp_read_design_reference",
  ]) {
    assert.ok(!plain.some((t) => t.name === name), name);
    assert.ok(
      importing.some((t) => t.name === name),
      name,
    );
  }
  assert.equal(
    toolsFor([{ role: "user", content: "x" }], { importing: true }).length,
    tools.length,
  );
  assert.ok(
    plain.some((t) => t.name === "wp_prepare_create_page") &&
      plain.some((t) => t.name === "wp_plan_submit"),
  );
  assert.ok(JSON.stringify(plain).length < JSON.stringify(tools).length);
});
test("completion-token limits: known OpenAI ceilings and what the provider's own error says", () => {
  const a = adapter("openai", "");
  assert.equal(completionCap(a, "gpt-4-turbo"), 4096);
  assert.equal(completionCap(a, "gpt-4o-2024-05-13"), 4096);
  assert.equal(completionCap(a, "gpt-4o-mini"), 16384);
  assert.equal(completionCap(a, "gpt-4.1-mini"), 32768);
  assert.equal(completionCap(a, "gpt-5"), Infinity);
  const err = (detail) => ({ status: 400, detail });
  assert.equal(
    capFromError(
      err(
        "max_tokens is too large: 16000. This model supports at most 4096 completion tokens, whereas you provided 16000.",
      ),
      16000,
    ),
    4096,
  );
  assert.equal(
    capFromError(err("Range of max_tokens should be [1, 8192]"), 16000),
    8192,
  );
  assert.equal(
    capFromError(
      err(
        "maxOutputTokens value of 16000 but the supported range is from 1 (inclusive) to 8193 (exclusive)",
      ),
      16000,
    ),
    8192,
  );
  assert.equal(
    capFromError(err("Invalid schema for function 'x'"), 16000),
    null,
  );
  assert.equal(
    capFromError({ status: 401, detail: "max_tokens 4096" }, 16000),
    null,
  );
});

// ---- the connection check ------------------------------------------------------------------------------------------------------
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from("MOCK:" + s),
  decryptString: (b) => b.toString().slice(5),
};
function setup(t, fetcher) {
  const dir = fs.mkdtempSync(
    path.join(process.env.TMPDIR || os.tmpdir(), "provlimits-"),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, p: new Provider(dir, storage, fetcher) };
}
const listing = { data: [{ id: "gpt-4-turbo" }] };
const okChat = {
  status: "completed",
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "OK" }],
    },
  ],
};
test("the connection check sends tools like a real chat; a rejected request fails at connect with the provider's message and saves nothing", async (t) => {
  const bodies = [];
  const { p, dir } = setup(t, async (url, opts) => {
    if (opts.method === "GET") return { ok: true, json: async () => listing };
    const body = JSON.parse(opts.body);
    bodies.push(body);
    return {
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: {
            message:
              "Invalid schema for function 'wp_x': array schema missing items.",
          },
        }),
    };
  });
  const list = await p.discover({
    provider: "openai",
    key: "sk-test-1234567890abcdef",
  });
  await assert.rejects(
    p.connect({ token: list.token, model: "gpt-4-turbo", consent: true }),
    (e) => {
      assert.equal(e.status, 400);
      assert.match(e.detail, /array schema missing items/);
      return true;
    },
  );
  assert.ok(
    bodies[0].tools.length > 20 &&
      bodies[0].tool_choice === "auto" &&
      bodies[0].tools[0].name,
    "tools are part of the check",
  );
  assert.ok(
    bodies[0].max_output_tokens <= 4096,
    "the model's known output limit is respected",
  );
  assert.equal(
    fs.existsSync(path.join(dir, "connection.json")),
    false,
    "nothing is saved when the check fails",
  );
});
test("a too-high token limit is corrected once from the provider's own error, at connect and in chat", async (t) => {
  const sent = [];
  const { p } = setup(t, async (url, opts) => {
    if (opts.method === "GET")
      return {
        ok: true,
        json: async () => ({ data: [{ id: "gpt-9-custom" }] }),
      };
    const body = JSON.parse(opts.body);
    sent.push(body.max_output_tokens);
    if (body.max_output_tokens > 8000)
      return {
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              message: `max_output_tokens is too large: ${body.max_output_tokens}. This model supports at most 8000 completion tokens.`,
            },
          }),
      };
    return { ok: true, json: async () => okChat };
  });
  const list = await p.discover({
    provider: "openai",
    key: "sk-test-1234567890abcdef",
  });
  await p.connect({ token: list.token, model: "gpt-9-custom", consent: true });
  assert.deepEqual(
    sent,
    [16000, 8000],
    "one retry with the limit the provider named",
  );
  const reply = await p.step(
    [{ role: "user", content: "hi" }],
    tools.slice(0, 3),
  );
  assert.equal(reply.text, "OK");
  assert.deepEqual(
    sent,
    [16000, 8000, 8000],
    "the learned limit is used from then on",
  );
});
test("non-limit 400 errors are not retried", async (t) => {
  let posts = 0;
  const { p } = setup(t, async (url, opts) => {
    if (opts.method === "GET")
      return { ok: true, json: async () => ({ data: [{ id: "gpt-4o" }] }) };
    posts++;
    return {
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: { message: "tools are not supported with this model" },
        }),
    };
  });
  const list = await p.discover({
    provider: "openai",
    key: "sk-test-1234567890abcdef",
  });
  await assert.rejects(
    p.connect({ token: list.token, model: "gpt-4o", consent: true }),
    /400/,
  );
  assert.equal(posts, 1);
});
