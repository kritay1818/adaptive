"use strict";
// Elementor Pro header/footer templates (Theme Builder) against an in-memory fake WordPress that has Elementor Pro:
// offered only with Pro, created as a draft elementor_library post, exact read-back, activity log, undo, validation, plans.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Agent, argumentsFor } = require("../src/wp-agent.cjs");
const { WordPress } = require("../src/wordpress.cjs");
const { validatePlan } = require("../src/wp-plans.cjs");
const {
  validateElementor,
  buildElementorData,
  checkBuilt,
  TEMPLATE_TOOL,
} = require("../src/wp-elementor.cjs");
const { editsTemplate, templateRows } = require("../src/results.cjs");

const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const SITE = "https://public.example";
const mediaItem = (id) => ({
  id,
  status: "inherit",
  title: { raw: `file-${id}` },
  alt_text: "לוגו",
  media_type: "image",
  mime_type: "image/png",
  source_url: `${SITE}/wp-content/uploads/file-${id}.png`,
  modified: "2026-10-13T10:00:00",
});
async function fixture(t, over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-template-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const colors = {
    primary: { id: "primary", title: "Primary", value: "#1F3A5F" },
    secondary: { id: "secondary", title: "Secondary", value: "#54595F" },
    text: { id: "text", title: "Text", value: "#3A4452" },
    accent: { id: "accent", title: "Accent", value: "#D9731A" },
  };
  const state = {
    pro: true,
    menus: [
      { id: 5, name: "תפריט ראשי", slug: "main-menu" },
      { id: 6, name: "Footer links", slug: "footer-links" },
    ],
    templates: new Map(),
    templatesRoute: true,
    dropMeta: false,
    wrongType: false,
    lib: "hidden", // elementor_library_type taxonomy: hidden | exposed | exposed-with-terms
    dropTerms: false,
    terms: new Map(),
    next: 200,
    cacheCalls: 0,
    ...over,
  };
  const reply = (data, status = 200) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
  const err = (status, code) =>
    reply({ code, message: "x", data: { status } }, status);
  const json = (x) => ({
    id: x.id,
    title: { raw: x.title, rendered: x.title },
    status: x.status,
    modified: "2026-10-13T10:00:00",
    meta: { ...x.meta },
    ...(state.lib !== "hidden"
      ? { elementor_library_type: x.terms || [] }
      : {}),
  });
  const wp = new WordPress(dir, storage, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (url, options) => {
      if (options.binary)
        return { status: 200, contentType: "image/png", body: png };
      const route = url.searchParams.get("rest_route") || "/";
      const method = options.method || "GET";
      const payload = options.body ? JSON.parse(options.body) : undefined;
      calls.push({ route, method, payload });
      if (route === "/wp/v2/users/me") return reply({ id: 7 });
      if (route === "/")
        return reply({
          namespaces: [
            "wp/v2",
            "elementor/v1",
            ...(state.pro ? ["elementor-pro/v1"] : []),
          ],
        });
      if (route === "/wp/v2/plugins")
        return reply([
          { plugin: "elementor/elementor", status: "active", version: "4.3.6" },
          ...(state.pro
            ? [
                {
                  plugin: "elementor-pro/elementor-pro",
                  status: "active",
                  version: "4.1.0",
                },
              ]
            : []),
        ]);
      if (route === "/wp/v2/settings")
        return reply({ title: "Site", language: "he_IL" });
      if (route === "/elementor/v1/globals")
        return reply({ colors, typography: {} });
      if (route === "/elementor/v1/globals/colors") return reply(colors);
      if (route === "/elementor/v1/globals/typography")
        return reply({ primary: { id: "primary", title: "P", value: {} } });
      if (route === "/elementor/v1/cache") {
        state.cacheCalls++;
        return reply({ success: true });
      }
      if (route === "/wp/v2/menus") return reply(state.menus);
      const media = /^\/wp\/v2\/media\/(\d+)$/.exec(route);
      if (media)
        return Number(media[1]) === 42
          ? reply(mediaItem(42))
          : err(404, "rest_post_invalid_id");
      if (route === "/wp/v2/pages")
        return reply([
          {
            id: 2,
            meta: {
              _elementor_data: "",
              _elementor_edit_mode: "",
              _elementor_template_type: "",
            },
          },
        ]);
      if (route === "/wp/v2/taxonomies")
        return reply(
          state.lib === "hidden"
            ? {}
            : {
                elementor_library_type: {
                  slug: "elementor_library_type",
                  rest_base: "elementor_library_type",
                  show_in_rest: true,
                },
              },
        );
      if (route === "/wp/v2/elementor_library_type") {
        if (method === "GET") {
          const slug = url.searchParams.get("slug");
          return reply(
            [...state.terms.values()].filter((x) => x.slug === slug),
          );
        }
        const term = {
          id: state.next++,
          name: payload.name,
          slug: payload.slug,
        };
        state.terms.set(term.id, term);
        return reply(term, 201);
      }
      const lib = /^\/wp\/v2\/elementor_library(?:\/(\d+))?$/.exec(route);
      if (lib) {
        if (!state.templatesRoute) return err(404, "rest_no_route");
        const id = lib[1] ? Number(lib[1]) : null;
        if (method === "GET" && id === null)
          return reply([...state.templates.values()].slice(0, 1).map(json));
        if (method === "GET")
          return state.templates.has(id)
            ? reply(json(state.templates.get(id)))
            : err(404, "rest_post_invalid_id");
        let x;
        if (id === null) {
          x = {
            id: state.next++,
            title: payload.title,
            status: payload.status || "draft",
            meta: {
              _elementor_data: "",
              _elementor_edit_mode: "",
              _elementor_template_type: "",
            },
          };
          state.templates.set(x.id, x);
        } else x = state.templates.get(id);
        if (payload.title !== undefined) x.title = payload.title;
        if (payload.status !== undefined) x.status = payload.status;
        if (payload.meta && !state.dropMeta) {
          Object.assign(x.meta, payload.meta);
          if (state.wrongType) x.meta._elementor_template_type = "footer";
        }
        if (payload.elementor_library_type && !state.dropTerms)
          x.terms = payload.elementor_library_type;
        return reply(json(x), id === null ? 201 : 200);
      }
      throw Error(`Unexpected mock route ${route}`);
    },
  });
  await wp.connect("p", {
    site: SITE,
    username: "fixture",
    password: "PUBLIC-DUMMY",
  });
  const agent = new Agent(wp, dir);
  if (over.knownInfo !== false)
    agent.elementorInfo.set("p", {
      site: wp.status("p").site,
      info: { active: true, pro: { active: state.pro } },
    });
  return { dir, wp, agent, state, calls };
}
const provider = (name, args) => ({
  step: async () => ({ calls: [{ id: "fixture", name, args }] }),
});
const prepare = (agent, name, args) => agent.run("p", [], provider(name, args));
async function tool(agent, name, args) {
  let seen,
    n = 0;
  await agent.run("p", [], {
    step: async (messages) => {
      if (n++ === 0) return { text: "", calls: [{ id: "r", name, args }] };
      seen = messages.filter((m) => m.role === "tool").at(-1).result;
      return { text: "סיימתי", calls: [] };
    },
  });
  return seen;
}
const approve = async (f, args) => {
  const r = await prepare(f.agent, TEMPLATE_TOOL, args);
  assert.ok(r.review, r.text);
  return {
    review: r.review,
    result: await f.agent.decide("p", r.review.token, true),
  };
};
const libWrites = (f) =>
  f.calls.filter(
    (c) => c.method !== "GET" && c.route.startsWith("/wp/v2/elementor_library"),
  );
