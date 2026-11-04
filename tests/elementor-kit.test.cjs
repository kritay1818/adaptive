"use strict";
// Elementor design kit: every pattern, filled with realistic Hebrew data, passes the Elementor validator and builder, uses global
// color/font references, stacks on mobile and is right-aligned for Hebrew.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  PATTERNS,
  PATTERN_NAMES,
  expandPatterns,
  DEFAULT_PALETTE,
} = require("../src/elementor-kit/index.cjs");
const {
  validateElementor,
  buildElementorData,
  checkBuilt,
  collect,
} = require("../src/wp-elementor.cjs");

const TOOL = "wp_prepare_elementor_page";
const items3 = [
  {
    title: "ייעוץ ראשוני",
    text: "פגישה קצרה שבה מבינים את הצרכים שלכם.",
    buttonText: "לפרטים",
    url: "/services/",
  },
  {
    title: "בנייה והטמעה",
    text: "אנחנו בונים ומטמיעים את הפתרון המלא.",
    mediaId: 42,
  },
  { title: "ליווי שוטף", text: "תמיכה וליווי גם אחרי ההשקה." },
];
const DATA = {
  "hero-image": {
    eyebrow: "סטודיו לעיצוב",
    title: "בונים אתרים שעובדים בשבילכם",
    subtitle: "מהרעיון ועד ההשקה",
    text: "אנחנו מלווים עסקים קטנים.",
    buttonText: "לשיחת ייעוץ",
    buttonUrl: "/contact/",
    secondaryText: "הפרויקטים שלנו",
    secondaryUrl: "/projects/",
    mediaId: 42,
  },
  "hero-simple": {
    title: "ברוכים הבאים",
    subtitle: "כל מה שצריך במקום אחד",
    buttonText: "התחילו",
    buttonUrl: "/start/",
    tone: "dark",
  },
  "text-image": {
    eyebrow: "אודות",
    title: "מי אנחנו",
    text: "צוות קטן עם ניסיון רב.\n\nמאז 2015 בונים אתרים.",
    buttonText: "קראו עוד",
    buttonUrl: "/about/",
    mediaId: 42,
    reverse: true,
  },
  "services-cards": {
    eyebrow: "השירותים",
    title: "מה אנחנו עושים",
    subtitle: "שלוש דרכים לעבוד איתנו",
    items: items3,
  },
  "features-list": {
    title: "למה אנחנו",
    text: "היתרונות שלנו:",
    items: [
      { title: "מהירות", text: "אתר מהיר" },
      { title: "שירות אישי" },
      { text: "מחירים הוגנים" },
    ],
  },
  testimonials: {
    title: "מה אומרים עלינו",
    items: [
      { text: "שירות מעולה ומקצועי", name: "דנה כהן", role: "בעלת עסק" },
      { text: "ממליץ בחום", name: "יוסי לוי" },
    ],
  },
  "cta-band": {
    title: "מוכנים להתחיל?",
    subtitle: "דברו איתנו היום",
    buttonText: "צרו קשר",
    buttonUrl: "/contact/",
  },
  "contact-details": {
    title: "צרו קשר",
    contacts: [
      { type: "phone", label: "טלפון", value: "050-123-4567" },
      { type: "email", value: "info@example.com" },
      { type: "address", label: "כתובת", value: "הרצל 1, תל אביב" },
      { type: "hours", value: "א׳–ה׳ 9:00–17:00" },
      { type: "whatsapp", value: "972501234567" },
    ],
    mediaId: 42,
  },
  faq: {
    title: "שאלות נפוצות",
    faq: [
      {
        question: "כמה זמן לוקח לבנות אתר?",
        answer: "בדרך כלל 3–4 שבועות.\n\nתלוי בהיקף.",
      },
      { question: "האם יש תמיכה?", answer: "כן, ליווי שוטף." },
    ],
  },
  "footer-section": {
    title: "ADActive",
    text: "בונים אתרים בקלות.",
    links: [
      { text: "בית", url: "/" },
      { text: "צרו קשר", url: "/contact/" },
    ],
    contacts: [
      { type: "phone", value: "050-123-4567" },
      { type: "email", value: "info@example.com" },
    ],
    copyright: "© 2026 כל הזכויות שמורות",
  },
};
const mediaFor = (args) =>
  new Map(
    collect(args).media.map((id) => [
      id,
      {
        id,
        url: `https://public.example/wp-content/uploads/${id}.png`,
        alt: "",
      },
    ]),
  );
