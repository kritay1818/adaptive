"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { safeHTML, safeTemplateHTML } = require("../src/wp-content.cjs");
const { checkCss } = require("../src/wp-structure.cjs");
const { argumentsFor } = require("../src/wp-agent.cjs");
const { validatePlan, normalizePlan } = require("../src/wp-plans.cjs");
const kit = require("../src/design-kit/index.cjs");

const IMG = "https://images.example/a.jpg";
const items = (n, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    title: `כותרת ${i + 1}`,
    text: `טקסט קצר מספר ${i + 1} & עוד <b>`,
    ...extra,
  }));
// Realistic sample data for every pattern (Hebrew, entities, refs).
const SAMPLES = {
  "hero-image": {
    heading: "המספרה של דנה",
    subheading: "תספורת מקצועית בלב תל אביב",
    buttonLabel: "קבעו תור",
    buttonUrl: "/contact/",
    imageUrl: "{{hero.url}}",
    imageId: "{{hero.id}}",
    alt: "מספרה",
  },
  "hero-simple": {
    heading: "ברוכים הבאים",
    subheading: "שורה אחת",
    buttonLabel: "התקשרו",
    buttonUrl: "tel:+972-3-123-4567",
  },
  "text-image": {
    heading: "קצת עלינו",
    paragraphs: ["פסקה ראשונה.", "פסקה שנייה."],
    imageUrl: IMG,
    imageId: 42,
    alt: "צוות",
    imageSide: "right",
    buttonLabel: "עוד",
    buttonUrl: "https://example.com/about",
  },
  "services-grid": {
    heading: "השירותים שלנו",
    text: "מה אנחנו עושים",
    items: items(3, { imageUrl: IMG, imageId: 7, alt: "אייקון" }),
  },
  "features-list": { heading: "למה אנחנו", items: items(5) },
  testimonials: {
    heading: "לקוחות מספרים",
    items: [
      { quote: "שירות מעולה", name: "רונית", role: "לקוחה" },
      { quote: "ממליץ", name: "יוסי" },
    ],
  },
  "cta-band": {
    heading: "מוכנים?",
    text: "דברו איתנו",
    buttonLabel: "צרו קשר",
    buttonUrl: "mailto:info@salon.co.il?subject=שלום",
  },
  "contact-details": {
    heading: "יצירת קשר",
    items: [
      { label: "טלפון", value: "03-123-4567", url: "tel:031234567" },
      { label: "כתובת", value: "דיזנגוף 1, תל אביב" },
      {
        label: "אימייל",
        value: "info@salon.co.il",
        url: "mailto:info@salon.co.il",
      },
    ],
    buttonLabel: "קבעו תור",
    buttonUrl: "/book/",
  },
  header: {
    logoWidth: 140,
    showTitle: true,
    menuKey: "menu",
    links: [{ label: "התקשרו", url: "tel:+972501234567" }],
  },
  footer: {
    paragraphs: ["כל הזכויות שמורות"],
    links: [{ label: "אודות", url: "/about/" }],
    contacts: [{ label: "טלפון", url: "tel:031234567" }],
    social: [{ service: "facebook", url: "https://facebook.com/salon" }],
    copyright: "© 2026",
  },
};
const resolve = (html) =>
  html
    .replaceAll("{{hero.url}}", IMG)
    .replaceAll("{{hero.id}}", "42")
    .replaceAll("{{menu.id}}", "7");

test("there are about ten patterns and every one has sample data", () => {
  assert.deepEqual(
    Object.keys(kit.PATTERNS).sort(),
    Object.keys(SAMPLES).sort(),
  );
  assert.ok(Object.keys(kit.PATTERNS).length >= 10);
});