const dataOf = (f, id) =>
  JSON.parse(f.state.templates.get(id).meta._elementor_data);
const walk = (data, fn) => {
  for (const el of data) {
    fn(el);
    walk(el.elements || [], fn);
  }
};
const kinds = (data) => {
  const out = [];
  walk(data, (el) => out.push(el.widgetType || el.elType));
  return out;
};
const HEADER = {
  type: "header",
  title: "כותרת האתר",
  logo: { source: "site", width: 160 },
  navigation: "menu",
  buttons: [
    { text: "התקשרו", url: "tel:+972501234567" },
    { text: "וואטסאפ", url: "https://wa.me/972501234567" },
  ],
};
const FOOTER = {
  type: "footer",
  title: "תחתית האתר",
  text: "אנחנו כאן בשבילכם כל יום.",
  contacts: [
    { type: "phone", label: "טלפון", value: "050-123-4567" },
    { type: "email", value: "info@example.com" },
    { type: "address", value: "(להשלים: כתובת)" },
  ],
  footerLinks: [
    { text: "אודות", url: "/about/" },
    { text: "צרו קשר", url: "/contact/" },
  ],
  copyright: "© 2026 כל הזכויות שמורות",
};

test("Pro detection: the template tool is offered only while the site is known to have Elementor Pro", async (t) => {
  const offered = async (f) => {
    let names;
    await f.agent.run("p", [], {
      step: async (_m, list) => {
        names = list.map((x) => x.name);
        return { text: "ok", calls: [] };
      },
    });
    return names;
  };
  // Unknown (wp_read_site_structure not called yet): not offered.
  const unknown = await fixture(t, { knownInfo: false });
  assert.ok(!(await offered(unknown)).includes(TEMPLATE_TOOL));
  assert.match(unknown.agent.context("p"), /ELEMENTOR: not checked yet/);
  const listed = (f) =>
    /Available exact tools: ([^.]*)\./.exec(f.agent.context("p"))[1];
  assert.ok(!listed(unknown).includes(TEMPLATE_TOOL));
  // Pro active: offered and named in the context.
  const pro = await fixture(t);
  assert.ok((await offered(pro)).includes(TEMPLATE_TOOL));
  assert.ok(listed(pro).includes(TEMPLATE_TOOL));
  // No Pro: not offered; detection says writable false and tells the agent to explain in Hebrew.
  const free = await fixture(t, { pro: false });
  assert.ok(!(await offered(free)).includes(TEMPLATE_TOOL));
  assert.ok(!listed(free).includes(TEMPLATE_TOOL));
  const info = await free.agent.elementor.detect("p");
  assert.equal(info.themeBuilder.proActive, false);
  assert.equal(info.themeBuilder.writable, false);
  assert.match(info.themeBuilder.note, /Elementor Pro/);
  const withPro = await pro.agent.elementor.detect("p");
  assert.equal(withPro.themeBuilder.writable, true);
  assert.match(withPro.themeBuilder.note, /Publish ← Entire Site/);
  // A direct call without Pro is refused with the Hebrew explanation; nothing is written.
  const res = await tool(free.agent, TEMPLATE_TOOL, HEADER);
  assert.match(res.error, /דורשות Elementor Pro/);
  assert.equal(libWrites(free).length, 0);
});

