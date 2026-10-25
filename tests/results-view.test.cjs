"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { doneText, viewTarget } = require("../src/results.cjs");
const markdown = require("../src/ui/markdown.js");

test("each kind of write is described in plain Hebrew", () => {
  const d = (p, r) => doneText(p, r);
  assert.equal(
    d({
      kind: "upload",
      resource: "media",
      payload: { mime: "image/png", fileName: "logo.png" },
    }),
    "התמונה הועלתה לספריית המדיה (logo.png)",
  );
  assert.equal(
    d({
      kind: "upload",
      resource: "media",
      payload: { mime: "video/mp4", fileName: "v.mp4" },
    }),
    "הסרטון הועלה לספריית המדיה (v.mp4)",
  );
  assert.equal(d({ kind: "site-logo" }), "הלוגו הוגדר");
  assert.equal(
    d({ kind: "create", resource: "pages", payload: { title: "אודות" } }),
    "נוצרה טיוטה: 'אודות'",
  );
  assert.equal(
    d({ kind: "create", resource: "posts", payload: { title: "חדשות" } }),
    "נוצרה טיוטת פוסט: 'חדשות'",
  );
  assert.equal(
    d({
      kind: "update",
      resource: "pages",
      before: { title: "בית" },
      payload: {},
    }),
    "העמוד עודכן: 'בית'",
  );
  assert.equal(d({ kind: "header" }), "הכותרת העליונה עודכנה");
  assert.equal(d({ kind: "footer" }), "התחתית עודכנה");
  assert.equal(d({ kind: "menu" }), "התפריט הראשי עודכן");
  assert.equal(d({ kind: "front-page" }), "דף הבית הוגדר");
  assert.equal(
    d({ kind: "site-identity", payload: { title: "x" } }),
    "שם האתר עודכן",
  );
  assert.equal(
    d({ kind: "site-identity", payload: { title: "x", description: "y" } }),
    "שם האתר ותיאורו עודכנו",
  );
  assert.equal(d({ kind: "site-css" }), "עיצוב האתר (CSS) עודכן");
  assert.equal(
    d({
      kind: "publish",
      payload: { status: "publish" },
      before: { title: "בית" },
    }),
    "'בית' פורסם לציבור",
  );
});

test("צפייה באתר only exists when there is something to open", () => {
  const ok = (r) => ({ state: "verified", ...r });
  // page / post steps -> that page
  assert.deepEqual(
    viewTarget([ok({ kind: "create", resource: "pages", page: 12 })]),
    { type: "page", resource: "pages", id: 12 },
  );
  assert.deepEqual(
    viewTarget([
      ok({ kind: "upload", resource: "media", page: 5 }),
      ok({ kind: "update", resource: "posts", page: 9 }),
    ]),
    { type: "page", resource: "posts", id: 9 },
  );
  // logo, header, footer, menu, site name, CSS -> the home page (even next to a media upload)
  for (const kind of [
    "site-logo",
    "header",
    "footer",
    "menu",
    "front-page",
    "site-identity",
    "site-css",
  ])
    assert.deepEqual(
      viewTarget([ok({ kind, resource: "x" })]),
      { type: "home" },
      kind,
    );
  assert.deepEqual(
    viewTarget([
      ok({ kind: "upload", resource: "media", page: 5 }),
      ok({ kind: "site-logo", resource: "settings" }),
    ]),
    { type: "home" },
  );
  // media-only -> the media item
  assert.deepEqual(
    viewTarget([ok({ kind: "upload", resource: "media", page: 77 })]),
    { type: "media", id: 77 },
  );
  // nothing to open: undo/restore/trash/delete, unverified rows, missing ids
  assert.equal(
    viewTarget([ok({ kind: "trash", resource: "pages", page: 3 })]),
    null,
  );
  assert.equal(
    viewTarget([ok({ kind: "delete-media", resource: "media", page: 3 })]),
    null,
  );
  assert.equal(
    viewTarget([
      ok({ kind: "menu-restore" }),
      ok({ kind: "css-restore" }),
      ok({ kind: "settings-restore" }),
    ]),
    null,
  );
  assert.equal(
    viewTarget([
      { state: "unknown", kind: "create", resource: "pages", page: 1 },
      { state: "cancelled", kind: "site-logo" },
    ]),
    null,
  );
  assert.equal(
    viewTarget([ok({ kind: "create", resource: "pages" })]),
    null,
    "a create without a page id cannot be opened",
  );
  assert.equal(viewTarget([]), null);
});

const text = (nodes) =>
  nodes
    .map((n) =>
      n.t === "text"
        ? n.text
        : n.t === "code"
          ? "`" + n.text + "`"
          : `<${n.t}>${text(n.children)}</${n.t}>`,
    )
    .join("");
const flat = (md) =>
  markdown
    .parse(md)
    .map((b) =>
      b.type === "p"
        ? "p:" + b.lines.map(text).join("|")
        : b.type + ":" + b.items.map(text).join("|"),
    );

test("markdown: bold, italic, code, lists and line breaks; everything else stays literal", () => {
  assert.deepEqual(flat("**מודגש** ו*נטוי* ו`קוד`"), [
    "p:<strong>מודגש</strong> ו<em>נטוי</em> ו`קוד`",
  ]);
  assert.deepEqual(flat("1. ראשון\n2. **שני**\n3) שלישי"), [
    "ol:ראשון|<strong>שני</strong>|שלישי",
  ]);
  assert.deepEqual(flat("- א\n* ב\n• ג"), ["ul:א|ב|ג"]);
  assert.deepEqual(flat("שורה אחת\nשורה שנייה\n\nפסקה חדשה"), [
    "p:שורה אחת|שורה שנייה",
    "p:פסקה חדשה",
  ]);
  assert.deepEqual(flat("מבוא:\n- פריט\n- עוד\nסיום"), [
    "p:מבוא:",
    "ul:פריט|עוד",
    "p:סיום",
  ]);
  assert.deepEqual(flat("snake_case_name"), ["p:snake_case_name"]);
  // Code content is not interpreted; unsupported syntax is just text.
  assert.deepEqual(flat("`**לא מודגש**`"), ["p:`**לא מודגש**`"]);
  assert.deepEqual(
    flat("# כותרת\n[קישור](javascript:alert(1))\n![x](http://e.x/a.png)"),
    ["p:# כותרת|[קישור](javascript:alert(1))|![x](http://e.x/a.png)"],
  );
});

test("markdown render builds only text and a few safe elements (no HTML from the model)", () => {
  const made = [];
  const doc = {
    createElement: (tag) => {
      const el = {
        tag,
        children: [],
        className: "",
        dir: "",
        append(...c) {
          this.children.push(...c);
        },
        set textContent(v) {
          this.children.push({ text: v });
        },
      };
      made.push(el);
      return el;
    },
    createTextNode: (text) => ({ text }),
  };
  markdown.render(
    doc,
    "<img src=x onerror=alert(1)> **b** <script>x</script>\n- <b>item</b>",
  );
  assert.ok(
    made.every((el) =>
      ["div", "p", "br", "strong", "em", "code", "ul", "ol", "li"].includes(
        el.tag,
      ),
    ),
    made.map((e) => e.tag).join(),
  );
  assert.ok(
    JSON.stringify(made).includes("<img src=x onerror=alert(1)>"),
    "model HTML stays as literal text nodes",
  );
});
