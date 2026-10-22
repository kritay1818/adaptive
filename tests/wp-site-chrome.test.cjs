"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { safeHTML, safeTemplateHTML } = require("../src/wp-content.cjs");
const { argumentsFor } = require("../src/wp-agent.cjs");
const { validatePlan } = require("../src/wp-plans.cjs");
const { checkImportOrder, checkImportRefs } = require("../src/wp-import.cjs");

const header = `<!-- wp:group {"layout":{"type":"flex","justifyContent":"space-between"}} --><div class="wp-block-group"><!-- wp:site-logo {"width":120} /--><!-- wp:site-title {"level":0} /--><!-- wp:navigation {"ref":{{menu.id}}} /--><!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="tel:+972501234567">התקשרו</a></div><!-- /wp:button --></div><!-- /wp:buttons --></div><!-- /wp:group -->`;
const footer = `<!-- wp:group --><div class="wp-block-group"><!-- wp:paragraph --><p>כל הזכויות שמורות</p><!-- /wp:paragraph --><!-- wp:social-links {"openInNewTab":true} --><ul class="wp-block-social-links"><!-- wp:social-link {"url":"https://facebook.com/salon","service":"facebook"} /--><!-- wp:social-link {"url":"https://instagram.com/salon","service":"instagram"} /--></ul><!-- /wp:social-links --></div><!-- /wp:group -->`;
const real = (s) => s.replaceAll("{{menu.id}}", "7");

test("template parts allow the site blocks; page content does not", () => {
  assert.equal(safeTemplateHTML(real(header)), real(header));
  assert.equal(safeTemplateHTML(footer), footer);
  assert.throws(() => safeHTML(real(header)), /wp:site-logo/);
  assert.throws(() => safeHTML(footer), /wp:social-links/);
});

test("template site blocks stay strict: navigation by ref only, https social links, no extras", () => {
  for (const bad of [
    '<!-- wp:navigation {"ref":7} --><!-- wp:navigation-link {"label":"x","url":"https://a.b"} /--><!-- /wp:navigation -->',
    '<!-- wp:navigation {"ref":"7"} /-->',
    '<!-- wp:navigation {"ref":7,"onload":"x"} /-->',
    '<!-- wp:social-link {"url":"http://facebook.com/x","service":"facebook"} /-->',
    '<!-- wp:social-link {"url":"javascript:alert(1)","service":"facebook"} /-->',
    '<!-- wp:social-link {"url":"https://facebook.com/x","service":"evil"} /-->',
    '<!-- wp:site-logo {"width":"100%"} /-->',
    '<!-- wp:site-logo {"url":"https://a.b/x.png"} /-->',
    "<!-- wp:html --><p>x</p><!-- /wp:html -->",
    '<!-- wp:site-title {"level":9} /-->',
  ])
    assert.throws(() => safeTemplateHTML(bad), undefined, bad);
});

