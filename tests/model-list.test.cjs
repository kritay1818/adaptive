"use strict";
// The model window list: only chat-with-tools models, no old generations or dated duplicates, newest first, recommended by rule.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const hints = require("../src/ui/model-hints.js");

const list = (ids) => ids.map((id) => ({ id, label: id }));
const ids = (r) => r.items.map((i) => i.id);
const OPENAI = list([
  "gpt-5",
  "gpt-5-2025-08-07",
  "gpt-5-mini",
  "gpt-5-mini-2025-08-07",
  "gpt-5-nano",
  "gpt-5-chat-latest",
  "gpt-5-codex",
  "gpt-5-pro",
  "gpt-4.1",
  "gpt-4.1-2025-04-14",
  "gpt-4.1-mini",
  "gpt-4o",
  "gpt-4o-2024-11-20",
  "gpt-4o-2024-08-06",
  "gpt-4o-mini",
  "gpt-4o-mini-2024-07-18",
  "gpt-4-turbo",
  "gpt-4-turbo-preview",
  "gpt-4",
  "gpt-4-0613",
  "gpt-4-32k",
  "gpt-3.5-turbo",
  "gpt-3.5-turbo-0125",
  "gpt-3.5-turbo-instruct",
  "o3",
  "o3-2025-04-16",
  "o4-mini",
  "o3-mini",
  "o1",
  "o1-mini",
  "o1-pro",
  "o3-deep-research",
  "whisper-1",
  "tts-1",
  "tts-1-hd",
  "gpt-4o-transcribe",
  "gpt-4o-mini-tts",
  "gpt-4o-audio-preview",
  "gpt-4o-realtime-preview",
  "gpt-realtime",
  "dall-e-3",
  "dall-e-2",
  "gpt-image-1",
  "sora-2",
  "text-embedding-3-large",
  "text-embedding-ada-002",
  "omni-moderation-latest",
  "text-moderation-latest",
  "babbage-002",
  "davinci-002",
  "computer-use-preview",
  "gpt-4o-search-preview",
  "gpt-4o-mini-search-preview",
  "chatgpt-4o-latest",
  "ft:gpt-4o-mini:acme::abc",
  "gpt-5.6-luna",
]);
const GEMINI = list([
  "gemini-3-pro-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-preview-05-20",
  "gemini-2.5-pro-preview-06-05",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-exp",
  "gemini-flash-latest",
  "gemini-pro-latest",
  "gemini-2.0-flash-exp-image-generation",
  "gemini-2.5-flash-image-preview",
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-pro-preview-tts",
  "gemini-2.0-flash-live-001",
  "gemini-live-2.5-flash-preview",
  "gemini-embedding-001",
  "gemini-2.5-computer-use-preview-10-2025",
  "gemini-1.5-pro",
  "gemini-1.5-flash-002",
  "gemini-1.0-pro",
  "gemini-pro",
  "gemini-pro-vision",
  "gemma-3-27b-it",
  "learnlm-2.0-flash-experimental",
  "aqa",
  "gemini-robotics-er-1.5-preview",
  "imagen-4.0-generate-001",
]);

