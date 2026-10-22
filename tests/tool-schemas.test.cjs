"use strict";
// Injected protocol fixtures (no live model): every tool schema is valid for each provider, and valid calls to the
// site-chrome tools survive provider output parsing and validation.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { adapter } = require("../src/provider-adapters.cjs");
const { toolGeneration, toolOutput } = require("../src/tool-adapters.cjs");
const { tools, argumentsFor } = require("../src/wp-agent.cjs");
const { validatePlan, planTool } = require("../src/wp-plans.cjs");

const header =
  '<!-- wp:group {"layout":{"type":"flex","justifyContent":"space-between"}} --><div class="wp-block-group"><!-- wp:site-logo {"width":120} /--><!-- wp:navigation {"ref":{{menu.id}}} /--></div><!-- /wp:group -->';
const footer =
  '<!-- wp:group --><div class="wp-block-group"><!-- wp:paragraph --><p>כל הזכויות שמורות</p><!-- /wp:paragraph --><!-- wp:social-links --><ul class="wp-block-social-links"><!-- wp:social-link {"url":"https://facebook.com/x","service":"facebook"} /--></ul><!-- /wp:social-links --></div><!-- /wp:group -->';
const upload = (key) => ({
  key,
  tool: "wp_prepare_upload_image",
  args: {
    url: "https://images.example/logo.png",
    fileName: "logo.png",
    alt: "לוגו",
  },
});
const planSteps = [
  upload("logo"),
  {
    key: "mark",
    tool: "wp_prepare_site_logo",
    args: { mediaId: "{{logo.id}}" },
  },
  {
    key: "home",
    tool: "wp_prepare_create_page",
    args: {
      title: "בית",
      content: "<!-- wp:paragraph --><p>ברוכים הבאים</p><!-- /wp:paragraph -->",
    },
  },
  {
    key: "menu",
    tool: "wp_prepare_menu",
    args: { title: "ראשי", links: [{ pageId: "{{home.id}}", label: "בית" }] },
  },
  { key: "top", tool: "wp_prepare_header", args: { content: header } },
  { key: "bottom", tool: "wp_prepare_footer", args: { content: footer } },
  {
    key: "front",
    tool: "wp_prepare_front_page",
    args: { pageId: "{{home.id}}" },
  },
];
// Valid single calls to each new tool and to the plan tools carrying logo/header/footer steps.
const calls = [
  ["wp_prepare_site_logo", { mediaId: 42 }],
  ["wp_prepare_header", { content: header.replace("{{menu.id}}", "7") }],
  ["wp_prepare_footer", { content: footer }],
  ["wp_plan_start", { title: "ייבוא", pages: 1 }],
  ["wp_plan_add_step", { step: planSteps[1] }],
  ["wp_plan_add_step", { step: planSteps[4] }],
  ["wp_plan_add_step", { step: planSteps[5] }],
  ["wp_plan_replace_step", { key: "top", step: planSteps[4] }],
  ["wp_plan_remove_step", { key: "top" }],
  ["wp_plan_submit", {}],
  ["wp_prepare_build_plan", { title: "ייבוא", steps: planSteps }],
];
const forbidden = new Set([
  "$ref",
  "oneOf",
  "allOf",
  "patternProperties",
  "not",
  "if",
  "then",
  "else",
  "$defs",
  "definitions",
]);
function inspect(schema, path, errors) {
  if (Array.isArray(schema))
    return schema.forEach((s, i) => inspect(s, `${path}[${i}]`, errors));
  if (!schema || typeof schema !== "object") return;
  for (const [k, v] of Object.entries(schema)) {
    if (forbidden.has(k)) errors.push(`${path}: unsupported keyword ${k}`);
    if (k === "properties")
      for (const [n, s] of Object.entries(v))
        inspect(s, `${path}.${n}`, errors);
    else inspect(v, `${path}.${k}`, errors);
  }
  if (schema.type === "array" && !schema.items)
    errors.push(`${path}: array without items`);
  if (
    schema.type === "object" &&
    schema.properties &&
    schema.required &&
    schema.required.some((r) => !(r in schema.properties))
  )
    errors.push(`${path}: required key not in properties`);
}

