"use strict";
// Plain-Hebrew descriptions of what a verified write did, and where "צפייה באתר" should go. Pure functions, shared by the
// agent (result cards) and main (opening the right place), so the button is only offered when something can be opened.

const quote = (value) => `'${String(value ?? "").trim() || "ללא כותרת"}'`;

// p = the approved pending operation (kind, resource, payload, before); result = what executing it returned.
function doneText(p, result = {}) {
  const title = p.payload?.title ?? p.before?.title ?? result.page?.title;
  const post = p.resource === "posts";
  switch (p.kind) {
    case "upload": {
      const video = String(p.payload?.mime || "").startsWith("video/");
      const name = p.payload?.fileName ? ` (${p.payload.fileName})` : "";
      return `${video ? "הסרטון הועלה" : "התמונה הועלתה"} לספריית המדיה${name}`;
    }
    case "delete-media":
      return "הקובץ נמחק לצמיתות מספריית המדיה";
    case "create":
      return `${post ? "נוצרה טיוטת פוסט" : "נוצרה טיוטה"}: ${quote(title)}`;
    case "update":
      return `${post ? "הפוסט עודכן" : "העמוד עודכן"}: ${quote(title)}`;
    case "trash":
    case "elementor-trash":
      return `${quote(title)} הועבר לפח`;
    case "elementor-create":
      return `נוצרה טיוטת עמוד Elementor: ${quote(title)}`;
    case "elementor-update":
      return `עמוד Elementor עודכן: ${quote(title)}`;
    case "elementor-duplicate":
      return `נוצר עותק טיוטה של ${quote(p.target?.sourceTitle)}: ${quote(title)}`;
    case "elementor-edit":
      return `עמוד Elementor עודכן בשינויים ממוקדים: ${quote(title)}`;
    case "elementor-template-create":
      return `נוצרה תבנית ${result.template?.type || p.target?.templateType || ""} — כדי להציג אותה בכל האתר: פתחו ב-Elementor ← Publish ← Entire Site`;
    case "elementor-template-update":
      return `תבנית ${result.template?.type || p.target?.templateType || ""} עודכנה: ${quote(title)}${result.template?.status === "draft" ? " — כדי להציג אותה בכל האתר: פתחו ב-Elementor ← Publish ← Entire Site" : ""}`;
    case "elementor-template-trash":
      return `תבנית ${quote(title)} הועברה לפח`;
    case "elementor-template-revert":
      return `התוכן הקודם של התבנית ${quote(title)} שוחזר`;
    case "elementor-globals":
      return "הצבעים והגופנים הגלובליים של Elementor עודכנו";
    case "elementor-globals-revert":
      return "הצבעים והגופנים הגלובליים הקודמים שוחזרו";
    case "elementor-revert":
      return `תוכן Elementor הקודם של ${quote(title)} שוחזר`;
    case "publish":
      return `${quote(title)} פורסם לציבור`;
    case "unpublish":
      return `${quote(title)} הוחזר לטיוטה`;
    case "site-logo":
      return "הלוגו הוגדר";
    case "header":
      return "הכותרת העליונה עודכנה";
    case "footer":
      return "התחתית עודכנה";
    case "template-restore":
      return "התבנית הקודמת שוחזרה";
    case "menu":
      return "התפריט הראשי עודכן";
    case "menu-restore":
      return "התפריט הקודם שוחזר";
    case "front-page":
      return "דף הבית הוגדר";
    case "site-identity": {
      const t = p.payload?.title !== undefined,
        d = p.payload?.description !== undefined;
      return t && d
        ? "שם האתר ותיאורו עודכנו"
        : d
          ? "תיאור האתר עודכן"
          : "שם האתר עודכן";
    }
    case "settings-restore":
      return "הגדרות האתר שוחזרו";
    case "site-css":
      return "עיצוב האתר (CSS) עודכן";
    case "css-restore":
      return "העיצוב הקודם של האתר שוחזר";
    default:
      return String(result.text || "הפעולה בוצעה").split("\n")[0];
  }
}

// Verified records of one operation (or of every step of a plan) -> what "צפייה באתר" opens, or null.
//   page  = a created/updated/published page or post   -> that page
//   home  = logo, header, footer, menu, site name, CSS  -> the site's home page
//   media = media-only                                  -> the item in wp-admin (upload.php?item=ID)
const HOME_KINDS = new Set([
  "site-logo",
  "header",
  "footer",
  "menu",
  "front-page",
  "site-identity",
  "site-css",
]);
function viewTarget(rows) {
  const verified = rows.filter((r) => r && r.state === "verified");
  const page = verified.find(
    (r) =>
      [
        "create",
        "update",
        "publish",
        "elementor-create",
        "elementor-update",
        "elementor-duplicate",
        "elementor-edit",
      ].includes(r.kind) &&
      ["pages", "posts"].includes(r.resource) &&
      Number.isSafeInteger(r.page) &&
      r.page > 0,
  );
  if (page) return { type: "page", resource: page.resource, id: page.page };
  if (verified.some((r) => HOME_KINDS.has(r.kind))) return { type: "home" };
  const media = verified.find(
    (r) =>
      r.kind === "upload" &&
      r.resource === "media" &&
      Number.isSafeInteger(r.page) &&
      r.page > 0,
  );
  return media ? { type: "media", id: media.page } : null;
}

// Verified Elementor Theme Builder templates among the records: "פתיחה ב-Elementor" is offered for them.
const TEMPLATE_KINDS = new Set([
  "elementor-template-create",
  "elementor-template-update",
]);
const templateRows = (rows) =>
  rows.filter(
    (r) =>
      r &&
      r.state === "verified" &&
      TEMPLATE_KINDS.has(r.kind) &&
      Number.isSafeInteger(r.page) &&
      r.page > 0,
  );
const editsTemplate = (rows) => templateRows(rows).length > 0;

// What a (possibly unverified) operation was, in plain Hebrew, for the "project is blocked" card.
const KIND_LABELS = {
  create: "יצירת טיוטה",
  update: "עדכון עמוד",
  publish: "פרסום לציבור",
  unpublish: "החזרה לטיוטה",
  trash: "העברה לפח",
  upload: "העלאת מדיה",
  "delete-media": "מחיקת מדיה",
  menu: "עדכון התפריט הראשי",
  "front-page": "הגדרת דף הבית",
  "site-identity": "עדכון שם האתר ותיאורו",
  "site-css": "עדכון עיצוב האתר (CSS)",
  "site-logo": "הגדרת הלוגו",
  header: "עדכון הכותרת העליונה",
  footer: "עדכון התחתית",
  "elementor-create": "יצירת עמוד Elementor",
  "elementor-update": "עדכון עמוד Elementor",
  "elementor-duplicate": "העתקת עמוד Elementor",
  "elementor-edit": "שינויים ממוקדים בעמוד Elementor",
  "elementor-globals": "עדכון צבעים וגופנים גלובליים",
  "elementor-template-create": "יצירת תבנית כותרת/תחתית של Elementor",
  "elementor-template-update": "עדכון תבנית כותרת/תחתית של Elementor",
  "build-plan": "תוכנית בנייה",
};
const kindLabel = (kind) =>
  KIND_LABELS[kind] ||
  (String(kind || "").startsWith("term-")
    ? "שינוי קטגוריה/תגית"
    : String(kind || "").startsWith("item-")
      ? "שינוי פריט תוכן"
      : String(kind || "").startsWith("plugin-")
        ? "שינוי תוסף"
        : "שינוי באתר");
module.exports = {
  doneText,
  viewTarget,
  editsTemplate,
  templateRows,
  kindLabel,
};