test("OpenAI: voice, audio, image, embedding, moderation, realtime, search, instruct and old models are hidden; duplicates collapse", () => {
  const r = hints.prepareModels("openai", OPENAI);
  assert.deepEqual(
    new Set(ids(r)),
    new Set([
      "gpt-5.6-luna",
      "gpt-5",
      "gpt-5-mini",
      "gpt-5-nano",
      "gpt-5-pro",
      "gpt-5-codex",
      "gpt-5-chat-latest",
      "o4-mini",
      "o3",
      "o3-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4o",
      "gpt-4o-mini",
    ]),
  );
  const shown = new Set(ids(r));
  for (const gone of [
    "whisper-1",
    "tts-1",
    "tts-1-hd",
    "gpt-4o-transcribe",
    "gpt-4o-mini-tts",
    "gpt-4o-audio-preview",
    "gpt-4o-realtime-preview",
    "gpt-realtime",
    "dall-e-3",
    "dall-e-2",
    "gpt-image-1",
    "sora-2",
    "text-embedding-3-large",
    "text-embedding-ada-002",
    "omni-moderation-latest",
    "text-moderation-latest",
    "babbage-002",
    "davinci-002",
    "computer-use-preview",
    "gpt-4o-search-preview",
    "gpt-4o-mini-search-preview",
    "chatgpt-4o-latest",
    "ft:gpt-4o-mini:acme::abc",
    "gpt-3.5-turbo",
    "gpt-3.5-turbo-0125",
    "gpt-3.5-turbo-instruct",
    "gpt-4",
    "gpt-4-0613",
    "gpt-4-32k",
    "gpt-4-turbo",
    "gpt-4-turbo-preview",
    "o1",
    "o1-mini",
    "o1-pro",
    "o3-deep-research",
  ])
    assert.ok(!shown.has(gone), `${gone} should be hidden`);
  for (const dup of [
    "gpt-5-2025-08-07",
    "gpt-5-mini-2025-08-07",
    "gpt-4.1-2025-04-14",
    "gpt-4o-2024-11-20",
    "gpt-4o-2024-08-06",
    "gpt-4o-mini-2024-07-18",
    "o3-2025-04-16",
  ])
    assert.ok(!shown.has(dup), `${dup}: a newer alias exists`);
  assert.equal(r.total, OPENAI.length);
  assert.equal(r.hiddenCount, OPENAI.length - r.items.length);
});
test("OpenAI: newest first, and the recommended model is the newest main gpt model, chosen by rule", () => {
  const r = hints.prepareModels("openai", OPENAI);
  assert.deepEqual(
    r.items.filter((i) => i.recommended).map((i) => i.id),
    ["gpt-5.6-luna"],
  );
  assert.equal(r.items[0].id, "gpt-5.6-luna", "recommended models come first");
  const rest = r.items.slice(1).map((i) => i.id);
  assert.ok(
    rest.indexOf("gpt-5") < rest.indexOf("o4-mini") &&
      rest.indexOf("o4-mini") < rest.indexOf("gpt-4.1") &&
      rest.indexOf("gpt-4.1") < rest.indexOf("gpt-4o"),
  );
  // New releases are picked up without any code change.
  const next = hints.prepareModels("openai", [
    ...OPENAI,
    { id: "gpt-6", label: "gpt-6" },
    { id: "gpt-6-mini", label: "gpt-6-mini" },
  ]);
  assert.deepEqual(
    next.items.filter((i) => i.recommended).map((i) => i.id),
    ["gpt-6"],
  );
  assert.equal(next.items[0].id, "gpt-6");
  // Without any gpt model the newest o-series model is recommended.
  assert.deepEqual(
    hints
      .prepareModels("openai", list(["o3", "o4-mini", "whisper-1"]))
      .items.filter((i) => i.recommended)
      .map((i) => i.id),
    ["o3"],
  );
  assert.ok(
    r.items.find((i) => i.id === "gpt-5-mini").small &&
      !r.items.find((i) => i.id === "gpt-5").small,
  );
});
test("Gemini: only generateContent chat models, no old 1.x, no tts/live/image/embedding/gemma, snapshots collapsed", () => {
  const r = hints.prepareModels("gemini", GEMINI);
  const shown = new Set(ids(r));
  for (const keep of [
    "gemini-3-pro-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-flash-latest",
    "gemini-pro-latest",
  ])
    assert.ok(shown.has(keep), `${keep} should be shown`);
  for (const gone of [
    "gemini-2.5-flash-preview-05-20",
    "gemini-2.5-pro-preview-06-05",
    "gemini-2.0-flash-001",
    "gemini-2.0-flash-exp",
    "gemini-2.0-flash-exp-image-generation",
    "gemini-2.5-flash-image-preview",
    "gemini-2.5-flash-preview-tts",
    "gemini-2.5-pro-preview-tts",
    "gemini-2.0-flash-live-001",
    "gemini-live-2.5-flash-preview",
    "gemini-embedding-001",
    "gemini-2.5-computer-use-preview-10-2025",
    "gemini-1.5-pro",
    "gemini-1.5-flash-002",
    "gemini-1.0-pro",
    "gemini-pro",
    "gemini-pro-vision",
    "gemma-3-27b-it",
    "learnlm-2.0-flash-experimental",
    "aqa",
    "gemini-robotics-er-1.5-preview",
    "imagen-4.0-generate-001",
  ])
    assert.ok(!shown.has(gone), `${gone} should be hidden`);
  // Recommended: the newest Pro and the newest non-lite Flash; newest first after them; unversioned aliases last.
  assert.deepEqual(
    r.items.filter((i) => i.recommended).map((i) => i.id),
    ["gemini-3-pro-preview", "gemini-2.5-flash"],
  );
  assert.deepEqual(ids(r).slice(0, 2), [
    "gemini-3-pro-preview",
    "gemini-2.5-flash",
  ]);
  const order = ids(r);
  assert.ok(
    order.indexOf("gemini-2.5-pro") < order.indexOf("gemini-2.0-flash") &&
      order.indexOf("gemini-2.0-flash") < order.indexOf("gemini-flash-latest"),
  );
  assert.ok(!r.items.find((i) => i.id === "gemini-2.5-flash-lite").recommended);
});
test("Anthropic, Moonshot and Qwen: same rules", () => {
  const anthropic = hints.prepareModels(
    "anthropic",
    list([
      "claude-opus-4-1-20250805",
      "claude-opus-4-20250514",
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4-20250514",
      "claude-haiku-4-5-20251001",
      "claude-3-7-sonnet-20250219",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
      "claude-3-haiku-20240307",
      "claude-2.1",
      "claude-instant-1.2",
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "claude-haiku-5-5",
    ]),
  );
  assert.deepEqual(
    anthropic.items.filter((i) => i.recommended).map((i) => i.id),
    ["claude-sonnet-5-5", "claude-opus-5-5"],
  );
  assert.deepEqual(ids(anthropic).slice(0, 3), [
    "claude-sonnet-5-5",
    "claude-opus-5-5",
    "claude-haiku-5-5",
  ]);
  for (const gone of [
    "claude-2.1",
    "claude-instant-1.2",
    "claude-3-opus-20240229",
    "claude-3-haiku-20240307",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
  ])
    assert.ok(!ids(anthropic).includes(gone), gone);
  assert.ok(ids(anthropic).includes("claude-3-7-sonnet-20250219"));
  const moonshot = hints.prepareModels(
    "moonshot",
    list([
      "kimi-k2-0905-preview",
      "kimi-k2-0711-preview",
      "kimi-k2-turbo-preview",
      "kimi-k2-thinking",
      "kimi-latest",
      "moonshot-v1-8k",
      "moonshot-v1-128k",
      "moonshot-v1-8k-vision-preview",
    ]),
  );
  assert.deepEqual(
    moonshot.items.filter((i) => i.recommended).map((i) => i.id),
    ["kimi-k2-0905-preview"],
  );
  assert.ok(!ids(moonshot).some((i) => /moonshot-v1|0711/.test(i)));
  const qwen = hints.prepareModels(
    "qwen",
    list([
      "qwen3-max",
      "qwen3-max-2025-09-23",
      "qwen-max",
      "qwen-plus",
      "qwen-plus-2025-09-11",
      "qwen-flash",
      "qwen3-coder-plus",
      "qwen2.5-72b-instruct",
      "qwen-vl-max",
      "qwen3-omni-flash",
      "qwen-mt-turbo",
      "qwen3-asr-flash",
      "qwen-tts",
      "text-embedding-v4",
      "wan2.5-t2i-preview",
    ]),
  );
  assert.deepEqual(
    qwen.items.filter((i) => i.recommended).map((i) => i.id),
    ["qwen3-max", "qwen-plus"],
  );
  for (const gone of [
    "qwen3-max-2025-09-23",
    "qwen-plus-2025-09-11",
    "qwen2.5-72b-instruct",
    "qwen-vl-max",
    "qwen3-omni-flash",
    "qwen-mt-turbo",
    "qwen3-asr-flash",
    "qwen-tts",
    "text-embedding-v4",
    "wan2.5-t2i-preview",
  ])
    assert.ok(!ids(qwen).includes(gone), gone);
});
test("'הצגת כל המודלים' shows everything the provider returned; the filter never leaves the list empty", () => {
  const all = hints.prepareModels("openai", OPENAI, { showAll: true });
  assert.equal(all.items.length, OPENAI.length);
  assert.deepEqual(
    all.items.filter((i) => i.recommended).map((i) => i.id),
    ["gpt-5.6-luna"],
    "recommendations ignore the hidden junk",
  );
  assert.equal(all.items[0].id, "gpt-5.6-luna");
  assert.deepEqual(new Set(ids(all)), new Set(OPENAI.map((m) => m.id)));
  const only = hints.prepareModels("openai", list(["whisper-1", "tts-1"]));
  assert.deepEqual(
    ids(only).sort(),
    ["tts-1", "whisper-1"],
    "nothing usable: the full list is shown instead of an empty one",
  );
  assert.deepEqual(hints.prepareModels("gemini", []).items, []);
  assert.deepEqual(hints.prepareModels("gemini", null).items, []);
});
test("the model window has the toggle (off by default) and the one-line note under the list", () => {
  const html = fs
    .readFileSync(path.join(__dirname, "../src/ui/model.html"), "utf8")
    .replace(/\s+/g, " ");
  assert.match(html, /id="show-all-models" type="checkbox"(?![^>]*checked)/);
  assert.match(html, /הצגת כל המודלים/);
  assert.ok(
    html.indexOf('id="model-note"') > html.indexOf('id="model"'),
    "the note is under the list",
  );
  assert.equal(
    hints.NOTE,
    "מודלים קטנים (mini/nano/flash-lite) זולים יותר אבל פחות טובים בבניית אתרים",
  );
  const ui = fs.readFileSync(
    path.join(__dirname, "../src/ui/model-ui.js"),
    "utf8",
  );
  assert.match(ui, /prepareModels/);
  assert.match(ui, /· מומלץ/);
});
