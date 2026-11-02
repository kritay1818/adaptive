"use strict";
const {
  generation,
  output,
  turnContent,
  isReasoning,
  responseText,
} = require("./provider-adapters.cjs");
const { text } = require("./core.cjs");
// Native client-side function calling. Preserve the complete native assistant turn,
// notably Gemini thoughtSignature and Moonshot reasoning_content on tool continuation.
// Three designed pages in one build-plan call far exceed the 4096-token chat default.
const TOOL_OUTPUT_TOKENS = 16000;
// Completion-token ceilings that providers enforce with an HTTP 400 when the request asks for more. Known OpenAI limits are
// listed here; every other limit is learned once from the provider's own error text (capFromError) and remembered per model.
const learned = new Map();
function completionCap(a, model) {
  const id = String(model);
  const known = learned.get(`${a.kind}:${id}`);
  if (known) return known;
  if (a.kind !== "openai") return Infinity;
  if (
    /^gpt-3\.5|^gpt-4-(?:turbo|vision|preview|\d{4})|^gpt-4$|^gpt-4-32k|^gpt-4o-2024-05-13$/i.test(
      id,
    )
  )
    return 4096;
  if (/^(?:chatgpt-4o|gpt-4o)/i.test(id)) return 16384;
  if (/^gpt-4\.1/i.test(id)) return 32768;
  return Infinity;
}
const learnCap = (a, model, n) => {
  if (Number.isSafeInteger(n) && n >= 256) learned.set(`${a.kind}:${model}`, n);
};
const sentLimit = (body) =>
  body?.max_output_tokens ??
  body?.max_completion_tokens ??
  body?.max_tokens ??
  body?.generationConfig?.maxOutputTokens ??
  null;