test("tool names and parameter schemas are valid for every provider", () => {
  const errors = [];
  for (const t of tools) {
    assert.match(t.name, /^[a-zA-Z0-9_-]{1,64}$/, t.name);
    assert.ok(
      t.description.length > 10 && t.parameters.type === "object",
      t.name,
    );
    inspect(t.parameters, t.name, errors);
  }
  assert.deepEqual(errors, []);
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
  for (const name of [
    "wp_prepare_site_logo",
    "wp_prepare_header",
    "wp_prepare_footer",
    "wp_plan_start",
    "wp_plan_add_step",
    "wp_plan_replace_step",
    "wp_plan_remove_step",
    "wp_plan_submit",
  ])
    assert.ok(
      tools.some((t) => t.name === name),
      name,
    );
  // The plan-step schema the model sees declares the new step types and their arguments.
  const stepEnum =
    planTool.parameters.properties.steps.items.properties.tool.enum;
  for (const tool of [
    "wp_prepare_site_logo",
    "wp_prepare_header",
    "wp_prepare_footer",
    "wp_prepare_front_page",
    "wp_prepare_site_identity",
    "wp_prepare_menu",
  ])
    assert.ok(stepEnum.includes(tool), tool);
  const stepArgs =
    planTool.parameters.properties.steps.items.properties.args.properties;
  for (const key of ["mediaId", "content", "pageId", "links", "css"])
    assert.ok(key in stepArgs, key);
  const draft = tools.find((t) => t.name === "wp_plan_add_step").parameters
    .properties.step;
  assert.deepEqual(draft.properties.tool.enum, stepEnum);
});

for (const name of ["anthropic", "openai", "gemini"])
  test(`${name}: request schemas are well formed and valid calls to the new tools parse and validate`, () => {
    const a = adapter(name, "");
    const spec = toolGeneration(
      a,
      "test-model",
      [
        { role: "system", content: "s" },
        { role: "user", content: "u" },
      ],
      tools,
    );
    const declared =
      name === "gemini"
        ? spec.body.tools[0].functionDeclarations
        : name === "anthropic"
          ? spec.body.tools
          : spec.body.tools.map((t) => t.function);
    assert.equal(declared.length, tools.length);
    const text = JSON.stringify(declared);
    if (name === "gemini")
      assert.ok(
        !text.includes("additionalProperties") &&
          !text.includes('"required":[]'),
        "gemini schemas must not carry additionalProperties or empty required",
      );
    for (const d of declared) assert.match(d.name, /^[a-zA-Z0-9_-]{1,64}$/);
    // The provider answers with each valid call; adapters parse them and the app validates the arguments.
    for (const [index, [tool, args]] of calls.entries()) {
      const result =
        name === "anthropic"
          ? {
              content: [
                { type: "tool_use", id: `c${index}`, name: tool, input: args },
              ],
              stop_reason: "tool_use",
            }
          : name === "gemini"
            ? {
                candidates: [
                  {
                    content: {
                      role: "model",
                      parts: [{ functionCall: { name: tool, args } }],
                    },
                    finishReason: "STOP",
                  },
                ],
              }
            : {
                choices: [
                  {
                    message: {
                      role: "assistant",
                      tool_calls: [
                        {
                          id: `c${index}`,
                          type: "function",
                          function: {
                            name: tool,
                            arguments: JSON.stringify(args),
                          },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              };
      const out = toolOutput(a, result);
      assert.equal(out.invalid, undefined, tool);
      assert.equal(out.calls.length, 1);
      assert.equal(out.calls[0].name, tool);
      assert.deepEqual(out.calls[0].args, args);
      if (!tool.startsWith("wp_plan_"))
        argumentsFor(out.calls[0].name, out.calls[0].args);
    }
    assert.ok(validatePlan({ title: "ייבוא", steps: planSteps }, argumentsFor));
  });

test("a bad tool batch is reported with its reason instead of throwing", () => {
  const a = adapter("anthropic", "");
  const many = {
    content: Array.from({ length: 14 }, (_, i) => ({
      type: "tool_use",
      id: `c${i}`,
      name: "wp_plan_add_step",
      input: { step: planSteps[1] },
    })),
    stop_reason: "tool_use",
  };
  const out = toolOutput(a, many);
  assert.equal(out.calls.length, 14);
  assert.match(out.invalid.reason, /14.*wp_plan_add_step/);
  assert.equal(out.invalid.fatal, undefined);
  const dup = toolOutput(a, {
    content: [
      { type: "tool_use", id: "x", name: "wp_plan_submit", input: {} },
      { type: "tool_use", id: "x", name: "wp_plan_submit", input: {} },
    ],
  });
  assert.equal(dup.invalid.fatal, true);
  const o = adapter("openai", "");
  const broken = toolOutput(o, {
    choices: [
      {
        message: {
          tool_calls: [
            {
              id: "a",
              function: { name: "wp_plan_start", arguments: "{not json" },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  });
  assert.match(broken.invalid.reason, /wp_plan_start.*JSON/);
});
