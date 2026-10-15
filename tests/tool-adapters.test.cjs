// Injected protocol fixtures, NOT live model validation.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { adapter } = require("../src/provider-adapters.cjs");
const { toolGeneration, toolOutput } = require("../src/tool-adapters.cjs");
const { tools } = require("../src/wp-agent.cjs");
for (const name of ["gemini", "anthropic", "openai", "moonshot", "qwen"])
  test(
    name + " genuine tool request/result protocol preserves native calls",
    () => {
      const a = adapter(name, name === "qwen" ? "singapore" : "");
      const native =
        name === "gemini"
          ? {
              role: "model",
              parts: [
                {
                  functionCall: { name: "wp_list_pages", args: { page: 1 } },
                  thoughtSignature: "opaque-signature",
                },
              ],
            }
          : name === "anthropic"
            ? [
                {
                  type: "tool_use",
                  id: "c1",
                  name: "wp_list_pages",
                  input: { page: 1 },
                },
              ]
            : {
                role: "assistant",
                content: null,
                reasoning_content: "opaque-reasoning",
                tool_calls: [
                  {
                    id: "c1",
                    type: "function",
                    function: {
                      name: "wp_list_pages",
                      arguments: '{"page":1}',
                    },
                  },
                ],
              };
      const raw =
        name === "gemini"
          ? { candidates: [{ content: native }] }
          : name === "anthropic"
            ? { content: native }
            : { choices: [{ message: native }] };
      const parsed = toolOutput(a, raw);
      assert.equal(parsed.calls[0].name, "wp_list_pages");
      const spec = toolGeneration(
        a,
        "fixture-model",
        [
          { role: "system", content: "Read-only until approved" },
          { role: "user", content: "list pages" },
          { role: "assistant", native: parsed.native, calls: parsed.calls },
          {
            role: "tool",
            call: parsed.calls[0],
            result: { untrusted: true, data: [] },
          },
        ],
        tools,
      );
      assert.ok(spec.body.tools.length);
      if (name === "gemini") {
        assert.equal(
          spec.body.tools[0].functionDeclarations[0].name,
          "wp_list_pages",
        );
        assert.equal(
          spec.body.tools[0].functionDeclarations.find(
            (t) => t.name === "wp_get_capabilities",
          ).parameters,
          undefined,
          "Gemini no-argument function must omit empty object schema",
        );
        assert.equal(
          spec.body.contents[1].parts[0].thoughtSignature,
          "opaque-signature",
        );
        assert.equal(
          spec.body.contents[2].parts[0].functionResponse.name,
          "wp_list_pages",
        );
        assert.equal(
          spec.body.contents[2].parts[0].functionResponse.response.untrusted,
          true,
        );
      } else if (name === "anthropic") {
        assert.equal(spec.body.tools[0].input_schema.type, "object");
        assert.equal(spec.body.messages[2].content[0].tool_use_id, "c1");
      } else {
        assert.equal(spec.body.tools[0].type, "function");
        assert.equal(spec.body.messages.at(-1).tool_call_id, "c1");
        assert.equal(
          spec.body.messages.at(-2).reasoning_content,
          "opaque-reasoning",
        );
      }
    },
  );