// "This model supports at most 4096 completion tokens", "Range of max_tokens should be [1, 8192]", "maxOutputTokens ... from 1
// (inclusive) to 8193 (exclusive)": the largest limit below what we sent, or null when the error is not about the token limit.
function capFromError(error, sent) {
  const detail = String(error?.detail || "");
  if (
    error?.status !== 400 ||
    !sent ||
    !/max[_ ]?(?:completion[_ ]|output[_ ])?tokens|maxOutputTokens/i.test(
      detail,
    )
  )
    return null;
  const numbers = [...detail.matchAll(/\b(\d{3,6})\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 256 && n < sent);
  if (!numbers.length) return null;
  const n = Math.max(...numbers);
  return /exclusive/i.test(detail) ? n - 1 : n;
}
// ---- generic recovery from "this parameter is not supported" 400s --------------------------------------------------------------
// New models keep changing which request parameters they accept, so instead of listing models, the provider's own 400 text decides.
// The adjustment (drop the parameter, or use the value the error suggests) is remembered per model for the session and applied
// to every later request body. Only optional tuning parameters can be adjusted; the model, the messages and the tools never are.
const adjustments = new Map();
const TUNING = [
  "reasoning_effort",
  "reasoning.effort",
  "reasoning",
  "parallel_tool_calls",
  "temperature",
  "top_p",
  "max_tokens",
  "max_completion_tokens",
  "max_output_tokens",
  "store",
  "include",
  "tool_choice",
  "service_tier",
];
const UNSUPPORTED =
  /unsupported|not supported|does not support|doesn't support|unrecognized|unknown (?:parameter|field|argument)|not allowed|only the default/i;
const pathOf = (body, name) =>
  name === "reasoning_effort" || name === "reasoning.effort"
    ? body.reasoning_effort !== undefined
      ? "reasoning_effort"
      : body.reasoning?.effort !== undefined
        ? "reasoning.effort"
        : null
    : body[name] !== undefined
      ? name
      : null;
const getPath = (body, path) =>
  path.split(".").reduce((v, k) => (v == null ? v : v[k]), body);
function setPath(body, path, value) {
  const keys = path.split(".");
  let node = body;
  for (const k of keys.slice(0, -1)) node = node[k] ??= {};
  node[keys.at(-1)] = value;
}
function deletePath(body, path) {
  const keys = path.split(".");
  let node = body;
  for (const k of keys.slice(0, -1)) node = node?.[k];
  if (node && typeof node === "object") delete node[keys.at(-1)];
  if (keys.length > 1 && !Object.keys(body[keys[0]] || {}).length)
    delete body[keys[0]];
}
// A value the error names: "set reasoning_effort to 'none'" or "Supported values are: 'low', 'high'".
function suggestedValue(detail, current) {
  const direct = detail.match(
    /(?:set|use|change|try)\s+[`'"]?(?:reasoning[_.]?effort|effort)[`'"]?\s+(?:to|=)\s+[`'"]?([a-z]+)/i,
  );
  if (direct) return direct[1].toLowerCase();
  const list = detail.match(/supported values(?: are)?:?\s*([^.]*)/i);
  if (list) {
    const values = [...list[1].matchAll(/['"`]([a-z_]+)['"`]/g)].map(
      (m) => m[1],
    );
    for (const v of ["medium", "low", "high", "minimal", "none"])
      if (values.includes(v) && v !== current) return v;
    return values.find((v) => v !== current) || null;
  }
  return null;
}
const keyFor = (a, model) => `${a.kind}:${model}`;
function learnAdjustment(a, model, body, error) {
  const detail = String(error?.detail || "");
  if (error?.status !== 400 || !UNSUPPORTED.test(detail)) return false;
  const known = adjustments.get(keyFor(a, model)) || [];
  for (const name of TUNING) {
    if (
      !new RegExp(
        `(?:^|[^a-z_.])${name.replace(".", "\\.")}(?![a-z_])`,
        "i",
      ).test(detail)
    )
      continue;
    const path = pathOf(body, name);
    if (!path) continue;
    let op;
    if (/effort$/.test(path)) {
      const value = suggestedValue(detail, getPath(body, path));
      op = value ? { path, action: "set", value } : { path, action: "delete" };
    } else if (path === "max_tokens" && /max_completion_tokens/.test(detail))
      op = { path, action: "rename", to: "max_completion_tokens" };
    else op = { path, action: "delete" };
    if (known.some((k) => JSON.stringify(k) === JSON.stringify(op))) continue;
    adjustments.set(keyFor(a, model), [...known, op]);
    return true;
  }
  return false;
}
function applyAdjustments(a, model, body) {
  for (const op of adjustments.get(keyFor(a, model)) || []) {
    if (getPath(body, op.path) === undefined) continue;
    if (op.action === "delete") deletePath(body, op.path);
    else if (op.action === "set") setPath(body, op.path, op.value);
    else if (op.action === "rename") {
      body[op.to] = body[op.path];
      delete body[op.path];
    }
  }
  return body;
}
function toolGeneration(a, model, messages, tools, maxTokens) {
  const plain = messages
    .filter((m) => m.role !== "tool")
    .map((m) => ({
      role: m.role,
      content: m.content || "",
      ...(m.images?.length ? { images: m.images } : {}),
    }));
  // OpenAI reasoning models (o3/o4/o1, gpt-5): reasoning tokens count against max_completion_tokens, so leave room, and
  // use a moderate reasoning effort (the default of "medium", sent explicitly). Non-reasoning models reject this parameter.
  const reasoning = a.kind === "openai" && isReasoning(model);
  const spec = generation(
    a,
    model,
    plain,
    false,
    Math.min(
      maxTokens ?? (reasoning ? TOOL_OUTPUT_TOKENS * 2 : TOOL_OUTPUT_TOKENS),
      completionCap(a, model),
    ),
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
  } else if (a.kind === "openai") {
    // Responses API items: messages, the model's own output items (function calls, reasoning) and function_call_output results.
    // System messages travel as `instructions` (generation() already joined them).
    const input = [];
    for (const m of turns) {
      if (m.role === "tool")
        input.push({
          type: "function_call_output",
          call_id: m.call.id,
          output: JSON.stringify(m.result),
        });
      else if (m.role === "assistant") {
        if (Array.isArray(m.native)) input.push(...m.native);
        else {
          if (m.content) input.push({ role: "assistant", content: m.content });
          for (const c of m.calls || [])
            input.push({
              type: "function_call",
              call_id: c.id,
              name: c.name,
              arguments: JSON.stringify(c.args ?? {}),
            });
        }
      } else input.push({ role: m.role, content: turnContent(a, m) });
    }
    spec.body.input = input;
    if (tools.length) {
      // strict:false — our schemas use optional properties and anyOf, which strict mode would reject.
      spec.body.tools = tools.map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        strict: false,
      }));
      spec.body.tool_choice = "auto";
      // o1 and o3-mini reject the flag ("not supported with this model"); the default there is the same.
      if (!/^(?:o1|o3-mini)/i.test(String(model)))
        spec.body.parallel_tool_calls = true;
      if (reasoning) {
        spec.body.reasoning = { effort: "medium" };
        // store:false means reasoning items are returned encrypted and sent back with the next step.
        spec.body.include = ["reasoning.encrypted_content"];
      }
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
      if (a.kind === "qwen") spec.body.parallel_tool_calls = true;
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
// What is sent back to the Responses API on the next step. With store:false the model's reasoning items travel encrypted; when
// the model returned reasoning without encrypted content, send a stateless history (no reasoning items, no item ids).
function echoItems(output) {
  const items = JSON.parse(JSON.stringify(Array.isArray(output) ? output : []));
  const reasoning = items.filter((i) => i?.type === "reasoning");
  if (reasoning.every((r) => typeof r.encrypted_content === "string"))
    return items;
  return items
    .filter((i) => i?.type !== "reasoning")
    .map(({ id: _id, ...rest }) => rest);
}
function toolOutput(a, result) {
  if (a.kind === "openai" && (result?.status === "failed" || result?.error))
    throw Object.assign(new Error("המודל החזיר שגיאה בעיבוד הבקשה."), {
      kind: "http",
      detail: String(
        result?.error?.code || result?.error?.type || "failed",
      ).slice(0, 100),
    });
  const native =
    a.kind === "gemini"
      ? result?.candidates?.[0]?.content
      : a.kind === "anthropic"
        ? result?.content
        : a.kind === "openai"
          ? echoItems(result?.output)
          : result?.choices?.[0]?.message;
  const finish =
    a.kind === "gemini"
      ? (native?.finishReason ?? result?.candidates?.[0]?.finishReason)
      : a.kind === "anthropic"
        ? result?.stop_reason
        : a.kind === "openai"
          ? result?.status === "incomplete" &&
            result?.incomplete_details?.reason === "max_output_tokens"
            ? "length"
            : result?.status
          : result?.choices?.[0]?.finish_reason;
  const cut = ["max_tokens", "MAX_TOKENS", "length"].includes(finish);
  const pending =
    a.kind === "gemini"
      ? (native?.parts || []).some((p) => p.functionCall)
      : a.kind === "anthropic"
        ? (native || []).some((p) => p.type === "tool_use")
        : a.kind === "openai"
          ? native.some((i) => i?.type === "function_call")
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
  else if (a.kind === "openai")
    calls = native
      .filter((i) => i?.type === "function_call")
      .map((i) => {
        let args,
          badJson = false;
        try {
          args = JSON.parse(i.arguments);
        } catch {
          args = {};
          badJson = true;
        }
        return {
          id: i.call_id,
          name: i.name,
          args,
          ...(badJson ? { badJson } : {}),
        };
      });
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
  const content =
    (a.kind === "openai" ? responseText(result) : output(a, result)) || "";
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
      : a.kind === "openai"
        ? {
            input:
              (u.input_tokens || 0) -
              (u.input_tokens_details?.cached_tokens || 0),
            output: u.output_tokens,
            cacheRead: u.input_tokens_details?.cached_tokens,
          }
        : a.kind === "gemini"
          ? {
              input:
                (u.promptTokenCount || 0) - (u.cachedContentTokenCount || 0),
              output:
                (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
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
module.exports = {
  toolGeneration,
  toolOutput,
  completionCap,
  learnCap,
  sentLimit,
  capFromError,
  learnAdjustment,
  applyAdjustments,
  TOOL_OUTPUT_TOKENS,
};