const walk = (list, fn) =>
  list.forEach((el) => (fn(el), walk(el.elements || [], fn)));

test("the kit has the ten expected patterns", () => {
  assert.deepEqual(
    PATTERN_NAMES.sort(),
    [
      "contact-details",
      "cta-band",
      "faq",
      "features-list",
      "footer-section",
      "hero-image",
      "hero-simple",
      "services-cards",
      "testimonials",
      "text-image",
    ].sort(),
  );
  for (const name of PATTERN_NAMES)
    assert.ok(DATA[name], `sample data for ${name}`);
});

for (const name of Object.keys(DATA)) {
  test(`${name}: passes the Elementor validator and builder, global references, mobile and RTL settings`, () => {
    const args = validateElementor(TOOL, {
      title: "x",
      patterns: [{ pattern: name, data: DATA[name] }],
    });
    assert.ok(args.containers.length >= 1);
    const data = buildElementorData(args, { rtl: true, media: mediaFor(args) });
    assert.doesNotThrow(() =>
      checkBuilt(data, { rtl: true }, "https://public.example"),
    );
    let globals = 0,
      rows = 0,
      widgets = 0;
    walk(data, (el) => {
      if (el.settings.__globals__) globals++;
      if (el.elType === "container" && el.settings.flex_direction === "row") {
        rows++;
        assert.equal(
          el.settings.flex_direction_mobile,
          "column",
          "rows stack on mobile",
        );
      }
      if (el.elType === "container" && el.settings.width) {
        assert.equal(
          el.settings.width_mobile.size,
          100,
          "columns/cards are full width on mobile",
        );
      }
      if (el.elType === "container" && el.settings.padding)
        assert.ok(el.settings.padding_mobile, "paddings shrink on mobile");
      if (
        el.elType === "widget" &&
        ["heading", "text-editor", "button"].includes(el.widgetType)
      ) {
        widgets++;
        assert.equal(
          el.settings.align === "right" || el.settings.align === "center",
          true,
          "RTL: right (or centered) alignment",
        );
      }
    });
    assert.ok(
      globals > 0,
      "uses global color/font references instead of hard-coded values",
    );
    assert.ok(widgets > 0);
    // The same pattern with the hex palette (site without global colors) has no global references at all.
    const plain = validateElementor(
      TOOL,
      { title: "x", patterns: [{ pattern: name, data: DATA[name] }] },
      { palette: DEFAULT_PALETTE },
    );
    const hex = buildElementorData(plain, {
      rtl: true,
      media: mediaFor(plain),
    });
    walk(hex, (el) => assert.equal(el.settings.__globals__, undefined));
    assert.ok(
      Object.values(DEFAULT_PALETTE).some((c) =>
        JSON.stringify(hex).includes(c),
      ),
    );
    // Deterministic: the same data gives the same JSON.
    assert.equal(
      JSON.stringify(data),
      JSON.stringify(
        buildElementorData(args, { rtl: true, media: mediaFor(args) }),
      ),
    );
  });
}

test("hero-image has a background image with an overlay, a minimum height that shrinks on phones", () => {
  const args = validateElementor(TOOL, {
    title: "x",
    patterns: [{ pattern: "hero-image", data: DATA["hero-image"] }],
  });
  const [hero] = buildElementorData(args, { rtl: true, media: mediaFor(args) });
  assert.equal(hero.settings.background_image.id, 42);
  assert.equal(hero.settings.background_size, "cover");
  assert.equal(hero.settings.background_overlay_opacity.size, 0.65);
  assert.ok(hero.settings.min_height_mobile.size <= 420);
  assert.equal(
    hero.elements.some(
      (e) => e.widgetType === "heading" && e.settings.header_size === "h1",
    ),
    true,
  );
  assert.ok(
    hero.elements.find(
      (e) => e.widgetType === "heading" && e.settings.header_size === "h1",
    ).settings.typography_font_size_mobile.size < 46,
    "the big title shrinks on phones",
  );
});