for (const [name, data] of Object.entries(SAMPLES))
  test(`pattern ${name} renders markup that passes our validator`, () => {
    const html = resolve(kit.renderPattern(name, data));
    if (kit.PATTERNS[name].template) assert.equal(safeTemplateHTML(html), html);
    else {
      assert.equal(safeHTML(html), html);
      assert.throws(() =>
        safeHTML(html.replace(/class="/, 'onclick="x" class="')),
      );
    }
    // Text is escaped, never injected as markup, and no placeholder wording appears.
    assert.ok(!/<script|onerror|javascript:/i.test(html));
  });

test("page and template steps expand through the plan machinery and pass plan validation", () => {
  const steps = [
    {
      key: "hero",
      tool: "wp_prepare_upload_image",
      args: { url: IMG, fileName: "hero.jpg", alt: "מספרה" },
    },
    {
      key: "css",
      tool: "wp_prepare_site_css",
      args: {
        brand: { primary: "#0b5ed7", accent: "#e4572e", fontHeading: "Heebo" },
        extraCss: ".ad-hero h1{letter-spacing:0}",
      },
    },
    {
      key: "home",
      tool: "wp_prepare_create_page",
      args: {
        title: "בית",
        sections: [
          { pattern: "hero-image", data: SAMPLES["hero-image"] },
          { pattern: "services-grid", data: SAMPLES["services-grid"] },
          { pattern: "cta-band", data: SAMPLES["cta-band"] },
        ],
      },
    },
    {
      key: "menu",
      tool: "wp_prepare_menu",
      args: { title: "ראשי", links: [{ pageId: "{{home.id}}", label: "בית" }] },
    },
    {
      key: "top",
      tool: "wp_prepare_header",
      args: { pattern: "header", data: SAMPLES.header },
    },
    {
      key: "bottom",
      tool: "wp_prepare_footer",
      args: { pattern: "footer", data: SAMPLES.footer },
    },
  ];
  const plan = normalizePlan({ title: "אתר", steps });
  assert.ok(
    plan.steps.every(
      (s) =>
        !("sections" in s.args) &&
        !("brand" in s.args) &&
        !("pattern" in s.args),
    ),
  );
  assert.ok(validatePlan(plan, argumentsFor));
  assert.match(plan.steps[1].args.css, /--ad-primary:#0b5ed7/);
  assert.match(plan.steps[1].args.css, /ad-hero h1\{letter-spacing:0\}/);
});

test("the base stylesheet and brand CSS pass the CSS sanitizer and stay small", () => {
  const css = kit.kitCss(
    {
      primary: "#123456",
      accent: "rgb(228, 87, 46)",
      fontBody: "Assistant",
      radius: "8px",
    },
    ".x{margin:0}",
  );
  assert.equal(checkCss(css, "salon.co.il"), css);
  assert.ok(Buffer.byteLength(css) < 12 * 1024, "base kit should stay compact");
  for (const needle of [
    "--ad-primary",
    "html[dir=rtl]",
    "max-width:781px",
    "site-hero",
    "clamp(",
  ])
    assert.ok(css.includes(needle), needle);
});

test("bad input is rejected with a specific Hebrew reason", () => {
  assert.throws(
    () => kit.renderPattern("hero-image", { heading: "x", imageUrl: IMG }),
    /imageId/,
  );
  assert.throws(
    () =>
      kit.renderPattern("hero-image", {
        ...SAMPLES["hero-image"],
        imageUrl: "http://a.b/x.jpg",
      }),
    /imageUrl/,
  );
  assert.throws(
    () => kit.renderPattern("services-grid", { items: items(2) }),
    /items.*3–5/,
  );
  assert.throws(
    () =>
      kit.renderPattern("text-image", {
        ...SAMPLES["text-image"],
        imageSide: "up",
      }),
    /imageSide/,
  );
  assert.throws(
    () =>
      kit.renderPattern("cta-band", {
        ...SAMPLES["cta-band"],
        buttonUrl: "javascript:alert(1)",
      }),
    /buttonUrl/,
  );
  assert.throws(
    () =>
      kit.renderPattern("cta-band", {
        ...SAMPLES["cta-band"],
        buttonUrl: "//evil.com",
      }),
    /buttonUrl/,
  );
  assert.throws(() => kit.renderPattern("nope", {}), /תבנית לא מוכרת/);
  assert.throws(() => kit.kitCss({ primary: "red; background:url(x)" }), /צבע/);
  assert.throws(() => kit.kitCss({ fontBody: "x;y" }), /פונט/);
  assert.throws(() => kit.kitCss({ evil: "1" }), /לא מוכר/);
  assert.throws(() => kit.kitCss({}, "a".repeat(3073)), /3072/);
  assert.throws(
    () =>
      kit.expandStep({
        tool: "wp_prepare_create_page",
        args: { title: "x", sections: [{ pattern: "header", data: {} }] },
      }),
    /כותרת\/תחתית/,
  );
  assert.throws(
    () =>
      kit.expandStep({
        tool: "wp_prepare_create_page",
        args: {
          title: "x",
          content: "<p>x</p>",
          sections: [{ pattern: "cta-band", data: SAMPLES["cta-band"] }],
        },
      }),
    /content או sections/,
  );
});

test("hostile text is escaped, not interpreted", () => {
  const html = kit.renderPattern("cta-band", {
    heading: '<img src=x onerror=alert(1)> "q" & more',
    buttonLabel: "<b>go</b>",
    buttonUrl: "/x/",
  });
  assert.ok(!html.includes("<img src=x"));
  assert.equal(safeHTML(html), html);
});
