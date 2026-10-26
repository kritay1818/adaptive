"use strict";
const { generation, output, turnContent } = require("./provider-adapters.cjs");
const { text } = require("./core.cjs");
// Native client-side function calling. Preserve the complete native assistant turn,
// notably Gemini thoughtSignature and Moonshot reasoning_content on tool continuation.
// Three designed pages in one build-plan call far exceed the 4096-token chat default.
const TOOL_OUTPUT_TOKENS = 16000;
function toolGeneration(a, model, messages, tools) {
  const plain = messages
    .filter((m) => m.role !== "tool")
    .map((m) => ({
      role: m.role,
      content: m.content || "",
      ...(m.images?.length ? { images: m.images } : {}),
    }));
  // OpenAI reasoning models (o3/o4/o1, gpt-5): reasoning tokens count against max_completion_tokens, so leave room, and
  // use a moderate reasoning effort (the default of "medium", sent explicitly). Non-reasoning models reject this parameter.
  const reasoning =
    a.kind === "openai" &&
    /^(?:o3|o4|o1(?!-mini|-preview)|gpt-5)/i.test(String(model));
  const spec = generation(
    a,
    model,
    plain,
    false,
    reasoning ? TOOL_OUTPUT_TOKENS * 2 : TOOL_OUTPUT_TOKENS,
  );
  const turns = messages.filter((m) => m.role !== "system");
  if (a.kind === "gemini") {
    spec.body.contents = turns.map((m) =>
      m.role === "tool"
        ? {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: m.call.name,
                  ...(m.call.nativeId ? { id: m.call.nativeId } : {}),
                  response: m.result,
                },
              },
            ],
          }
        : m.native || {
            role: m.role === "assistant" ? "model" : "user",
            parts: turnContent(a, m),
          },
    );
    // Let the model call tools right away (no "ANY"/"NONE" forcing).
    if (tools.length)
      spec.body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    if (tools.length)
      spec.body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            ...(Object.keys(t.parameters.properties).length
              ? { parameters: geminiSchema(t.parameters) }
              : {}),
          })),
        },
      ];
  } else if (a.kind === "anthropic") {
    const native = [],
      volatile = new Set();
    for (const m of turns) {
      const turn =
        m.role === "tool"
          ? {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: m.call.id,
                  content: JSON.stringify(m.result),
                },
              ],
            }
          : { role: m.role, content: m.native || turnContent(a, m) };
      // Parallel tool results belong to a single user turn in the Messages protocol.
      if (
        m.role === "tool" &&
        Array.isArray(native.at(-1)?.content) &&
        native.at(-1).content.every((x) => x.type === "tool_result")
      )
        native.at(-1).content.push(...turn.content);
      else native.push(turn);
      if (m.volatile) volatile.add(native.length - 1);
    }
    // Prompt caching: breakpoints on tools, system prompt and the latest turn, so repeated calls in one run reuse the prefix.
    const cache = { type: "ephemeral" };
    let at = native.length - 1;
    while (at > 0 && volatile.has(at)) at--; // the cache breakpoint goes on the last STABLE turn
    const last = native[at];
    if (last) {
      const blocks =
        typeof last.content === "string"
          ? [{ type: "text", text: last.content }]
          : last.content.map((b) => ({ ...b }));
      blocks[blocks.length - 1] = {
        ...blocks[blocks.length - 1],
        cache_control: cache,
      };
      native[at] = { ...last, content: blocks };
    }
    spec.body.messages = native;
    if (typeof spec.body.system === "string" && spec.body.system)
      spec.body.system = [
        { type: "text", text: spec.body.system, cache_control: cache },
      ];
    if (tools.length) {
      spec.body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
      spec.body.tools[spec.body.tools.length - 1].cache_control = cache;
      spec.body.tool_choice = { type: "auto" }; // parallel tool use stays enabled (the default)
    }
  } else {
    spec.body.messages = messages.map((m) =>
      m.role === "tool"
        ? {
            role: "tool",
            tool_call_id: m.call.id,
            content: JSON.stringify(m.result),
          }
        : m.native || { role: m.role, content: turnContent(a, m) },
    );
    if (tools.length) {
      spec.body.tools = tools.map((t) => ({ type: "function", function: t }));
      spec.body.tool_choice = "auto";
      // Parallel calls (up to our 12 per response): OpenAI and Qwen accept the flag; Moonshot's API does not document it.
      if (a.kind === "openai" || a.kind === "qwen")
        spec.body.parallel_tool_calls = true;
      if (reasoning) spec.body.reasoning_effort = "medium";
    }
  }
  return spec;
}
function geminiSchema(schema) {
  // Gemini Schema is an OpenAPI subset, not OpenAI strict JSON schema: no additionalProperties anywhere, no empty required.
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (
        k === "additionalProperties" ||
        (k === "required" && Array.isArray(x) && !x.length)
      )
        continue;
      out[k] =
        k === "properties" && x && typeof x === "object"
          ? Object.fromEntries(Object.entries(x).map(([n, s]) => [n, walk(s)]))
          : walk(x);
    }
    return out;
  };
  return walk(schema);
}
function toolOutput(a, result) {
  const native =
    a.kind === "gemini"
      ? result?.candidates?.[0]?.content
      : a.kind === "anthropic"
        ? result?.content
        : result?.choices?.[0]?.message;
  const finish =
    a.kind === "gemini"
      ? (native?.finishReason ?? result?.candidates?.[0]?.finishReason)
      : a.kind === "anthropic"
        ? result?.stop_reason
        : result?.choices?.[0]?.finish_reason;
  const cut = ["max_tokens", "MAX_TOKENS", "length"].includes(finish);
  const pending =
    a.kind === "gemini"
      ? (native?.parts || []).some((p) => p.functionCall)
      : a.kind === "anthropic"
        ? (native || []).some((p) => p.type === "tool_use")
        : !!native?.tool_calls?.length;
  // Cut-off tool arguments are incomplete, not a malformed call: never parse or run them.
  if (cut && pending)
    return { text: "", calls: [], native, truncated: true, usage: null };
  let calls;
  if (a.kind === "gemini")
    calls = (native?.parts || [])
      .filter((p) => p.functionCall)
      .map((p, i) => ({
        id: p.functionCall.id || "gemini-" + i,
        nativeId: p.functionCall.id,
        name: p.functionCall.name,
        args: p.functionCall.args === undefined ? {} : p.functionCall.args,
      }));
  else if (a.kind === "anthropic")
    calls = (native || [])
      .filter((p) => p.type === "tool_use")
      .map((p) => ({ id: p.id, name: p.name, args: p.input }));
  else
    calls = (native?.tool_calls || []).map((p) => {
      let args,
        badJson = false;
      try {
        args = JSON.parse(p.function.arguments);
      } catch {
        args = {};
        badJson = true;
      }
      return {
        id: p.id,
        name: p.function.name,
        args,
        ...(badJson ? { badJson } : {}),
      };
    });
  // Never throw on a bad batch: report exactly what was invalid so the run can send it back to the model.
  const names = calls.map((c) => String(c.name).slice(0, 60));
  let invalid = null;
  if (calls.some((c) => typeof c.name !== "string"))
    invalid = { fatal: true, reason: "קריאת כלי ללא שם תקין" };
  else if (calls.some((c) => typeof c.id !== "string" || c.id.length > 200))
    invalid = {
      fatal: true,
      reason: "מזהה קריאת כלי חסר או ארוך מדי (מעל 200 תווים)",
      tools: names,
    };
  else if (new Set(calls.map((c) => c.id)).size !== calls.length)
    invalid = {
      fatal: true,
      reason: "מזהי קריאות כלים כפולים באותה תשובה",
      tools: names,
    };
  else if (calls.length > 12)
    invalid = {
      reason: `יותר מדי קריאות כלים בתשובה אחת: ${calls.length} (המקסימום 12). הכלים: ${names.join(", ")}`,
      tools: names,
    };
  else if (calls.some((c) => c.badJson))
    invalid = {
      reason: `הארגומנטים של ${calls
        .filter((c) => c.badJson)
        .map((c) => c.name)
        .join(", ")} אינם JSON תקין`,
      tools: names,
    };
  const content = output(a, result) || "";
  // Normalized usage: `input` is uncached input only.
  const u = a.kind === "gemini" ? result?.usageMetadata : result?.usage;
  const usage = !u
    ? null
    : a.kind === "anthropic"
      ? {
          input: u.input_tokens,
          output: u.output_tokens,
          cacheRead: u.cache_read_input_tokens,
          cacheWrite: u.cache_creation_input_tokens,
        }
      : a.kind === "gemini"
        ? {
            input: (u.promptTokenCount || 0) - (u.cachedContentTokenCount || 0),
            output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
            cacheRead: u.cachedContentTokenCount,
          }
        : {
            input:
              (u.prompt_tokens || 0) -
              (u.prompt_tokens_details?.cached_tokens || 0),
            output: u.completion_tokens,
            cacheRead: u.prompt_tokens_details?.cached_tokens,
          };
  return {
    text: text(content, 100000),
    calls,
    native,
    usage,
    ...(invalid ? { invalid } : {}),
  };
}
module.exports = { toolGeneration, toolOutput };
