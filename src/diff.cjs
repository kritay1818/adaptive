"use strict";
// Read-back comparison helpers. WordPress (and the OS) may change line endings, Unicode normalization form or add trailing
// whitespace, so text fields are compared after normalizing exactly those things on BOTH sides; everything else is exact.
const normalizeText = (value) =>
  String(value)
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\s+$/, "");
const sameText = (a, b) =>
  typeof a === "string" && typeof b === "string"
    ? normalizeText(a) === normalizeText(b)
    : a === b;
// Deep equality where strings use sameText.
function normSame(a, b) {
  if (typeof a === "string" || typeof b === "string") return sameText(a, b);
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const ka = Object.keys(a),
    kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every((k) => Object.hasOwn(b, k) && normSame(a[k], b[k]))
  );
}
// Safe, short preview: control characters shown as \n etc., never more than `max` characters.
const preview = (value, max = 40) =>
  JSON.stringify(String(value).slice(0, max)).slice(1, -1) +
  (String(value).length > max ? "…" : "");
// "Field content: expected length 120, got 118; first difference at 57: expected «abc», got «abd»".
function describeMismatch(field, expected, actual) {
  if (typeof expected !== "string" || typeof actual !== "string")
    return `השדה ${field}: ציפינו ל־${preview(JSON.stringify(expected))}, התקבל ${preview(JSON.stringify(actual))}`;
  const a = normalizeText(expected),
    b = normalizeText(actual);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `השדה ${field}: אורך צפוי ${a.length}, התקבל ${b.length}${a === b ? " (זהה אחרי נרמול)" : `; ההבדל הראשון במיקום ${i}: צפוי «${preview(a.slice(i), 30)}», התקבל «${preview(b.slice(i), 30)}»`}`;
}
// Which of `fields` differ between expected and actual objects (normalized), as a Hebrew detail string ("" when equal).
function mismatchDetail(expected, actual, fields) {
  return fields
    .filter((f) => !normSame(expected?.[f], actual?.[f]))
    .map((f) => describeMismatch(f, expected?.[f], actual?.[f]))
    .join("; ");
}
module.exports = {
  normalizeText,
  sameText,
  normSame,
  describeMismatch,
  mismatchDetail,
  preview,
};
