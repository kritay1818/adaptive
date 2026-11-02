"use strict";
// Model list for the model window: hides what cannot chat with tools (audio, image, embeddings...), old generations and dated
// duplicates; orders newest first; marks the recommended models by RULE (newest of a tier), never by an exact model name, so new
// releases are picked up automatically. Display only (the connection logic still validates the chosen model). Pure: tested in Node.
(function (root) {
  const SEP = "[-_.:/]";
  // ---- what is not a chat-with-tools model -------------------------------------------------------------------------------------
  const NOT_CHAT_WORD = new RegExp(
    `(?:^|${SEP})(?:audio|voice|tts|whisper|transcribe|transcription|stt|asr|realtime|speech|image|images|imagen|dall-e|dalle|embedding|embeddings|embed|moderation|moderations|omni-moderation|rerank|search|instruct|babbage|davinci|computer-use|diarize|live|livetranslate|sora|veo|guard|aqa|learnlm|gemma|robotics|ocr|vl|qvq|mt|omni|translate|deep-research|t2i|t2v|i2v)(?=$|${SEP})`,
    "i",
  );
  const NOT_CHAT_PREFIX =
    /^(?:ft:|text-|tts-|whisper|dall|davinci|babbage|chatgpt-|omni-|gpt-image|sora|codex-|code-|computer-use|gpt-realtime|gpt-audio|wan)/i;
  // ---- old generations (static floors; unknown new names stay visible) -----------------------------------------------------
  const OLD = {
    openai: /^(?:gpt-3|gpt-4(?:-(?!o)|$)|o1)/i, // gpt-3.5*, the original gpt-4 (turbo, 32k, dated), o1*
    anthropic: /^claude-(?:2|instant|v1)|^claude-3(?:-|\.)(?![7-9])/i, // claude-2*, instant, claude-3-* and 3.5
    gemini: /^gemini-(?:1\.|pro$|pro-vision|ultra)/i,
    moonshot: /^moonshot-v1/i,
    qwen: /^qwen(?:1|2)(?:\.|-|\d)/i,
  };
  // ---- version, snapshot stamp, size -------------------------------------------------------------------------------------------
  const STAMP = /-(?:\d{4}-\d{2}-\d{2}|\d{8}|\d{2}-\d{2}|\d{4}|\d{3})(?=-|$)/g;
  const VARIANT = /-(?:preview|exp|experimental|latest)(?=-|$)/g;
  const SMALL =
    /(?:^|[-_.:/\s])(?:mini|nano|lite|haiku|tiny|small)(?=$|[-_.:/\s\d])|\b[0-9]{1,2}b\b/i;
  const num = (v) => (v === undefined ? 0 : Number(v));
  function generation(provider, id) {
    const s = String(id);
    let m;
    if (provider === "openai") {
      if ((m = /^gpt-4o/i.exec(s))) return 4.05;
      if ((m = /^gpt-(\d+)(?:\.(\d+))?(?!\d)/i.exec(s)))
        return num(m[1]) + num(m[2]) / 10;
      if ((m = /^o(\d)/i.exec(s))) return 4 + num(m[1]) / 10;
    } else if (provider === "anthropic") {
      if (
        (m = /claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(s))
      )
        return num(m[1]) + num(m[2]) / 10;
      if ((m = /claude-(\d+)(?:[-.](\d{1,2}))?-(?:opus|sonnet|haiku)/i.exec(s)))
        return num(m[1]) + num(m[2]) / 10;
      if ((m = /claude-(\d+)(?:\.(\d+))?$/i.exec(s)))
        return num(m[1]) + num(m[2]) / 10;
    } else if (provider === "gemini") {
      if ((m = /gemini-(\d+(?:\.\d+)?)/i.exec(s))) return parseFloat(m[1]);
    } else if (provider === "moonshot") {
      if ((m = /kimi-k(\d+)(?:\.(\d+))?/i.exec(s)))
        return num(m[1]) + num(m[2]) / 10;
      if ((m = /moonshot-v(\d+)/i.exec(s))) return num(m[1]);
    } else if (provider === "qwen") {
      if ((m = /^qwen(\d+(?:\.\d+)?)/i.exec(s))) return parseFloat(m[1]);
    }
    return null; // unversioned alias (for example gemini-flash-latest, qwen-max): sorted after versioned models
  }
  const stampOf = (id) =>
    Number((String(id).match(STAMP) || []).join("").replace(/\D/g, "") || 0);
  const groupKey = (id) => String(id).replace(STAMP, "").replace(VARIANT, "");
  const isAlias = (id) => groupKey(id) === String(id);
  const isSmall = (id) => SMALL.test(String(id || ""));
  function hidden(provider, id) {
    const s = String(id || "");
    return (
      NOT_CHAT_PREFIX.test(s) ||
      NOT_CHAT_WORD.test(s) ||
      !!OLD[provider]?.test(s)
    );
  }
  // Newest first: higher generation, then later snapshot, then shorter (alias) name.
  const newer = (a, b) =>
    (b.gen ?? -1) - (a.gen ?? -1) ||
    b.stamp - a.stamp ||
    a.id.length - b.id.length ||
    (a.id < b.id ? -1 : 1);
  // ---- recommended models, by rule ---------------------------------------------------------------------------------------------
  // Each group yields at most one model: the newest non-small one matching the first alternative that has any.
  const MAIN_GPT = /^gpt-\d/i,
    NOT_MAIN = /(?:chat|pro)/i; // for the main gpt line: not the chat-tuned or pro variants
  const NOT_RECOMMENDED = /(?:codex|coder|spark|oss)/i; // specialised variants are shown, never recommended
  const TIERS = {
    anthropic: [[/sonnet/i], [/opus/i]],
    openai: [[MAIN_GPT, /^o\d/i]],
    gemini: [[/pro/i], [/flash/i]],
    moonshot: [[/kimi-k\d/i, /kimi/i]],
    qwen: [[/max/i], [/plus/i]],
  };
  function recommend(provider, list) {
    const picked = [];
    for (const alternatives of TIERS[provider] || []) {
      for (const re of alternatives) {
        const matching = list.filter(
          (m) =>
            re.test(m.id) &&
            !isSmall(m.id) &&
            !NOT_RECOMMENDED.test(m.id) &&
            !(re === MAIN_GPT && NOT_MAIN.test(m.id)),
        );
        // Prefer a plain chat variant over a "thinking" variant when both exist.
        const plain = matching.filter((m) => !/thinking/i.test(m.id));
        const pool = (plain.length ? plain : matching).sort(newer);
        if (pool.length) {
          picked.push(pool[0].id);
          break;
        }
      }
    }
    return picked.slice(0, 2);
  }
  // models: [{id, label}] as returned by the provider. Returns {items, hiddenCount, total}; items = [{id, label, recommended, small}].
  function prepareModels(provider, models, { showAll = false } = {}) {
    const all = (Array.isArray(models) ? models : [])
      .filter((m) => m && typeof m.id === "string")
      .map((m) => ({
        id: m.id,
        label: m.label || m.id,
        gen: generation(provider, m.id),
        stamp: stampOf(m.id),
      }));
    const usable = all.filter((m) => !hidden(provider, m.id));
    // One entry per model family: the plain alias when it exists, otherwise the newest snapshot.
    const groups = new Map();
    for (const m of usable) {
      const key = groupKey(m.id);
      const best = groups.get(key);
      const score = (x) => (isAlias(x.id) ? 1e12 : 0) + x.stamp;
      if (!best || score(m) > score(best)) groups.set(key, m);
    }
    let visible = [...groups.values()];
    if (!visible.length) visible = all; // never an empty list because of the filter
    const recommended = recommend(provider, visible);
    const pool = showAll ? all : visible;
    const rank = (m) =>
      recommended.includes(m.id)
        ? recommended.indexOf(m.id)
        : recommended.length;
    const items = [...pool]
      .sort((a, b) => rank(a) - rank(b) || newer(a, b))
      .map((m) => ({
        id: m.id,
        label: m.label,
        recommended: recommended.includes(m.id),
        small: isSmall(m.id),
      }));
    return {
      items,
      total: all.length,
      hiddenCount: all.length - visible.length,
    };
  }
  const NOTE =
    "מודלים קטנים (mini/nano/flash-lite) זולים יותר אבל פחות טובים בבניית אתרים";
  const api = { prepareModels, isSmall, hidden, generation, NOTE };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.adModelHints = api;
})(typeof window !== "undefined" ? window : globalThis);
