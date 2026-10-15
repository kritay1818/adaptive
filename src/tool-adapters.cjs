"use strict";
const { generation, output } = require("./provider-adapters.cjs");
const { text } = require("./core.cjs");
// Native client-side function calling. Preserve the complete native assistant turn,
// notably Gemini thoughtSignature and Moonshot reasoning_content on tool continuation.
function toolGeneration(a, model, messages, tools) {
  const plain = messages
    .filter((m) => m.role !== "tool")
    .map((m) => ({ role: m.role, content: m.content || "" }));
  const spec = generation(a, model, plain, false);
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
            parts: [{ text: m.content }],
          },
    );
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
    const native = [];
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
          : { role: m.role, content: m.native || m.content };
      // Parallel tool results belong to a single user turn in the Messages protocol.
      if (
        m.role === "tool" &&
        Array.isArray(native.at(-1)?.content) &&
        native.at(-1).content.every((x) => x.type === "tool_result")
      )
        native.at(-1).content.push(...turn.content);
      else native.push(turn);
    }
    spec.body.messages = native;
    if (tools.length)
      spec.body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
  } else {
    spec.body.messages = messages.map((m) =>
      m.role === "tool"
        ? {
            role: "tool",
            tool_call_id: m.call.id,
            content: JSON.stringify(m.result),
          }
        : m.native || { role: m.role, content: m.content },
    );
    if (tools.length)
      spec.body.tools = tools.map((t) => ({ type: "function", function: t }));
  }
  return spec;
}
function geminiSchema(schema) {
  // Gemini Schema is an OpenAPI subset, not OpenAI strict JSON schema.
  const { additionalProperties, ...rest } = schema;
  return rest;
}
function toolOutput(a, result) {
  const native =
    a.kind === "gemini"
      ? result?.candidates?.[0]?.content
      : a.kind === "anthropic"
        ? result?.content
        : result?.choices?.[0]?.message;
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
      let args;
      try {
        args = JSON.parse(p.function.arguments);
      } catch {
        throw new Error("פרמטר כלי לא תקין מהמודל");
      }
      return { id: p.id, name: p.function.name, args };
    });
  if (
    calls.length > 4 ||
    calls.some(
      (c) =>
        typeof c.id !== "string" ||
        c.id.length > 200 ||
        typeof c.name !== "string",
    ) ||
    new Set(calls.map((c) => c.id)).size !== calls.length
  )
    throw new Error("קריאות כלים לא תקינות מהמודל");
  const content = output(a, result) || "";
  return { text: text(content, 100000), calls, native };
}
module.exports = { toolGeneration, toolOutput };