test("site chrome tools validate, and plan references are restricted", () => {
  assert.deepEqual(argumentsFor("wp_prepare_site_logo", { mediaId: 42 }), {
    mediaId: 42,
  });
  assert.throws(() => argumentsFor("wp_prepare_site_logo", { mediaId: 0 }));
  assert.throws(() =>
    argumentsFor("wp_prepare_header", { content: "<script>x</script>" }),
  );
  const up = (key) => ({
    key,
    tool: "wp_prepare_upload_image",
    args: {
      url: "https://images.example/logo.png",
      fileName: "logo.png",
      alt: "לוגו",
    },
  });
  const steps = [
    up("logo"),
    {
      key: "mark",
      tool: "wp_prepare_site_logo",
      args: { mediaId: "{{logo.id}}" },
    },
    {
      key: "home",
      tool: "wp_prepare_create_page",
      args: {
        title: "בית",
        content:
          "<!-- wp:paragraph --><p>ברוכים הבאים</p><!-- /wp:paragraph -->",
      },
    },
    {
      key: "menu",
      tool: "wp_prepare_menu",
      args: { title: "ראשי", links: [{ pageId: "{{home.id}}", label: "בית" }] },
    },
    { key: "top", tool: "wp_prepare_header", args: { content: header } },
    { key: "bottom", tool: "wp_prepare_footer", args: { content: footer } },
    {
      key: "front",
      tool: "wp_prepare_front_page",
      args: { pageId: "{{home.id}}" },
    },
  ];
  assert.ok(validatePlan({ title: "ייבוא", steps }, argumentsFor));
  const swap = (i, patch) =>
    steps.map((s, n) => (n === i ? { ...s, ...patch } : s));
  // The navigation ref must come from the menu step; a page cannot reference the menu; the logo only from an upload.
  assert.throws(
    () =>
      validatePlan(
        {
          title: "x",
          steps: swap(4, {
            args: { content: header.replace("{{menu.id}}", "{{home.id}}") },
          }),
        },
        argumentsFor,
      ),
    /ממתפריט|מתפריט|תפריט/,
  );
  assert.throws(() =>
    validatePlan(
      {
        title: "x",
        steps: swap(2, {
          args: {
            title: "בית",
            content:
              "<!-- wp:paragraph --><p>{{menu.id}}</p><!-- /wp:paragraph -->",
          },
        }),
      },
      argumentsFor,
    ),
  );
  assert.throws(() =>
    validatePlan(
      { title: "x", steps: swap(1, { args: { mediaId: "{{home.id}}" } }) },
      argumentsFor,
    ),
  );
  assert.throws(() =>
    validatePlan(
      {
        title: "x",
        steps: [
          ...steps,
          {
            key: "again",
            tool: "wp_prepare_header",
            args: { content: header },
          },
        ],
      },
      argumentsFor,
    ),
  );
});

test("import plan order: CSS, pages, menu, header, footer, front page; uploads, logo and site name are free", () => {
  const t = (tool) => ({ tool });
  checkImportOrder(
    [
      "wp_prepare_site_css",
      "wp_prepare_upload_image",
      "wp_prepare_site_logo",
      "wp_prepare_create_page",
      "wp_prepare_menu",
      "wp_prepare_header",
      "wp_prepare_footer",
      "wp_prepare_front_page",
    ].map(t),
  );
  // Free steps may be added late (e.g. after the header), because a draft can only be appended to.
  checkImportOrder(
    [
      "wp_prepare_create_page",
      "wp_prepare_menu",
      "wp_prepare_header",
      "wp_prepare_site_identity",
      "wp_prepare_upload_image",
      "wp_prepare_site_logo",
    ].map(t),
  );
  assert.throws(
    () => checkImportOrder([t("wp_prepare_menu"), t("wp_prepare_create_page")]),
    /סדר/,
  );
  assert.throws(
    () => checkImportOrder([t("wp_prepare_header"), t("wp_prepare_menu")]),
    /סדר/,
  );
  assert.throws(
    () => checkImportOrder([t("wp_prepare_footer"), t("wp_prepare_header")]),
    /סדר/,
  );
  assert.throws(
    () => checkImportOrder([t("wp_prepare_menu"), t("wp_prepare_menu")]),
    /אחד בלבד/,
  );
  assert.throws(
    () =>
      checkImportOrder([
        t("wp_prepare_site_identity"),
        t("wp_prepare_site_identity"),
      ]),
    /אחד בלבד/,
  );
  assert.throws(() => checkImportOrder([t("wp_prepare_update_page")]));
  assert.throws(
    () =>
      checkImportRefs([{ tool: "wp_prepare_site_logo", args: { mediaId: 5 } }]),
    /הפניה/,
  );
  assert.throws(
    () =>
      checkImportRefs([{ tool: "wp_prepare_front_page", args: { pageId: 5 } }]),
    /הפניה/,
  );
  checkImportRefs([
    { tool: "wp_prepare_site_logo", args: { mediaId: "{{logo.id}}" } },
    { tool: "wp_prepare_front_page", args: { pageId: "{{home.id}}" } },
  ]);
});