test("header: draft template with site logo, nav-menu of the site's menu and buttons; verified, logged, manual step shown", async (t) => {
  const f = await fixture(t);
  const { review, result } = await approve(f, HEADER);
  assert.equal(review.kind, "elementor-template-create");
  assert.match(review.warning, /Publish ← Entire Site/);
  assert.match(review.summary, /התפריט 'תפריט ראשי'/);
  assert.equal(result.outcome, "verified");
  assert.match(
    result.text,
    /נוצרה תבנית header — כדי להציג אותה בכל האתר: פתחו ב-Elementor ← Publish ← Entire Site/,
  );
  assert.ok(result.edit, "an open-in-Elementor action is offered");
  assert.ok(result.undo);
  // Exactly one write, to the library, as a draft with the template type; no display conditions, no pages.
  const [w] = libWrites(f);
  assert.equal(libWrites(f).length, 1);
  assert.equal(w.route, "/wp/v2/elementor_library");
  assert.equal(w.payload.status, "draft");
  assert.equal(w.payload.meta._elementor_template_type, "header");
  assert.equal(w.payload.meta._elementor_edit_mode, "builder");
  assert.deepEqual(Object.keys(w.payload.meta).sort(), [
    "_elementor_data",
    "_elementor_edit_mode",
    "_elementor_template_type",
  ]);
  assert.ok(
    !f.calls.some((c) => c.method !== "GET" && c.route.includes("/pages")),
  );
  const [id] = [...f.state.templates.keys()];
  const data = dataOf(f, id);
  const nav = [];
  const logo = [];
  walk(data, (el) => {
    if (el.widgetType === "nav-menu") nav.push(el);
    if (el.widgetType === "theme-site-logo") logo.push(el);
  });
  assert.equal(nav.length, 1);
  assert.equal(nav[0].settings.menu, "main-menu");
  assert.equal(nav[0].settings.layout, "horizontal");
  assert.equal(logo.length, 1);
  assert.equal(logo[0].settings.width.size, 160);
  assert.equal(kinds(data).filter((k) => k === "button").length, 2);
  // Mobile and RTL: the header row stacks on phones, the logo shrinks, Hebrew is right-aligned.
  assert.equal(data[0].settings.flex_direction_mobile, "column");
  assert.ok(logo[0].settings.width_mobile.size <= 120);
  assert.doesNotThrow(() => checkBuilt(data, { rtl: true, pro: true }, SITE));
  // The activity log and the records know the template (the id feeds the editor link).
  const entry = f.agent
    .getActivityLog("p")
    .find((e) => e.action === "elementor-template-create");
  assert.equal(entry.resource, "templates");
  assert.equal(entry.canUndo, true);
  const rows = f.agent.records.filter((r) => r.operation === review.token);
  assert.equal(editsTemplate(rows), true);
  assert.deepEqual(
    templateRows(rows).map((r) => r.page),
    [id],
  );
});