test("patterns combine with free-form additions (appended after the patterns)", () => {
  const args = validateElementor(TOOL, {
    title: "x",
    patterns: [{ pattern: "cta-band", data: DATA["cta-band"] }],
    containers: [{ children: [{ type: "spacer", height: 20 }] }],
  });
  assert.equal(args.containers.length, 2);
  assert.equal(args.containers[1].children[0].type, "spacer");
});

test("pattern data errors are explained in Hebrew and nothing unknown slips through", () => {
  const bad = (pattern, data, re) =>
    assert.throws(
      () =>
        validateElementor(TOOL, { title: "x", patterns: [{ pattern, data }] }),
      re,
      pattern,
    );
  bad("hero-image", { title: "x" }, /mediaId/);
  bad("hero-image", { mediaId: 1 }, /title/);
  bad("services-cards", { items: items3.slice(0, 2) }, /3 עד 5/);
  bad("services-cards", { items: [...items3, ...items3] }, /3 עד 5/);
  bad("testimonials", { items: [] }, /1 עד 4/);
  bad("cta-band", { title: "x", buttonText: "go" }, /buttonUrl/);
  bad("hero-simple", { title: "x", buttonText: "go" }, /כתובת/);
  bad(
    "contact-details",
    { title: "x", contacts: [{ type: "fax", value: "1" }] },
    /type/,
  );
  bad("faq", { faq: [{ question: "?" }] }, /answer|תשובה/);
  bad("not-a-pattern", {}, /לא מוכרת/);
  bad("hero-simple", { title: "x", onclick: "alert(1)" }, /onclick/);
  bad(
    "hero-simple",
    { title: "x", buttonText: "go", buttonUrl: "javascript:alert(1)" },
    /javascript/,
  );
  bad("hero-simple", { title: "<b>x</b>" }, /טקסט רגיל/);
  bad(
    "text-image",
    { title: "x", text: "[gallery]", mediaId: 1 },
    /shortcode|טקסט/,
  );
  assert.throws(
    () =>
      expandPatterns(
        Array.from({ length: 13 }, () => ({
          pattern: "cta-band",
          data: DATA["cta-band"],
        })),
      ),
    /12/,
  );
});

test("user text is escaped, never trusted as HTML", () => {
  const args = validateElementor(TOOL, {
    title: "x",
    patterns: [
      {
        pattern: "text-image",
        data: { title: "x", text: "a < b & c > d", mediaId: 1 },
      },
    ],
  });
  const html = JSON.stringify(args);
  assert.ok(html.includes("a &lt; b &amp; c &gt; d"));
  assert.ok(!/<script|onerror/i.test(html));
});
for (const [name, def] of Object.entries(PATTERNS))
  test(`${name} has a Hebrew label`, () => assert.match(def.label, /[֐-׿]/));

test("hero-simple picks white or dark text by the background's brightness", () => {
  const hero = (palette, values, tone) =>
    expandPatterns(
      [{ pattern: "hero-simple", data: { title: "כותרת", tone } }],
      { palette, values },
    )[0];
  // Dark primary: white title. Light primary: dark title.
  assert.equal(
    hero({ primary: "#1F3A5F" }, null, "dark").children[0].color,
    "#ffffff",
  );
  assert.equal(
    hero({ primary: "#FFE08A" }, null, "dark").children[0].color,
    "#0b1220",
  );
  // Global references: the read values decide; an unknown value falls back to the kit's own dark background with white text.
  assert.equal(
    hero(null, { primary: "#FFE08A" }, "dark").children[0].color,
    "#0b1220",
  );
  const unknown = hero(null, null, "dark");
  assert.equal(unknown.background, "#0b1220");
  assert.equal(unknown.children[0].color, "#ffffff");
});
