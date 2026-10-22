"use strict";
// Rough per-million-token prices in USD: [input, output]. Estimates only; edit when provider pricing changes.
// Cache read ~0.1x input and cache write ~1.25x input for Anthropic; OpenAI cached input ~0.5x (counted in cacheRead).
// Matched by substring, first hit wins: exact older (pricier) models first, then the model family.
const PRICES = {
  anthropic: [
    ["claude-opus-4-0", 15, 75],
    ["claude-opus-4-2025", 15, 75],
    ["opus-4-1", 15, 75],
    ["3-opus", 15, 75],
    ["opus", 5, 25],
    ["sonnet", 3, 15],
    ["3-haiku", 0.25, 1.25],
    ["haiku-3-5", 0.8, 4],
    ["haiku", 1, 5],
  ],
  openai: [
    ["gpt-5-nano", 0.05, 0.4],
    ["gpt-5-mini", 0.25, 2],
    ["gpt-5", 1.25, 10],
    ["gpt-4.1-nano", 0.1, 0.4],
    ["gpt-4.1-mini", 0.4, 1.6],
    ["gpt-4.1", 2, 8],
    ["gpt-4o-mini", 0.15, 0.6],
    ["gpt-4o", 2.5, 10],
    ["o4-mini", 1.1, 4.4],
    ["o3-mini", 1.1, 4.4],
    ["o3", 2, 8],
  ],
};
const CACHE = {
  anthropic: { read: 0.1, write: 1.25 },
  openai: { read: 0.5, write: 1 },
};
function emptyUsage() {
  return { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}
function addUsage(total, u) {
  total.calls++;
  if (!u) return;
  for (const k of ["input", "output", "cacheRead", "cacheWrite"])
    total[k] += Number(u[k]) || 0;
}
// `provider` may be a provider id or a display label; fall back to the model name's family.
function familyOf(provider, model) {
  const p = String(provider || "").toLowerCase(),
    m = String(model || "").toLowerCase();
  if (PRICES[p]) return p;
  if (/claude|anthropic/.test(p + " " + m)) return "anthropic";
  if (/^(?:gpt|chatgpt|o\d)|openai/.test(m) || /openai/.test(p))
    return "openai";
  return null;
}
function estimate(total, provider, model) {
  const family = familyOf(provider, model);
  const row =
    family &&
    PRICES[family].find(([key]) =>
      String(model || "")
        .toLowerCase()
        .includes(key),
    );
  if (!row) return null;
  const c = CACHE[family];
  return (
    (total.input * row[1] +
      total.cacheRead * row[1] * c.read +
      total.cacheWrite * row[1] * c.write +
      total.output * row[2]) /
    1e6
  );
}
const n = (v) => v.toLocaleString("en-US");
function formatUsage(total, { provider, model } = {}) {
  if (!total.calls) return "";
  const parts = [
    `בקשות למודל: ${total.calls}`,
    `קלט: ${n(total.input)} טוקנים`,
    `פלט: ${n(total.output)} טוקנים`,
  ];
  if (total.cacheRead) parts.push(`נקרא ממטמון: ${n(total.cacheRead)}`);
  if (total.cacheWrite) parts.push(`נכתב למטמון: ${n(total.cacheWrite)}`);
  const cost = estimate(total, provider, model);
  if (cost !== null)
    parts.push(
      `עלות משוערת: ≈$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)} (הערכה גסה)`,
    );
  return `שימוש במודל${model ? " " + model : ""} — ` + parts.join(" · ");
}
// Rough pre-run estimate (scan = site import: +8000 text tokens and ~4200 screenshot tokens per page): fixed overhead (CSS, brief, tools) plus per-page input/output. Returns USD or null (unknown model).
function estimateTask(pages, provider, model, { scan = false } = {}) {
  const total = {
    calls: 0,
    input: 60000 + pages * (40000 + (scan ? 12200 : 0)),
    output: 6000 + pages * 7000,
    cacheRead: 0,
    cacheWrite: 0,
  };
  return estimate(total, provider, model);
}
module.exports = { estimateTask, emptyUsage, addUsage, formatUsage, estimate };