test("header with a media logo and a links row (no menu needed)", async (t) => {
  const f = await fixture(t, { menus: [] });
  const { result } = await approve(f, {
    type: "header",
    logo: { source: "media", mediaId: 42, alt: "לוגו החברה" },
    navigation: "links",
    menuLinks: [
      { text: "בית", url: "/" },
      { text: "שירותים", url: "/services/" },
    ],
  });
  assert.equal(result.outcome, "verified");
  const data = dataOf(f, [...f.state.templates.keys()][0]);
  const k = kinds(data);
  assert.ok(k.includes("image"));
  assert.ok(!k.includes("nav-menu"));
  assert.equal(k.filter((x) => x === "heading").length, 2);
  const img = [];
  walk(data, (el) => el.widgetType === "image" && img.push(el));
  assert.ok(img[0].settings.width_mobile.size < 100, "a logo stays small");
});

test("header navigation 'menu' needs a menu on the site: clear Hebrew message, nothing written", async (t) => {
  const f = await fixture(t, { menus: [] });
  const res = await tool(f.agent, TEMPLATE_TOOL, HEADER);
  assert.match(res.error, /לא נמצא תפריט/);
  assert.equal(libWrites(f).length, 0);
});

test("footer: contacts, links, text and copyright; placeholders listed; text stays readable on its background", async (t) => {
  const f = await fixture(t);
  const { review, result } = await approve(f, FOOTER);
  assert.match(review.summary, /\(להשלים: כתובת\)/);
  assert.equal(result.outcome, "verified");
  assert.match(result.text, /נוצרה תבנית footer/);
  assert.match(result.text, /מקומות להשלמה ידנית: \(להשלים: כתובת\)/);
  const data = dataOf(f, [...f.state.templates.keys()][0]);
  const k = kinds(data);
  assert.ok(k.includes("icon-list"));
  assert.ok(k.includes("divider"));
  assert.ok(k.includes("text-editor"));
  const lists = [];
  walk(data, (el) => el.widgetType === "icon-list" && lists.push(el));
  const phone = lists.find((l) =>
    /^tel:/.test(l.settings.icon_list[0].link?.url || ""),
  );
  assert.match(phone.settings.icon_list[0].link.url, /^tel:/);
  // The placeholder address is plain text, not a link.
  const address = lists.find((l) =>
    /להשלים/.test(l.settings.icon_list[0].text),
  );
  assert.equal(address.settings.icon_list[0].link, undefined);
  // Dark footer background with the primary color (#1F3A5F): text is white, not the dark text color.
  const bg =
    data[0].settings.__globals__?.background_color ||
    data[0].settings.background_color;
  assert.ok(bg);
  const text = [];
  walk(data, (el) => el.widgetType === "text-editor" && text.push(el));
  assert.ok(
    text.every((x) => {
      const c = x.settings.text_color || x.settings.__globals__?.text_color;
      return (
        c === "#ffffff" || c === "#0b1220" || /globals\/colors/.test(c || "")
      );
    }),
  );
  assert.equal(data[0].settings.flex_direction_mobile, "column");
});

