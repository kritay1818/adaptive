"use strict";
// Same behavior across providers: the "act, don't ask" rule leads the instructions, and every provider's request sends the
// tools with automatic tool choice. Injected fixtures, no network.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { adapter } = require("../src/provider-adapters.cjs");
const { toolGeneration } = require("../src/tool-adapters.cjs");
const { Agent, tools, ACT_RULE } = require("../src/wp-agent.cjs");
const hints = require("../src/ui/model-hints.js");

test("the instructions start with the act-don't-ask rule", () => {
  const agent = new Agent(
    {
      data: { p: "x" },
      status: () => ({ connected: true, site: "https://s.example" }),
    },
    require("node:os").tmpdir(),
  );
  const context = agent.context("p");
  assert.ok(
    context.startsWith(ACT_RULE),
    "the rule is the very first thing in the runtime instructions",
  );
  for (const phrase of [
    "review card",
    "IS the confirmation step",
    "never ask 'should I proceed",
    "never ask for approval in chat",
    "sensible choices",
    "clearly marked placeholders",
    "say in one short line what you assumed",
    "ONE short question, never a list",
  ])
    assert.ok(ACT_RULE.includes(phrase), phrase);
  assert.ok(ACT_RULE.length < 900, "short enough for smaller models");
  assert.ok(
    context.indexOf("ACT, DON'T ASK") <
      context.indexOf("Available exact tools"),
  );
});

const messages = [
  { role: "system", content: "s" },
  { role: "user", content: "תבנה אתר" },
];
const requestFor = (provider, model) =>
  toolGeneration(
    adapter(provider, provider === "qwen" ? "singapore" : ""),
    model,
    messages,
    tools,
  ).body;

test("every provider's request includes the tools with automatic tool choice", () => {
  const openai = requestFor("openai", "gpt-4o");
  assert.equal(openai.tools.length, tools.length);
  assert.equal(openai.tool_choice, "auto");
  assert.equal(openai.parallel_tool_calls, true);
  assert.equal(
    "reasoning_effort" in openai,
    false,
    "non-reasoning models do not get reasoning_effort",
  );

  const anthropic = requestFor("anthropic", "claude-sonnet-5-5");
  assert.equal(anthropic.tools.length, tools.length);
  assert.deepEqual(anthropic.tool_choice, { type: "auto" });
  assert.notEqual(anthropic.tool_choice.disable_parallel_tool_use, true);

  const gemini = requestFor("gemini", "gemini-2.5-pro");
  assert.equal(gemini.tools[0].functionDeclarations.length, tools.length);
  assert.deepEqual(gemini.toolConfig, {
    functionCallingConfig: { mode: "AUTO" },
  });

  const moonshot = requestFor("moonshot", "kimi-k2-0905-preview");
  assert.equal(moonshot.tools.length, tools.length);
  assert.equal(moonshot.tool_choice, "auto");
  assert.equal("parallel_tool_calls" in moonshot, false);

  const qwen = requestFor("qwen", "qwen-plus");
  assert.equal(qwen.tools.length, tools.length);
  assert.equal(qwen.tool_choice, "auto");
  assert.equal(qwen.parallel_tool_calls, true);
});

test("OpenAI reasoning models get a sensible effort and room for reasoning tokens", () => {
  const plain = requestFor("openai", "gpt-4.1");
  for (const model of ["gpt-5", "gpt-5-mini", "o3", "o4-mini"]) {
    const body = requestFor("openai", model);
    assert.equal(body.reasoning_effort, "medium", model);
    assert.ok(body.max_completion_tokens > plain.max_completion_tokens, model);
    assert.equal(body.tool_choice, "auto");
  }
  for (const model of ["gpt-4o", "gpt-4.1-mini", "o1-mini"])
    assert.equal(
      "reasoning_effort" in requestFor("openai", model),
      false,
      model,
    );
});

test("without tools no tool settings are sent", () => {
  const body = toolGeneration(
    adapter("openai", ""),
    "gpt-5",
    messages,
    [],
  ).body;
  assert.equal("tool_choice" in body, false);
  assert.equal("parallel_tool_calls" in body, false);
});

test("model window hints: recommended models per provider, and a note about small ones", () => {
  const yes = [
    ["anthropic", "claude-sonnet-5-5"],
    ["anthropic", "claude-opus-5-5"],
    ["openai", "gpt-5"],
    ["openai", "gpt-4.1"],
    ["openai", "gpt-4o"],
    ["gemini", "gemini-2.5-pro"],
    ["gemini", "gemini-2.5-flash"],
    ["moonshot", "kimi-k2-0905-preview"],
    ["qwen", "qwen-plus"],
    ["qwen", "qwen3-max"],
  ];
  const no = [
    ["anthropic", "claude-haiku-5-5"],
    ["openai", "gpt-5-mini"],
    ["openai", "gpt-5-nano"],
    ["openai", "gpt-4o-mini"],
    ["openai", "gpt-4.1-nano"],
    ["gemini", "gemini-2.5-flash-lite"],
    ["qwen", "qwen-turbo"],
    ["moonshot", "moonshot-v1-8k"],
  ];
  for (const [p, m] of yes) assert.equal(hints.recommended(p, m), true, m);
  for (const [p, m] of no) assert.equal(hints.recommended(p, m), false, m);
  for (const m of [
    "gpt-5-mini",
    "gpt-4.1-nano",
    "gemini-2.5-flash-lite",
    "claude-haiku-5-5",
  ])
    assert.equal(hints.isSmall(m), true, m);
  for (const m of ["gpt-5", "claude-sonnet-5-5", "gemini-2.5-pro"])
    assert.equal(hints.isSmall(m), false, m);
  assert.match(hints.NOTE, /mini/);
  assert.match(hints.NOTE, /nano/);
  assert.match(hints.NOTE, /flash-lite/);
});
