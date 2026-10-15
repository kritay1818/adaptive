"use strict";
// Main-process only. See docs/PROVIDERS.md for official protocol sources.
// New providers require a reviewed fixed HTTPS host + adapter + contract tests.
const registry = Object.freeze({
  openai: {
    label: "OpenAI",
    base: "https://api.openai.com/v1",
    kind: "openai",
  },
  anthropic: {
    label: "Claude · Anthropic",
    base: "https://api.anthropic.com/v1",
    kind: "anthropic",
  },
  gemini: {
    label: "Gemini · Google",
    base: "https://generativelanguage.googleapis.com/v1beta",
    kind: "gemini",
  },
  moonshot: {
    label: "Kimi · Moonshot",
    base: "https://api.moonshot.ai/v1",
    kind: "moonshot",
  },
  qwen: {
    label: "Qwen · Alibaba Cloud",
    base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    listBase: "https://dashscope-intl.aliyuncs.com/api/v1",
    kind: "qwen",
    regions: [{ id: "singapore", label: "Singapore · מפתח מהאזור הזה בלבד" }],
  },
});
function adapter(provider, region = "") {
  if (!Object.hasOwn(registry, provider)) throw new Error("ספק אינו נתמך");
  const a = registry[provider];
  if (a.regions ? !a.regions.some((r) => r.id === region) : region !== "")
    throw new Error("אזור אינו נתמך. Qwen זמין כאן באזור Singapore בלבד.");
  return a;
}
function catalog() {
  return Object.entries(registry).map(([id, a]) => ({
    id,
    label: a.label,
    regions: a.regions || [],
  }));
}
function headers(a, key) {
  return {
    "Content-Type": "application/json",
    ...(a.kind === "anthropic"
      ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
      : a.kind === "gemini"
        ? { "x-goog-api-key": key }
        : { Authorization: "Bearer " + key }),
  };
}
function generation(a, model, messages, validation) {
  const max = validation ? 128 : 4096;
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const turns = messages
    .filter((m) => m.role !== "system")
    .map(({ role, content }) => ({ role, content }));
  if (a.kind === "anthropic")
    return {
      url: a.base + "/messages",
      body: {
        model,
        max_tokens: max,
        ...(system ? { system } : {}),
        messages: turns,
      },
    };
  if (a.kind === "gemini")
    return {
      url: a.base + "/models/" + encodeURIComponent(model) + ":generateContent",
      body: {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: turns.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: max },
      },
    };
  return {
    url: a.base + "/chat/completions",
    body: {
      model,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        ...turns,
      ],
      ...(a.kind === "openai"
        ? { store: false, max_completion_tokens: max }
        : { max_tokens: max }),
    },
  };
}
function output(a, r) {
  if (a.kind === "anthropic")
    return r?.content
      ?.filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
  if (a.kind === "gemini")
    return r?.candidates?.[0]?.content?.parts
      ?.filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
  return r?.choices?.[0]?.message?.content;
}
function listing(a, cursor) {
  const url = new URL((a.listBase || a.base) + "/models");
  if (a.kind === "anthropic") {
    url.searchParams.set("limit", "1000");
    if (cursor) url.searchParams.set("after_id", cursor);
  }
  if (a.kind === "gemini") {
    url.searchParams.set("pageSize", "1000");
    if (cursor) url.searchParams.set("pageToken", cursor);
  }
  if (a.kind === "qwen") {
    url.searchParams.set("page_size", "100");
    url.searchParams.set("page_no", String(cursor || 1));
  }
  return url.href;
}
function listed(a, r) {
  if (a.kind === "gemini") {
    if (!Array.isArray(r.models)) throw new Error("רשימת מודלים לא תקינה");
    return {
      models: r.models
        .filter(
          (m) =>
            m.supportedGenerationMethods?.includes("generateContent") &&
            typeof m.name === "string" &&
            m.name.startsWith("models/"),
        )
        .map((m) => ({
          id: m.name.slice(7),
          label: m.displayName || m.name.slice(7),
        })),
      next: r.nextPageToken || null,
    };
  }
  if (a.kind === "qwen") {
    const o = r.output;
    if (
      r.success === false ||
      !Array.isArray(o?.models) ||
      !Number.isInteger(o.total) ||
      !Number.isInteger(o.page_no) ||
      !Number.isInteger(o.page_size) ||
      o.page_size < 1
    )
      throw new Error("רשימת מודלים לא תקינה");
    return {
      models: o.models
        .filter(
          (m) =>
            m.inference_metadata?.response_modality?.includes("Text") &&
            m.inference_metadata?.request_modality?.includes("Text"),
        )
        .map((m) => ({ id: m.model, label: m.name || m.model })),
      next: o.page_no * o.page_size < o.total ? o.page_no + 1 : null,
    };
  }
  if (!Array.isArray(r.data)) throw new Error("רשימת מודלים לא תקינה");
  if (a.kind === "anthropic" && r.has_more && !r.last_id)
    throw new Error("רשימת מודלים לא תקינה");
  // OpenAI's list lacks endpoint capability metadata: candidates, NOT guaranteed chat support.
  return {
    models: r.data.map((m) => ({ id: m.id, label: m.display_name || m.id })),
    next: a.kind === "anthropic" && r.has_more ? r.last_id : null,
  };
}
module.exports = {
  adapter,
  catalog,
  headers,
  generation,
  output,
  listing,
  listed,
};