test("update: replaces the template, verified; undo restores the previous data; undo of a create trashes the draft", async (t) => {
  const f = await fixture(t);
  await approve(f, HEADER);
  const [id] = [...f.state.templates.keys()];
  const before = f.state.templates.get(id).meta._elementor_data;
  // Same content again: nothing to change.
  const same = await tool(f.agent, TEMPLATE_TOOL, { ...HEADER, id });
  assert.match(same.error, /אין שינוי/);
  // Wrong type for the template id.
  const wrong = await tool(f.agent, TEMPLATE_TOOL, { ...FOOTER, id });
  assert.match(wrong.error, /מסוג 'header'/);
  const { review, result } = await approve(f, {
    ...HEADER,
    id,
    buttons: [{ text: "צרו קשר", url: "/contact/" }],
  });
  assert.equal(review.kind, "elementor-template-update");
  assert.equal(result.outcome, "verified");
  assert.equal(f.state.cacheCalls, 1, "CSS cache is cleared after an update");
  assert.notEqual(f.state.templates.get(id).meta._elementor_data, before);
  const upd = f.agent
    .getActivityLog("p")
    .find((e) => e.action === "elementor-template-update");
  assert.equal(upd.canUndo, true);
  // Undo the update: the previous data is restored and verified.
  const ur = await f.agent.prepareUndo("p", upd.id);
  assert.equal(ur.kind, "elementor-template-revert");
  const undone = await f.agent.decide("p", ur.token, true);
  assert.equal(undone.outcome, "verified");
  assert.equal(f.state.templates.get(id).meta._elementor_data, before);
  // Undo the creation: the draft goes to the trash (never a permanent delete).
  const create = f.agent
    .getActivityLog("p")
    .find((e) => e.action === "elementor-template-create");
  const cr = await f.agent.prepareUndo("p", create.id);
  assert.equal(cr.kind, "elementor-template-trash");
  const trashed = await f.agent.decide("p", cr.token, true);
  assert.equal(trashed.outcome, "verified");
  assert.equal(f.state.templates.get(id).status, "trash");
  assert.ok(
    !f.calls.some(
      (c) => c.method === "DELETE" && c.route.includes("elementor_library"),
    ),
  );
});

test("read-back mismatch (data dropped or wrong template type) is not reported as done and blocks the project", async (t) => {
  for (const over of [{ dropMeta: true }, { wrongType: true }]) {
    const f = await fixture(t, over);
    const r = await prepare(f.agent, TEMPLATE_TOOL, HEADER);
    const out = await f.agent.decide("p", r.review.token, true);
    assert.equal(out.outcome, "unknown");
    assert.equal(f.agent.isBlocked("p"), true);
    assert.equal(libWrites(f).length, 1, "no retry");
    assert.ok(!out.edit, "no editor button for an unverified write");
  }
});

test("a site without the library route or meta exposure gets a Hebrew explanation, nothing written", async (t) => {
  const f = await fixture(t, { templatesRoute: false });
  const res = await tool(f.agent, TEMPLATE_TOOL, HEADER);
  assert.match(res.error, /אינן חשופות ל־REST|אין לחשבון/);
  assert.equal(libWrites(f).length, 0);
});

