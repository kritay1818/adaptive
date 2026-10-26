"use strict";
// Local diagnostic log: the last 200 network / verification events, redacted, kept in memory and mirrored to a file in the
// user data folder so it survives a restart. Exported by the user ("ייצוא יומן אבחון") to send to support.
// Never stores keys, passwords, cookies, authorization headers or request bodies; long strings are truncated.
const fs = require("node:fs");
const path = require("node:path");
const MAX = 200;
const events = [];
let file = null,
  timer = null;
const SECRET_KEY =
  /pass(?:word)?|secret|token|authori[sz]ation|cookie|api[-_]?key|credential|x-api-key/i;
const SECRET_VALUE =
  /(?:Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+|sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{10,}|[A-Za-z0-9]{4}(?: [A-Za-z0-9]{4}){5}\b/g;
function clean(value, depth = 0) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (typeof value === "string") {
    const redacted = value.replace(SECRET_VALUE, "[redacted]");
    return redacted.length > 160
      ? redacted.slice(0, 160) + `…(+${redacted.length - 160})`
      : redacted;
  }
  if (Array.isArray(value))
    return depth > 3
      ? "[…]"
      : value.slice(0, 12).map((v) => clean(v, depth + 1));
  if (typeof value === "object") {
    if (depth > 3) return "[…]";
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 30)
        .map(([k, v]) => [
          k,
          SECRET_KEY.test(k) ? "[redacted]" : clean(v, depth + 1),
        ]),
    );
  }
  return String(value).slice(0, 80);
}
function flush() {
  timer = null;
  if (!file) return;
  try {
    fs.writeFileSync(file, JSON.stringify(events));
  } catch {
    /* diagnostics must never break the app */
  }
}
function init(dir) {
  file = path.join(dir, "diagnostic-log.json");
  try {
    const old = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(old)) events.splice(0, events.length, ...old.slice(-MAX));
  } catch {
    /* first run */
  }
}
function log(type, data = {}) {
  events.push({
    at: new Date().toISOString(),
    type: String(type).slice(0, 40),
    ...clean(data),
  });
  if (events.length > MAX) events.splice(0, events.length - MAX);
  if (file && !timer) {
    timer = setTimeout(flush, 1000);
    timer.unref?.();
  }
}
function snapshot() {
  return events.slice();
}
function reset() {
  events.length = 0;
}
function exportText(meta = {}) {
  const head = [
    `ADActive diagnostic log (${events.length} events, redacted)`,
    `exported: ${new Date().toISOString()}`,
    ...Object.entries(clean(meta)).map(([k, v]) => `${k}: ${v}`),
    "",
  ];
  return head.concat(events.map((e) => JSON.stringify(e))).join("\n") + "\n";
}

// ---- classification of network errors (used by every WordPress request path) -------------------------------------------
const CERT_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "CERT_REVOKED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_SSL_TLSV1_ALERT_UNKNOWN_CA",
]);
const PHASE_HE = {
  connecting: "בזמן ההתחברות לאתר",
  sending: "בזמן שליחת הבקשה",
  waiting: "בזמן ההמתנה לתשובת האתר",
  reading: "בזמן קריאת התשובה",
};
// e: error from request() (carries .phase/.code/.ms) or a plain error; ctx: { timeoutMs, deadlineHit, userAborted }
function classifyNetworkError(e, ctx = {}) {
  const code = String(e?.code || "");
  const phase = e?.phase || "";
  const where = PHASE_HE[phase] ? ` ${PHASE_HE[phase]}` : "";
  const ms = Number.isFinite(e?.ms)
    ? ` אחרי ${(e.ms / 1000).toFixed(1)} שניות`
    : "";
  if (ctx.userAborted)
    return {
      kind: "abort",
      phase,
      code,
      notSent: false,
      reason: "הפעולה בוטלה או חרגה ממגבלת הזמן הכוללת",
    };
  if (ctx.deadlineHit || e?.name === "AbortError" || e?.name === "TimeoutError")
    return {
      kind: "timeout",
      phase,
      code,
      notSent: phase === "connecting",
      reason: `חריגה ממגבלת הזמן (${Math.round((ctx.timeoutMs || 0) / 1000)} שניות)${where}${ms}`,
    };
  if (
    CERT_CODES.has(code) ||
    /certificate|self.signed|unable to verify/i.test(String(e?.message || ""))
  )
    return {
      kind: "cert",
      phase: "connecting",
      code,
      notSent: true,
      reason: `אימות תעודת האבטחה (TLS) נכשל${code ? ` (${code})` : ""}`,
    };
  if (e?.message === "size")
    return {
      kind: "size",
      phase,
      code,
      notSent: false,
      reason: "תשובת האתר גדולה מהמגבלה",
    };
  if (code)
    return {
      kind: "network",
      phase,
      code,
      notSent: phase === "connecting",
      reason: `שגיאת רשת ${code}${where}${ms}`,
    };
  return {
    kind: "other",
    phase,
    code,
    notSent: false,
    reason: `שגיאה לא מזוהה${where}${ms}`,
  };
}
const CERT_MESSAGE =
  "אימות תעודת האבטחה (TLS) של האתר נכשל. ייתכן שתוכנת אנטי־וירוס או חומת אש מיירטת את חיבור ה־HTTPS, או שהתעודה של האתר פגה או אינה תקינה. לא נשלח ולא נכתב דבר.";
module.exports = {
  init,
  log,
  snapshot,
  reset,
  exportText,
  clean,
  classifyNetworkError,
  CERT_CODES,
  CERT_MESSAGE,
  PHASE_HE,
  MAX,
};
