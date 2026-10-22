"use strict";
// Maps provider / WordPress errors to friendly Hebrew text with an action. Raw provider text stays in `tech`.
const RESUME_TEXT =
  "המשימה נעצרה באמצע — מה שכבר נעשה נשמר. אחרי שתטפלו בבעיה, כתבו 'המשך'.";
function describeError(e, { hasResume = false } = {}) {
  const raw = String(e?.message || "הפעולה נכשלה");
  const detail = String(e?.detail || "");
  const status = Number(e?.status) || 0;
  let message = raw,
    buttons = [];
  if (e?.kind === "http" || status) {
    if (
      status === 402 ||
      /credit balance|billing|insufficient[ _]?(?:quota|funds|balance|credit)|exceeded your current quota|out of credit|payment required|add credits/i.test(
        detail,
      )
    ) {
      message = "נגמר הקרדיט בחשבון ה-API. יש להטעין קרדיט ואז ללחוץ 'המשך'.";
      buttons = ["billing"];
    } else if (
      status === 401 ||
      (status === 403 &&
        /api[ _-]?key|authenticat|unauthori[sz]ed|permission/i.test(detail))
    ) {
      message = "מפתח ה-API לא תקף — יש לחבר מודל מחדש.";
      buttons = ["model"];
    } else if ([429, 500, 502, 503, 504, 529].includes(status)) {
      message = "השירות עמוס כרגע — נסו שוב בעוד דקה.";
    }
  } else if (e?.kind === "network") {
    message =
      "לא ניתן להגיע לספק המודל. בדקו את חיבור האינטרנט (או חומת אש) ונסו שוב.";
  } else if (e?.kind === "timeout") {
    message = raw; // already specific: "המודל לקח יותר מדי זמן…"
  } else if (/סטטוס HTTP (?:401|403)\b/.test(detail)) {
    message = "סיסמת היישום לא תקפה או שאין הרשאה — יש לחבר את האתר מחדש.";
    buttons = ["wordpress"];
  } else if (/חריגה ממגבלת הזמן|שגיאת רשת|סטטוס HTTP 5\d\d/.test(detail)) {
    message =
      "האתר לא מגיב או איטי מאוד. נסו שוב בעוד רגע, או בדקו שהאתר פועל.";
  }
  if (hasResume) {
    message += "\n" + RESUME_TEXT;
    buttons = ["resume", ...buttons];
  }
  const tech = [
    message !== raw ? raw : "",
    detail ? `פירוט: ${detail}` : "",
    status ? `סטטוס HTTP: ${status}` : "",
    e?.trail || "",
  ]
    .filter(Boolean)
    .join("\n");
  return { message, tech, buttons };
}
module.exports = { describeError, RESUME_TEXT };