test("validation: unknown keys, header/footer fields mixed, unsafe links and text, widgets of Pro never in pages", () => {
  const bad = (args, re) =>
    assert.throws(() => validateElementor(TEMPLATE_TOOL, args), re);
  bad({ ...HEADER, type: "sidebar" }, /header.*footer/);
  bad({ type: "header", copyright: "x" }, /שייך ל/);
  bad({ type: "footer", buttons: [{ text: "a", url: "/x/" }] }, /שייך ל/);
  bad({ ...HEADER, html: "<b>x</b>" }, /אסור|אינו מוכר/);
  bad(
    { type: "header", buttons: [{ text: "a", url: "javascript:alert(1)" }] },
    /javascript/,
  );
  bad(
    { type: "header", buttons: [{ text: "<b>a</b>", url: "/x/" }] },
    /טקסט רגיל/,
  );
  bad(
    {
      type: "header",
      buttons: [1, 2, 3].map((n) => ({ text: `b${n}`, url: "/x/" })),
    },
    /עד 2|0 עד 2/,
  );
  bad({ type: "header", navigation: "links" }, /menuLinks|קישורים/);
  bad(
    {
      type: "header",
      navigation: "menu",
      menuLinks: [{ text: "a", url: "/" }],
    },
    /menuLinks/,
  );
  bad({ type: "header", logo: { source: "media" } }, /mediaId/);
  bad({ type: "header", logo: { source: "site", mediaId: 4 } }, /mediaId/);
  bad({ type: "header", logo: { source: "site", width: 5 } }, /40/);
  bad({ type: "footer" }, /ריקה/);
  bad({ type: "footer", contacts: [{ type: "fax", value: "1" }] }, /type/);
  bad({ type: "footer", text: "<script>x</script>" }, /טקסט רגיל/);
  bad({ type: "footer", text: "ok", id: -4 }, /id/);
  // Elementor Pro widgets exist only in templates: a page cannot carry them, neither as input nor as built JSON.
  assert.throws(
    () =>
      validateElementor("wp_prepare_elementor_page", {
        title: "x",
        containers: [
          {
            children: [{ type: "nav-menu", menuSlug: "main-menu" }],
          },
        ],
      }),
    /לא מוכר/,
  );
  const built = [
    {
      id: "a1b2c3d4",
      elType: "container",
      isInner: false,
      settings: { content_width: "boxed" },
      elements: [
        {
          id: "b2c3d4e5",
          elType: "widget",
          widgetType: "nav-menu",
          isInner: false,
          settings: { menu: "main-menu" },
          elements: [],
        },
      ],
    },
  ];
  assert.throws(() => checkBuilt(built, { rtl: true }, SITE), /Elementor Pro/);
  assert.doesNotThrow(() => checkBuilt(built, { rtl: true, pro: true }, SITE));
  built[0].elements[0].settings.menu = "x y";
  assert.throws(
    () => checkBuilt(built, { rtl: true, pro: true }, SITE),
    /תפריט/,
  );
  built[0].elements[0].settings = { menu: "main-menu", custom_css: "x" };
  assert.throws(
    () => checkBuilt(built, { rtl: true, pro: true }, SITE),
    /הגדרה לא מותרת/,
  );
  // The page tool keeps working through the same validator.
  assert.doesNotThrow(() =>
    buildElementorData(
      validateElementor("wp_prepare_elementor_page", {
        title: "x",
        containers: [
          { children: [{ type: "heading", text: "שלום", level: 2 }] },
        ],
      }),
      { rtl: true, media: new Map() },
    ),
  );
});

test("contrast: header and footer text is white or dark by the background's brightness", async (t) => {
  // A very light primary color: a dark-tone template must not use white text on it.
  const f = await fixture(t);
  assert.ok(f);
  const { buildTemplate } = require("../src/elementor-kit/index.cjs");
  const lightBg = buildTemplate(
    "footer",
    { text: "שלום", tone: "dark" },
    {
      palette: { primary: "#FFE08A" },
    },
  );
  const t1 = lightBg[0].children[0].children.find(
    (c) => c.type === "text-editor",
  );
  assert.notEqual(t1.color, "#ffffff", "no white text on a light background");
  const darkBg = buildTemplate(
    "footer",
    { text: "שלום", tone: "dark" },
    {
      palette: { primary: "#1F3A5F" },
    },
  );
  const t2 = darkBg[0].children[0].children.find(
    (c) => c.type === "text-editor",
  );
  assert.equal(t2.color, "#ffffff");
});

test("build plan: the template is a step; the header must come after the menu step; one header and one footer per plan", async (t) => {
  const step = (key, tool, args) => ({ key, tool, args });
  const menu = step("nav", "wp_prepare_menu", {
    title: "תפריט ראשי",
    links: [{ pageId: 2, label: "בית" }],
  });
  const header = step("hdr", TEMPLATE_TOOL, HEADER);
  const footer = step("ftr", TEMPLATE_TOOL, FOOTER);
  assert.throws(
    () => validatePlan({ title: "x", steps: [header, menu] }, argumentsFor),
    /התפריט חייב לבוא לפני/,
  );
  assert.doesNotThrow(() =>
    validatePlan({ title: "x", steps: [menu, header, footer] }, argumentsFor),
  );
  assert.throws(
    () =>
      validatePlan(
        {
          title: "x",
          steps: [menu, header, step("h2", TEMPLATE_TOOL, HEADER)],
        },
        argumentsFor,
      ),
    /פעם אחת/,
  );
  // A logo can reference an earlier verified upload.
  assert.doesNotThrow(() =>
    validatePlan(
      {
        title: "x",
        steps: [
          step("logo", "wp_prepare_upload_image", {
            url: "https://example.com/logo.png",
            fileName: "logo.png",
            alt: "לוגו",
          }),
          step("hdr", TEMPLATE_TOOL, {
            type: "header",
            logo: { source: "media", mediaId: "{{logo.id}}" },
            navigation: "none",
            buttons: [{ text: "צרו קשר", url: "/contact/" }],
          }),
        ],
      },
      argumentsFor,
    ),
  );
});

