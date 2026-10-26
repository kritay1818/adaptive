"use strict";
// Which models suit building sites ("מומלץ") and which small ones may struggle. Display hints only. Pure, so it is tested in Node.
(function (root) {
  const SMALL =
    /(?:^|[-_.:/\s])(?:mini|nano|lite|haiku|tiny|small)(?=$|[-_.:/\s\d])|\b[0-9]{1,2}b\b/i;
  const RECOMMENDED = {
    anthropic: /(?:sonnet|opus)/i,
    openai: /^(?:gpt-5|gpt-4\.1|gpt-4o|o3)(?![\w.-]*(?:mini|nano))/i,
    gemini: /gemini-(?:2\.5|3)[\w.-]*(?:pro|flash)(?![\w.-]*lite)/i,
    moonshot: /kimi-k2/i,
    qwen: /^qwen[\w.]*-(?:max|plus)|^qwen3-max/i,
  };
  const isSmall = (id) => SMALL.test(String(id || ""));
  const recommended = (provider, id) =>
    !isSmall(id) && !!RECOMMENDED[provider]?.test(String(id || ""));
  const NOTE =
    "מודלים שמסומנים ״מומלץ״ מתאימים לבניית אתרים. מודלים קטנים (mini / nano / flash-lite / haiku) עלולים להתקשות בבניית אתרים ולבקש הבהרות במקום לפעול.";
  const api = { isSmall, recommended, NOTE };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.adModelHints = api;
})(typeof window !== "undefined" ? window : globalThis);