test("a full-site import on a block theme is refused until site name, logo, header and footer are in the plan", async () => {
  const { SiteImporter } = require("../src/wp-import.cjs");
  const reached = new Error("REACHED");
  const agent = {
    now: () => 1000,
    fingerprint: () => "fp",
    structure: {
      theme: async () => ({ block: true }),
      cssSnapshot: async () => ({ snapshot: { css: "" } }),
    },
    plans: {
      prepare: async () => {
        throw reached;
      },
    },
    pending: new Map(),
    progress() {},
    saveResume() {},
  };
  const importer = new SiteImporter(agent, null);
  importer.sources.set("p", {
    token: "11111111-1111-1111-1111-111111111111",
    fingerprint: "fp",
    expires: 1e12,
    images: new Set(["https://i.example/logo.png"]),
    urls: [],
    source: "https://s.example/",
    report: "",
    pass: {},
    passNumber: 1,
    menuPages: [],
    graphics: new Map(),
  });
  importer.scans.set("p", {
    pages: [
      {
        chrome: {
          header: {
            siteName: "המספרה של דנה",
            logo: { url: "https://i.example/logo.png" },
          },
        },
      },
    ],
  });
  const base = [
    {
      key: "home",
      tool: "wp_prepare_create_page",
      args: {
        title: "בית",
        content: "<!-- wp:paragraph --><p>שלום</p><!-- /wp:paragraph -->",
      },
    },
    {
      key: "menu",
      tool: "wp_prepare_menu",
      args: { title: "ראשי", links: [{ pageId: "{{home.id}}", label: "בית" }] },
    },
  ];
  const run = (steps) =>
    importer.prepare(
      "p",
      {
        sourceToken: "11111111-1111-1111-1111-111111111111",
        title: "ייבוא",
        steps,
      },
      new AbortController().signal,
    );
  await assert.rejects(
    run(base),
    (e) =>
      /חסרים שלבים/.test(e.message) &&
      /המספרה של דנה/.test(e.message) &&
      /לוגו/.test(e.message) &&
      /wp_prepare_header/.test(e.message) &&
      /wp_prepare_footer/.test(e.message),
  );
  const full = [
    {
      key: "logo",
      tool: "wp_prepare_upload_image",
      args: {
        url: "https://i.example/logo.png",
        fileName: "logo.png",
        alt: "לוגו",
      },
    },
    {
      key: "mark",
      tool: "wp_prepare_site_logo",
      args: { mediaId: "{{logo.id}}" },
    },
    {
      key: "name",
      tool: "wp_prepare_site_identity",
      args: { blogname: "המספרה של דנה" },
    },
    ...base,
    {
      key: "top",
      tool: "wp_prepare_header",
      args: { content: "<!-- wp:site-logo /-->" },
    },
    {
      key: "bottom",
      tool: "wp_prepare_footer",
      args: { content: "<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->" },
    },
  ];
  await assert.rejects(
    run(full),
    (e) => e === reached,
    "a complete plan reaches the normal review preparation",
  );
});

test("imports may start with site CSS, and scanned graphics can be uploaded and referenced in page content", () => {
  checkImportOrder([
    { tool: "wp_prepare_site_css" },
    { tool: "wp_prepare_upload_scan_graphic" },
    { tool: "wp_prepare_create_page" },
  ]);
  assert.throws(
    () =>
      checkImportOrder([
        { tool: "wp_prepare_create_page" },
        { tool: "wp_prepare_site_css" },
      ]),
    /סדר/,
  );
  const steps = [
    {
      key: "icon1",
      tool: "wp_prepare_upload_scan_graphic",
      args: { graphicId: "p1-g3", fileName: "icon1.png", alt: "אייקון" },
    },
    {
      key: "home",
      tool: "wp_prepare_create_page",
      args: {
        title: "בית",
        content:
          '<!-- wp:image {"id":{{icon1.id}}} --><figure class="wp-block-image"><img src="{{icon1.url}}" alt="אייקון" class="wp-image-{{icon1.id}}"/></figure><!-- /wp:image -->',
      },
    },
  ];
  assert.ok(validatePlan({ title: "ייבוא", steps }, argumentsFor));
  assert.throws(
    () =>
      argumentsFor("wp_prepare_upload_scan_graphic", {
        graphicId: "x",
        fileName: "a.png",
        alt: "x",
      }),
    /graphicId/,
  );
  assert.throws(
    () =>
      argumentsFor("wp_prepare_upload_scan_graphic", {
        graphicId: "p1-g3",
        fileName: "a.svg",
        alt: "x",
      }),
    /png/,
  );
});