test("build plan: header and footer steps are written, verified and undone as a plan", async (t) => {
  const f = await fixture(t);
  const r = await prepare(f.agent, "wp_prepare_build_plan", {
    title: "כותרת ותחתית",
    steps: [
      {
        key: "hdr",
        tool: TEMPLATE_TOOL,
        args: {
          type: "header",
          logo: { source: "site" },
          navigation: "links",
          menuLinks: [{ text: "בית", url: "/" }],
        },
      },
      { key: "ftr", tool: TEMPLATE_TOOL, args: FOOTER },
    ],
  });
  assert.ok(r.review, r.text);
  assert.equal(r.review.kind, "build-plan");
  assert.equal(libWrites(f).length, 0, "nothing is written while preparing");
  const done = await f.agent.decide("p", r.review.token, true);
  assert.equal(done.outcome, "verified");
  assert.equal(f.state.templates.size, 2);
  assert.ok(
    done.edit,
    "the editor action is offered for a plan with templates",
  );
  assert.match(done.text, /נוצרה תבנית header — כדי להציג אותה בכל האתר/);
  assert.match(done.text, /נוצרה תבנית footer/);
  // Undo the whole plan: both drafts go to the trash.
  const rev = await f.agent.plans.prepareUndo("p", r.review.token);
  assert.ok(rev.review || rev.token || rev);
  const token = rev.review?.token ?? rev.token ?? f.agent.review("p").token;
  const undone = await f.agent.decide("p", token, true);
  assert.equal(undone.outcome, "verified");
  assert.ok([...f.state.templates.values()].every((x) => x.status === "trash"));
});

test("the plan menu step creates the menu the header then reads at execution time (mock menu while preparing)", async (t) => {
  // No menu exists while the plan is prepared; the header step still prepares (mock) and is rebuilt after the menu step ran.
  const f = await fixture(t, { menus: [] });
  const prepared = await f.agent.elementor.prepareTemplate(
    f.agent,
    "p",
    HEADER,
    AbortSignal.timeout(5000),
    { mockIds: new Set() },
  );
  assert.equal(prepared.target.menu, "plan-menu");
  // At execution the menu exists.
  f.state.menus.push({ id: 9, name: "Main menu", slug: "primary-nav" });
  const p = structuredClone(prepared);
  await f.agent.elementor.finalizeTemplate(
    f.agent,
    "p",
    p,
    HEADER,
    AbortSignal.timeout(5000),
  );
  assert.equal(p.target.menu, "primary-nav");
  assert.match(p.payload.meta._elementor_data, /primary-nav/);
  // Still no menu at execution: the step stops with a clear message.
  f.state.menus.length = 0;
  await assert.rejects(
    f.agent.elementor.finalizeTemplate(
      f.agent,
      "p",
      structuredClone(prepared),
      HEADER,
      AbortSignal.timeout(5000),
    ),
    /לא נמצא תפריט/,
  );
});

test("agent guide and UI: the manual step is always explained and the editor button is wired through main", () => {
  const { ELEMENTOR_GUIDE } = require("../src/elementor-instructions.cjs");
  assert.match(ELEMENTOR_GUIDE, /wp_prepare_elementor_template/);
  assert.match(ELEMENTOR_GUIDE, /Entire Site/);
  assert.match(ELEMENTOR_GUIDE, /not offered/);
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  assert.match(read("src/ui/renderer.js"), /פתיחה ב-Elementor/);
  assert.match(read("src/ui/renderer.js"), /api\.openElementorEditor/);
  assert.match(read("src/preload.cjs"), /openElementorEditor/);
  const main = read("src/main.cjs");
  assert.match(main, /handle\(\s*"openElementorEditor"/);
  assert.match(main, /wp-admin\/post\.php/);
  assert.match(main, /"action",\s*"elementor"/);
  assert.match(read("src/core.cjs"), /meta\?\.edit/);
});

test("library type taxonomy: exposed -> the term is created if missing, set on create, read back; hidden -> today's behavior plus a note", async (t) => {
  const NOTE =
    "אם התבנית לא מופיעה ב-Theme Builder, פתחו אותה בכפתור ושמרו פעם אחת ב-Elementor";
  // Exposed, term missing: created first (the only write before the template), then set on the template and verified.
  const f = await fixture(t, { lib: "exposed" });
  const r = await prepare(f.agent, TEMPLATE_TOOL, HEADER);
  assert.match(r.review.summary, /elementor_library_type 'header'/);
  assert.match(r.review.summary, /ייווצר/);
  assert.equal(
    f.calls.filter((c) => c.method !== "GET").length,
    0,
    "nothing is written while preparing",
  );
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified");
  assert.ok(!out.text.includes(NOTE));
  const writesInOrder = f.calls.filter((c) => c.method === "POST");
  assert.deepEqual(
    writesInOrder.map((c) => c.route),
    ["/wp/v2/elementor_library_type", "/wp/v2/elementor_library"],
  );
  assert.deepEqual(writesInOrder[0].payload, {
    name: "header",
    slug: "header",
  });
  const [term] = [...f.state.terms.values()];
  assert.deepEqual(writesInOrder[1].payload.elementor_library_type, [term.id]);
  assert.equal(
    writesInOrder[1].payload.meta._elementor_template_type,
    "header",
  );
  const [id] = [...f.state.templates.keys()];
  assert.deepEqual(f.state.templates.get(id).terms, [term.id]);
  // Undo still trashes the draft; the shared type term stays.
  const entry = f.agent
    .getActivityLog("p")
    .find((e) => e.action === "elementor-template-create");
  const review = await f.agent.prepareUndo("p", entry.id);
  const undone = await f.agent.decide("p", review.token, true);
  assert.equal(undone.outcome, "verified");
  assert.equal(f.state.templates.get(id).status, "trash");
  assert.equal(f.state.terms.size, 1);

  // Exposed, term already there: no term write, the existing id is used.
  const g = await fixture(t, { lib: "exposed" });
  g.state.terms.set(77, { id: 77, name: "footer", slug: "footer" });
  const done = await approve(g, FOOTER);
  assert.equal(done.result.outcome, "verified");
  assert.deepEqual(
    g.calls.filter((c) => c.method === "POST").map((c) => c.route),
    ["/wp/v2/elementor_library"],
  );
  assert.deepEqual([...g.state.templates.values()][0].terms, [77]);

  // The taxonomy is not exposed: no taxonomy key is sent, and the card carries the one-line hint.
  const h = await fixture(t);
  const hidden = await approve(h, HEADER);
  assert.equal(hidden.result.outcome, "verified");
  assert.ok(hidden.result.text.includes(NOTE));
  assert.ok(
    h.calls.every(
      (c) => !c.payload || !("elementor_library_type" in c.payload),
    ),
  );
  assert.ok(!h.calls.some((c) => c.route === "/wp/v2/elementor_library_type"));
  // An update does not change the term and gets no hint.
  const [hid] = [...h.state.templates.keys()];
  const upd = await approve(h, {
    ...HEADER,
    id: hid,
    buttons: [{ text: "צרו קשר", url: "/contact/" }],
  });
  assert.ok(!upd.result.text.includes(NOTE));
});

test("library type taxonomy: a term that is not saved fails the read-back; the term route accepts nothing else", async (t) => {
  const f = await fixture(t, { lib: "exposed", dropTerms: true });
  const r = await prepare(f.agent, TEMPLATE_TOOL, HEADER);
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "unknown");
  assert.equal(f.agent.isBlocked("p"), true);
  const g = await fixture(t, { lib: "exposed" });
  const el = g.agent.elementor;
  const call = (over) =>
    el.request("p", {
      route: "libterms",
      base: "elementor_library_type",
      method: "POST",
      signal: AbortSignal.timeout(5000),
      ...over,
    });
  await assert.rejects(call({ payload: { name: "sidebar", slug: "sidebar" } }));
  await assert.rejects(
    call({ payload: { name: "header", slug: "header", parent: 3 } }),
  );
  await assert.rejects(
    call({ base: "../users", payload: { name: "header", slug: "header" } }),
  );
  await assert.rejects(
    el.request("p", { route: "libterms", signal: AbortSignal.timeout(5000) }),
    "a base is required",
  );
  await assert.rejects(
    el.request("p", {
      route: "templates",
      method: "POST",
      payload: { title: "x", elementor_library_type: [1] },
      signal: AbortSignal.timeout(5000),
    }),
    "the taxonomy key is allowed only with its discovered base",
  );
});
