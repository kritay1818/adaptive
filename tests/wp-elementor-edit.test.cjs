"use strict";
// A real site's existing Elementor pages: compact listing at scale (url / slug / front page), duplicate, outline, and targeted
// edits. The fake site has a LARGE home page full of Pro and third-party widgets that the app does not build; they must survive
// a copy and a targeted edit key for key.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Agent, argumentsFor, fitResult } = require("../src/wp-agent.cjs");
const { WordPress } = require("../src/wordpress.cjs");
const { validatePlan } = require("../src/wp-plans.cjs");

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
const HEBREW_SLUG = "מהמקור-ועד-הרמקול";
const enc = (s) => encodeURIComponent(s).toLowerCase();

// ---- the large page -------------------------------------------------------------------------------------------------------------
const hex8 = (n) => n.toString(16).padStart(8, "0");
const w = (id, widgetType, settings = {}) => ({
  id,
  elType: "widget",
  widgetType,
  isInner: false,
  settings,
  elements: [],
});
const c = (id, settings, elements, inner = false) => ({
  id,
  elType: "container",
  isInner: inner,
  settings,
  elements,
});
function bigPage() {
  const sections = [];
  // 1. The hero: globals, a custom CSS class and motion effects that the app never writes.
  sections.push(
    c(
      "hero0001",
      {
        content_width: "full",
        flex_direction: "column",
        background_background: "classic",
        background_color: "#0B1220",
        __globals__: { background_color: "globals/colors?id=primary" },
        _css_classes: "home-hero",
        motion_fx_motion_fx_scrolling: "yes",
        padding: {
          unit: "px",
          top: "120",
          right: "24",
          bottom: "120",
          left: "24",
          isLinked: false,
        },
      },
      [
        w("ttl00001", "heading", {
          title: "ברוכים הבאים",
          header_size: "h1",
          title_color: "#FFFFFF",
          __globals__: {
            title_color: "globals/colors?id=accent",
            typography_typography: "globals/typography?id=primary",
          },
          _animation: "fadeInUp",
          _margin: {
            unit: "px",
            top: "0",
            right: "0",
            bottom: "10",
            left: "0",
            isLinked: false,
          },
        }),
        w("txt00001", "text-editor", {
          editor: "<p>תיאור הבאנר הראשי</p>",
          text_color: "#DDDDDD",
        }),
        w("btn00001", "button", {
          text: "לפרטים",
          link: {
            url: "/about/",
            is_external: "",
            nofollow: "",
            custom_attributes: "",
          },
          background_color: "#D9731A",
          hover_animation: "grow",
          button_box_shadow_box_shadow_type: "yes",
        }),
        // Pro and third-party widgets inside the hero.
        w("frm00001", "form", {
          form_name: "Contact",
          form_fields: [
            {
              custom_id: "name",
              field_type: "text",
              field_label: "שם",
              _id: "f1",
            },
            {
              custom_id: "email",
              field_type: "email",
              field_label: "דוא״ל",
              _id: "f2",
            },
          ],
          email_to: "owner@example.com",
          __dynamic__: {
            email_subject: '[elementor-tag id="1" name="post-title"]',
          },
        }),
      ],
    ),
  );
  // 2. Many content sections (this is what makes the page "large"): known widgets next to foreign ones.
  for (let i = 0; i < 38; i++) {
    const n = 100 + i * 10;
    sections.push(
      c(
        `sec${hex8(n)}`.slice(0, 11),
        {
          content_width: "boxed",
          flex_direction: "column",
          padding: {
            unit: "px",
            top: "60",
            right: "20",
            bottom: "60",
            left: "20",
            isLinked: false,
          },
        },
        [
          w(`h${hex8(n)}`.slice(0, 9), "heading", {
            title: `כותרת מדור ${i}`,
            header_size: "h2",
          }),
          w(`t${hex8(n)}`.slice(0, 9), "text-editor", {
            editor: `<p>טקסט מדור ${i} עם <a href="/about/">קישור</a></p>`,
          }),
          c(
            `row${hex8(n)}`.slice(0, 11),
            {
              flex_direction: "row",
              flex_gap: {
                unit: "px",
                size: 12,
                column: "12",
                row: "12",
                isLinked: true,
              },
            },
            [
              w(`p${hex8(n)}`.slice(0, 9), "price-table", {
                heading: `חבילה ${i}`,
                price: String(100 + i),
                features_list: [{ item_text: "פיצ׳ר", _id: "x1" }],
                ribbon_title: "מומלץ",
              }),
              w(`u${hex8(n)}`.slice(0, 9), "uael-info-box", {
                heading: `תיבת מידע ${i}`,
                custom_css: ".x { color: red }",
                _element_id: `box-${i}`,
                third_party_blob: { a: [1, 2, { b: "ג" }], unicode: "שלום ☃" },
              }),
              w(`b${hex8(n)}`.slice(0, 9), "button", {
                text: `לחצו ${i}`,
                link: {
                  url: "/contact/",
                  is_external: "on",
                  nofollow: "",
                  custom_attributes: "",
                },
              }),
            ],
            true,
          ),
        ],
      ),
    );
  }
  // 3. A Pro navigation and a slider at the end.
  sections.push(
    c("foot0001", { content_width: "boxed" }, [
      w("nav00001", "nav-menu", { menu: "main-menu", layout: "horizontal" }),
      w("sld00001", "slides", {
        slides: [{ heading: "שקף", _id: "s1" }],
        autoplay: "yes",
      }),
    ]),
  );
  return sections;
}
const count = (list) =>
  list.reduce((n, el) => n + 1 + count(el.elements || []), 0);
const flatten = (list, out = new Map()) => {
  for (const el of list) {
    out.set(el.id, el);
    flatten(el.elements || [], out);
  }
  return out;
};

async function fixture(t, over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-edit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const bigData = JSON.stringify(bigPage());
  const colors = {
    primary: { id: "primary", title: "Primary", value: "#1F3A5F" },
    secondary: { id: "secondary", title: "Secondary", value: "#54595F" },
    text: { id: "text", title: "Text", value: "#3A4452" },
    accent: { id: "accent", title: "Accent", value: "#D9731A" },
  };
  const page = (id, extra) => ({
    id,
    title: `עמוד ${id}`,
    slug: `page-${id}`,
    status: "publish",
    template: "",
    content: "",
    meta: {
      _elementor_data: "",
      _elementor_edit_mode: "",
      _elementor_template_type: "",
    },
    ...extra,
  });
  const state = {
    pages: new Map(),
    next: 1000,
    cacheCalls: 0,
    frontId: 10,
    ...over,
  };
  state.pages.set(
    10,
    page(10, {
      title: "דף הבית",
      slug: "home",
      template: "elementor_header_footer",
      meta: {
        _elementor_data: bigData,
        _elementor_edit_mode: "builder",
        _elementor_template_type: "wp-page",
        _elementor_page_settings: {
          hide_title: "yes",
          custom_note: "keep me",
          background_color: "#fafafa",
        },
      },
    }),
  );
  state.pages.set(
    11,
    page(11, {
      title: "מהמקור ועד הרמקול",
      slug: enc(HEBREW_SLUG),
      meta: {
        _elementor_data: JSON.stringify(bigPage().slice(0, 3)),
        _elementor_edit_mode: "builder",
        _elementor_template_type: "wp-page",
      },
    }),
  );
  state.pages.set(
    12,
    page(12, { title: "עמוד רגיל", slug: "plain", content: "<p>x</p>" }),
  );
  state.pages.set(13, page(13, { title: "אודות", slug: "about", parent: 0 }));
  state.pages.set(
    14,
    page(14, { title: "צוות", slug: "team", link: `${SITE}/about/team/` }),
  );
  for (let i = 0; i < 130; i++) {
    const id = 100 + i;
    state.pages.set(
      id,
      page(id, {
        title: `עמוד מלא ${i}`,
        slug: `filler-${i}`,
        content: "x".repeat(3000),
      }),
    );
  }
  const reply = (data, status = 200, total) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
    ...(total ? { total } : {}),
  });
  const err = (status, code) =>
    reply({ code, message: "x", data: { status } }, status);
  const json = (p) => ({
    id: p.id,
    title: { raw: p.title, rendered: p.title },
    content: { raw: p.content || "", rendered: p.content || "" },
    slug: p.slug,
    link:
      p.link || (p.id === state.frontId ? `${SITE}/` : `${SITE}/${p.slug}/`),
    status: p.status,
    modified: "2026-10-13T10:00:00",
    template: p.template || "",
    meta: { ...p.meta },
  });
  const wp = new WordPress(dir, storage, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (url, options) => {
      if (options.binary)
        return { status: 200, contentType: "image/png", body: png };
      const route = url.searchParams.get("rest_route") || "/";
      const method = options.method || "GET";
      const payload = options.body ? JSON.parse(options.body) : undefined;
      const q = url.searchParams;
      calls.push({ route, method, payload, query: Object.fromEntries(q) });
      if (route === "/wp/v2/users/me") return reply({ id: 7 });
      if (route === "/")
        return reply({ namespaces: ["wp/v2", "elementor/v1"] });
      if (route === "/wp/v2/plugins")
        return reply([
          { plugin: "elementor/elementor", status: "active", version: "4.3.6" },
        ]);
      if (route === "/wp/v2/settings")
        return reply({
          title: "Site",
          description: "",
          language: "he_IL",
          show_on_front: "page",
          page_on_front: state.frontId,
          page_for_posts: 0,
        });
      if (route === "/elementor/v1/globals")
        return reply({ colors, typography: {} });
      if (route === "/elementor/v1/globals/colors") return reply(colors);
      if (route === "/elementor/v1/globals/typography")
        return reply({ primary: { id: "primary", title: "P", value: {} } });
      if (route === "/elementor/v1/cache") {
        state.cacheCalls++;
        return reply({ success: true });
      }
      const media = /^\/wp\/v2\/media\/(\d+)$/.exec(route);
      if (media)
        return Number(media[1]) === 42
          ? reply({
              id: 42,
              status: "inherit",
              title: { raw: "hero.png" },
              alt_text: "נוף",
              media_type: "image",
              mime_type: "image/png",
              source_url: `${SITE}/wp-content/uploads/hero.png`,
              modified: "2026-10-13T10:00:00",
            })
          : err(404, "rest_post_invalid_id");
      const pages = /^\/wp\/v2\/pages(?:\/(\d+))?$/.exec(route);
      if (pages) {
        const id = pages[1] ? Number(pages[1]) : null;
        if (method === "GET" && id === null) {
          let list = [...state.pages.values()];
          if (q.get("slug"))
            list = list.filter(
              (p) => p.slug === enc(q.get("slug")) || p.slug === q.get("slug"),
            );
          if (q.get("search"))
            list = list.filter((p) => p.title.includes(q.get("search")));
          if (q.get("include"))
            list = list.filter((p) => p.id === Number(q.get("include")));
          const total = list.length;
          const per = Number(q.get("per_page") || 10);
          const pg = Number(q.get("page") || 1);
          list = list.slice((pg - 1) * per, pg * per);
          const fields = (q.get("_fields") || "").split(",").filter(Boolean);
          const out = list.map((p) => {
            const full = json(p);
            if (!fields.length) return full;
            const o = {};
            for (const f of fields) {
              if (f === "meta") o.meta = full.meta;
              else if (f.startsWith("meta."))
                o.meta = {
                  ...(o.meta || {}),
                  [f.slice(5)]: full.meta[f.slice(5)],
                };
              else o[f] = full[f];
            }
            return o;
          });
          return reply(out, 200, total);
        }
        if (method === "GET")
          return state.pages.has(id)
            ? reply(json(state.pages.get(id)))
            : err(404, "rest_post_invalid_id");
        let p;
        if (id === null) {
          p = page(state.next++, {
            title: payload.title,
            slug: `copy-${state.next}`,
            status: payload.status || "draft",
          });
          state.pages.set(p.id, p);
        } else p = state.pages.get(id);
        if (!p) return err(404, "rest_post_invalid_id");
        if (payload.title !== undefined) p.title = payload.title;
        if (payload.status !== undefined) p.status = payload.status;
        if (payload.template !== undefined && !state.ignoreTemplate)
          p.template = payload.template;
        if (payload.meta && !state.dropMeta)
          Object.assign(p.meta, structuredClone(payload.meta));
        return reply(json(p), id === null ? 201 : 200);
      }
      throw Error(`Unexpected mock route ${route}`);
    },
  });
  await wp.connect("p", {
    site: SITE,
    username: "fixture",
    password: "PUBLIC-DUMMY",
  });
  return { dir, wp, agent: new Agent(wp, dir), state, calls, bigData };
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
const approve = async (f, name, args) => {
  const r = await prepare(f.agent, name, args);
  assert.ok(r.review, r.text);
  return {
    review: r.review,
    result: await f.agent.decide("p", r.review.token, true),
  };
};
const pageWrites = (f) =>
  f.calls.filter(
    (c) => c.method !== "GET" && c.route.startsWith("/wp/v2/pages"),
  );
const dataOf = (f, id) =>
  JSON.parse(f.state.pages.get(id).meta._elementor_data);

// ---- 1. listing at scale --------------------------------------------------------------------------------------------------------
test("wp_list_pages: compact rows, a hint with the number of pages left, per_page up to 50, no content, never ends the run", async (t) => {
  const f = await fixture(t);
  const res = await tool(f.agent, "wp_list_pages", {});
  assert.equal(res.data.items.length, 20);
  assert.equal(res.data.total, 135);
  assert.match(res.data.hint, /יש עוד 115 עמודים — חפשו לפי שם/);
  assert.ok(JSON.stringify(res).length < 8000, "compact: no page content");
  const row = res.data.items.find((i) => i.id === 10);
  assert.deepEqual(Object.keys(row).sort(), [
    "id",
    "isElementor",
    "isFront",
    "modified",
    "path",
    "slug",
    "status",
    "title",
  ]);
  assert.equal(row.isFront, true);
  assert.equal(row.isElementor, true);
  assert.equal(res.data.items.find((i) => i.id === 12).isElementor, false);
  assert.ok(!JSON.stringify(res).includes("xxxx"));
  // The request never asks for page content or the Elementor JSON.
  const asked = f.calls.find(
    (x) => x.route === "/wp/v2/pages" && x.query.per_page === "20",
  );
  assert.equal(
    asked.query._fields,
    "id,title,slug,status,modified,link,meta._elementor_edit_mode",
  );
  const big = await tool(f.agent, "wp_list_pages", { per_page: 50, page: 2 });
  assert.equal(big.data.items.length, 50);
  assert.match(big.data.hint, /יש עוד 35 עמודים/);
  const bad = await tool(f.agent, "wp_list_pages", { per_page: 51 });
  assert.match(bad.error, /per_page/);
  const found = await tool(f.agent, "wp_list_pages", { search: "אודות" });
  assert.deepEqual(
    found.data.items.map((i) => i.id),
    [13],
  );
  assert.ok(!found.data.hint);
});

test("wp_list_pages: find ONE page by pasted url (percent-encoded Hebrew slugs too), slug, ?page_id and the front page", async (t) => {
  const f = await fixture(t);
  const ids = async (args) =>
    (await tool(f.agent, "wp_list_pages", args)).data?.items?.map((i) => i.id);
  assert.deepEqual(
    await ids({ url: `${SITE}/${enc(HEBREW_SLUG)}/` }),
    [11],
    "percent-encoded",
  );
  assert.deepEqual(
    await ids({ url: `${SITE}/${HEBREW_SLUG}/` }),
    [11],
    "raw Hebrew",
  );
  assert.deepEqual(
    await ids({ url: `https://www.public.example/about` }),
    [13],
    "www and no trailing slash",
  );
  assert.deepEqual(await ids({ url: `${SITE}/?page_id=12` }), [12]);
  assert.deepEqual(
    await ids({ url: `${SITE}/` }),
    [10],
    "the home address is the front page",
  );
  assert.deepEqual(await ids({ front: true }), [10]);
  assert.deepEqual(await ids({ slug: "home" }), [10]);
  assert.deepEqual(
    await ids({ url: `${SITE}/about/team/` }),
    [14],
    "a child page by its path",
  );
  const front = await tool(f.agent, "wp_list_pages", { front: true });
  assert.equal(front.data.items[0].isFront, true);
  const other = await tool(f.agent, "wp_list_pages", {
    url: "https://evil.example/home/",
  });
  assert.match(other.error, /אינה של האתר המחובר/);
  const none = await tool(f.agent, "wp_list_pages", {
    url: `${SITE}/nothing-here/`,
  });
  assert.deepEqual(none.data.items, []);
  assert.match(none.data.note, /לא נמצא עמוד/);
  const posts = await tool(f.agent, "wp_list_posts", { front: true });
  assert.match(posts.error, /רלוונטי רק לעמודים/);
});

test("a tool result that is too long is truncated with a hint instead of ending the run", () => {
  const rows = Array.from({ length: 4000 }, (_, i) => ({
    id: i,
    title: "x".repeat(60),
  }));
  const cut = fitResult({ untrusted: true, data: rows });
  assert.equal(cut.truncated, true);
  assert.match(cut.hint, /חפשו לפי שם/);
  assert.ok(JSON.stringify(cut).length < 120000);
  assert.ok(cut.data.length < rows.length);
  const blob = fitResult({
    untrusted: true,
    data: { text: "y".repeat(500000) },
  });
  assert.equal(blob.truncated, true);
  assert.ok(JSON.stringify(blob).length < 120000);
  const small = { data: [1] };
  assert.equal(fitResult(small), small);
});

// ---- 2. the outline ---------------------------------------------------------------------------------------------------------------
test("wp_read_elementor_page on a large page: every element with id/type/preview, foreign widgets read-only", async (t) => {
  const f = await fixture(t);
  const r = await tool(f.agent, "wp_read_elementor_page", { id: 10 });
  assert.equal(r.data.isElementor, true);
  assert.equal(r.data.template, "elementor_header_footer");
  assert.ok(r.data.elements > 200);
  assert.ok(
    r.data.unsupported.includes("form") &&
      r.data.unsupported.includes("uael-info-box"),
  );
  assert.equal(
    r.data.structure,
    undefined,
    "no rebuild structure for a big page with foreign widgets",
  );
  const by = new Map(r.data.outline.map((e) => [e.id, e]));
  assert.equal(by.get("hero0001").type, "container");
  assert.equal(by.get("hero0001").set.background, "global:primary");
  assert.equal(by.get("hero0001").preview, "ברוכים הבאים");
  assert.deepEqual(by.get("ttl00001").set.color, "global:accent");
  assert.equal(by.get("ttl00001").set.text, "ברוכים הבאים");
  assert.equal(by.get("btn00001").set.url, "/about/");
  assert.equal(by.get("frm00001").readOnly, true);
  assert.equal(by.get("frm00001").type, "form");
  assert.equal(by.get("nav00001").readOnly, true);
  assert.match(r.data.outlineNote, /readOnly/);
  assert.ok(JSON.stringify(r).length < 120000);
});

// ---- 3. duplicate -----------------------------------------------------------------------------------------------------------------
test("duplicate: a draft copy with the identical Elementor data, page settings and template; verified; undo trashes it", async (t) => {
  const f = await fixture(t);
  const source = structuredClone(f.state.pages.get(10));
  const r = await prepare(f.agent, "wp_prepare_duplicate_page", { id: 10 });
  assert.equal(r.review.kind, "elementor-duplicate");
  assert.match(r.review.summary, /דף הבית/);
  assert.match(r.review.summary, /דף הבית — עותק/);
  assert.match(r.review.summary, new RegExp(`${count(bigPage())} אלמנטים`));
  assert.match(r.review.warning, /form/);
  assert.match(r.review.warning, /כמות שהם/);
  assert.equal(pageWrites(f).length, 0, "nothing is written while preparing");
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified");
  const [w] = pageWrites(f);
  assert.equal(pageWrites(f).length, 1);
  assert.equal(w.payload.status, "draft");
  assert.equal(w.payload.title, "דף הבית — עותק");
  assert.equal(w.payload.template, "elementor_header_footer");
  assert.deepEqual(Object.keys(w.payload.meta).sort(), [
    "_elementor_data",
    "_elementor_edit_mode",
    "_elementor_page_settings",
    "_elementor_template_type",
  ]);
  const copy = [...f.state.pages.values()].find(
    (p) => p.title === "דף הבית — עותק",
  );
  assert.equal(
    copy.meta._elementor_data,
    f.bigData,
    "byte-identical Elementor data",
  );
  assert.deepEqual(
    copy.meta._elementor_page_settings,
    source.meta._elementor_page_settings,
  );
  assert.equal(copy.meta._elementor_page_settings.custom_note, "keep me");
  assert.equal(copy.template, "elementor_header_footer");
  assert.equal(copy.status, "draft");
  assert.deepEqual(
    f.state.pages.get(10),
    source,
    "the source page is untouched",
  );
  assert.match(out.text, /עותק/);
  assert.ok(out.view, "the copy can be opened");
  // Undo: the copy goes to the trash; the source stays.
  const entry = f.agent
    .getActivityLog("p")
    .find((e) => e.action === "elementor-duplicate");
  assert.equal(entry.canUndo, true);
  const review = await f.agent.prepareUndo("p", entry.id);
  assert.equal(review.kind, "elementor-trash");
  const undone = await f.agent.decide("p", review.token, true);
  assert.equal(undone.outcome, "verified");
  assert.equal(copy.status, "trash");
  assert.equal(f.state.pages.get(10).status, "publish");
});

test("duplicate: refuses non-Elementor pages, a changed source, and a copy that does not equal the source", async (t) => {
  const f = await fixture(t);
  const plain = await tool(f.agent, "wp_prepare_duplicate_page", { id: 12 });
  assert.match(plain.error, /אינו עמוד Elementor|אינו חושף|לא נמצא/);
  const missing = await tool(f.agent, "wp_prepare_duplicate_page", {
    id: 9999,
  });
  assert.match(missing.error, /לא נמצא/);
  assert.equal(pageWrites(f).length, 0);
  // The source changes between review and approval.
  const r = await prepare(f.agent, "wp_prepare_duplicate_page", { id: 11 });
  f.state.pages.get(11).title = "שונה בינתיים";
  await assert.rejects(
    f.agent.decide("p", r.review.token, true),
    /המקורי השתנה/,
  );
  assert.equal(pageWrites(f).length, 0);
  // A site that drops the Elementor meta of the copy: the read-back catches it.
  const g = await fixture(t, { dropMeta: true });
  const r2 = await prepare(g.agent, "wp_prepare_duplicate_page", { id: 11 });
  const out = await g.agent.decide("p", r2.review.token, true);
  assert.equal(out.outcome, "unknown");
  assert.equal(g.agent.isBlocked("p"), true);
});

// ---- 4. targeted edits ------------------------------------------------------------------------------------------------------------
const EDIT = {
  id: 10,
  operations: [
    // A bright banner: the hero background (replaces the global reference), its title colour, the button label and link.
    { op: "set", id: "hero0001", set: { background: "#F5F5F5" } },
    { op: "set", id: "ttl00001", set: { color: "#1F3A5F", text: "שלום עולם" } },
    {
      op: "set",
      id: "btn00001",
      set: { text: "קראו עוד", url: "/news/", newTab: true },
    },
    // A new section after the section that contains a nested element.
    {
      op: "insert",
      position: "after",
      target: "txt00001",
      patterns: [
        {
          pattern: "cta-band",
          data: {
            title: "מהמקור ועד הרמקול",
            subtitle: "אזור חדש",
            buttonText: "צרו קשר",
            buttonUrl: "/contact/",
          },
        },
      ],
    },
    { op: "remove", id: "t00000064" },
  ],
};
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test("targeted edit: changes ONLY the targets; unknown and Pro widgets and every other element stay identical; read-back; CSS cleared; undo", async (t) => {
  const f = await fixture(t);
  const before = dataOf(f, 10);
  const beforeMap = flatten(before);
  const r = await prepare(
    f.agent,
    "wp_prepare_elementor_edit",
    structuredClone(EDIT),
  );
  assert.equal(r.review.kind, "elementor-edit");
  // A readable list of the changes.
  assert.match(
    r.review.summary,
    /כותרת 'ברוכים הבאים' #ttl00001: צבע ← #1F3A5F/,
  );
  assert.match(
    r.review.summary,
    /אזור 'ברוכים הבאים' #hero0001: רקע ← #F5F5F5/,
  );
  assert.match(r.review.summary, /כפתור 'לפרטים' #btn00001: קישור ← \/news\//);
  assert.match(
    r.review.summary,
    /נוסף 'מעודד פעולה|נוסף '.*' אחרי אזור 'ברוכים הבאים' #hero0001/,
  );
  assert.match(r.review.summary, /הוסר טקסט/);
  assert.match(r.review.warning, /form/);
  assert.match(r.review.warning, /כל שאר העמוד נשאר בדיוק/);
  assert.equal(pageWrites(f).length, 0, "nothing is written while preparing");
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified");
  assert.equal(
    f.state.cacheCalls,
    1,
    "the CSS cache is cleared after the write",
  );
  assert.equal(pageWrites(f).length, 1);
  assert.deepEqual(Object.keys(pageWrites(f)[0].payload.meta).sort(), [
    "_elementor_data",
    "_elementor_edit_mode",
  ]);
  const after = dataOf(f, 10);
  const afterMap = flatten(after);
  const changed = new Set(["hero0001", "ttl00001", "btn00001"]);
  const removed = new Set(["t00000064"]);
  // 1. Every element that was not targeted is deep-identical, foreign and Pro widgets included.
  for (const [id, el] of beforeMap) {
    if (removed.has(id)) {
      assert.ok(!afterMap.has(id), "removed");
      continue;
    }
    if (changed.has(id)) continue;
    // Containers lose/gain children only where we inserted/removed; compare their own settings and widget content.
    const got = afterMap.get(id);
    assert.ok(got, `${id} is still there`);
    assert.ok(
      sameJson(got.settings, el.settings),
      `${id} settings are identical`,
    );
    if (el.elType === "widget")
      assert.ok(sameJson(got, el), `${id} is byte-identical`);
  }
  for (const id of ["frm00001", "nav00001", "sld00001"])
    assert.ok(
      sameJson(afterMap.get(id), beforeMap.get(id)),
      `${id} (foreign) is identical`,
    );
  assert.ok(
    sameJson(
      beforeMap.get("frm00001").settings.form_fields,
      afterMap.get("frm00001").settings.form_fields,
    ),
  );
  assert.equal(
    afterMap.get("u00000064") ? JSON.stringify(afterMap.get("u00000064")) : "x",
    beforeMap.get("u00000064")
      ? JSON.stringify(beforeMap.get("u00000064"))
      : "x",
  );
  // 2. The targets changed only in what was asked.
  const hero = afterMap.get("hero0001");
  assert.equal(hero.settings.background_color, "#F5F5F5");
  assert.equal(
    hero.settings.__globals__?.background_color,
    undefined,
    "the global reference no longer wins",
  );
  for (const k of [
    "_css_classes",
    "motion_fx_motion_fx_scrolling",
    "padding",
    "content_width",
    "flex_direction",
  ])
    assert.ok(
      sameJson(hero.settings[k], beforeMap.get("hero0001").settings[k]),
      `hero ${k} kept`,
    );
  const title = afterMap.get("ttl00001");
  assert.equal(title.settings.title, "שלום עולם");
  assert.equal(title.settings.title_color, "#1F3A5F");
  assert.equal(title.settings.__globals__.title_color, undefined);
  assert.equal(
    title.settings.__globals__.typography_typography,
    "globals/typography?id=primary",
    "other globals kept",
  );
  assert.equal(title.settings._animation, "fadeInUp");
  assert.ok(
    sameJson(
      title.settings._margin,
      beforeMap.get("ttl00001").settings._margin,
    ),
  );
  const btn = afterMap.get("btn00001");
  assert.equal(btn.settings.text, "קראו עוד");
  assert.equal(btn.settings.link.url, "/news/");
  assert.equal(btn.settings.link.is_external, "on");
  assert.equal(btn.settings.hover_animation, "grow");
  assert.equal(btn.settings.background_color, "#D9731A");
  // 3. The new section sits after the section that contains the target (top level), the page grew by the new elements only.
  assert.equal(after[0].id, "hero0001");
  assert.equal(after[1].elType, "container");
  assert.ok(!beforeMap.has(after[1].id), "the new section has a fresh id");
  assert.equal(after[2].id, "sec00000064", "the old second section follows it");
  assert.ok(count(after) > count(before));
  // 4. Undo restores the previous data exactly and is verified.
  const entry = f.agent
    .getActivityLog("p")
    .find((e) => e.action === "elementor-edit");
  assert.equal(entry.canUndo, true);
  const review = await f.agent.prepareUndo("p", entry.id);
  assert.equal(review.kind, "elementor-revert");
  const undone = await f.agent.decide("p", review.token, true);
  assert.equal(undone.outcome, "verified");
  assert.equal(
    f.state.pages.get(10).meta._elementor_data,
    f.bigData,
    "byte-identical after undo",
  );
});

test("targeted edit: move, nested set, image and spacing, and the rest of the page is untouched", async (t) => {
  const f = await fixture(t);
  const beforeMap = flatten(dataOf(f, 10));
  const { result } = await approve(f, "wp_prepare_elementor_edit", {
    id: 10,
    operations: [
      { op: "set", id: "sec00000064", set: { paddingX: 40 } },
      {
        op: "set",
        id: "b00000064",
        set: { color: "#FFFFFF", background: "#1F3A5F", size: 20 },
      },
      { op: "move", id: "sec0000006e", position: "before", target: "hero0001" },
    ],
  });
  assert.equal(result.outcome, "verified");
  const after = dataOf(f, 10);
  assert.equal(after[0].id.length > 0, true);
  const map = flatten(after);
  const sec = map.get("sec00000064");
  assert.equal(sec.settings.padding.right, "40");
  assert.equal(sec.settings.padding.left, "40");
  assert.equal(
    sec.settings.padding.top,
    "60",
    "the other padding sides are kept",
  );
  const btn = map.get("b00000064");
  assert.equal(btn.settings.button_text_color, "#FFFFFF");
  assert.equal(btn.settings.background_color, "#1F3A5F");
  assert.equal(btn.settings.typography_font_size.size, 20);
  assert.equal(btn.settings.link.url, "/contact/", "the link is kept");
  assert.equal(btn.settings.link.is_external, "on");
  assert.equal(after[0].id, "sec0000006e", "moved to the top");
  for (const id of [
    "frm00001",
    "nav00001",
    "sld00001",
    "p00000064",
    "u00000064",
  ])
    if (beforeMap.has(id))
      assert.ok(sameJson(map.get(id), beforeMap.get(id)), `${id} identical`);
});

test("targeted edit: unsafe or impossible operations are refused with a reason and nothing is written", async (t) => {
  const f = await fixture(t);
  const bad = async (operations, re) => {
    const res = await tool(f.agent, "wp_prepare_elementor_edit", {
      id: 10,
      operations,
    });
    assert.match(res.error, re, JSON.stringify(operations));
  };
  await bad(
    [{ op: "set", id: "zzzzzzzz", set: { text: "x" } }],
    /לא נמצא בעמוד/,
  );
  await bad(
    [{ op: "set", id: "frm00001", set: { text: "x" } }],
    /אפשר רק להסיר או להזיז/,
  );
  await bad(
    [{ op: "set", id: "ttl00001", set: { html: "<p>x</p>" } }],
    /html|אינו מוכר/,
  );
  await bad(
    [{ op: "set", id: "hero0001", set: { text: "x" } }],
    /text|אינו מוכר/,
  );
  await bad(
    [{ op: "set", id: "txt00001", set: { html: "<script>alert(1)</script>" } }],
    /script|אסור|תג|מותר/,
  );
  await bad(
    [{ op: "set", id: "btn00001", set: { url: "javascript:alert(1)" } }],
    /javascript/,
  );
  await bad([{ op: "set", id: "btn00001", set: { background: "red" } }], /צבע/);
  await bad(
    [{ op: "set", id: "ttl00001", set: { color: "global:nope" } }],
    /הצבע הגלובלי/,
  );
  await bad(
    [
      { op: "set", id: "ttl00001", set: { color: "#1F3A5F" } },
      { op: "remove", id: "ttl00001" },
      { op: "set", id: "ttl00001", set: { text: "y" } },
    ],
    /לא נמצא בעמוד/,
  );
  await bad(
    [{ op: "set", id: "hero0001", set: { backgroundImage: 4040 } }],
    /לא נמצאה|מדיה/,
  );
  await bad(
    [{ op: "set", id: "hero0001", set: { overlay: "#000000" } }],
    /שכבת צבע אפשרית רק/,
  );
  await bad(
    [{ op: "move", id: "ttl00001", position: "before", target: "hero0001" }],
    /רמה העליונה/,
  );
  await bad(
    [{ op: "move", id: "hero0001", position: "after", target: "ttl00001" }],
    /לתוך עצמו/,
  );
  await bad([{ op: "insert", position: "start" }], /patterns|containers/);
  await bad(
    [
      {
        op: "insert",
        position: "after",
        patterns: [{ pattern: "cta-band", data: { title: "x" } }],
      },
    ],
    /target/,
  );
  await bad(
    [
      {
        op: "insert",
        position: "end",
        containers: [{ children: [{ type: "html", html: "<b>x</b>" }] }],
      },
    ],
    /אסור|לא מוכר/,
  );
  await bad(
    [{ op: "set", id: "ttl00001", set: { text: "ברוכים הבאים" } }],
    /אין שינוי/,
  );
  await bad([{ op: "rewrite", id: "x" }], /set, insert, remove/);
  assert.equal(pageWrites(f).length, 0);
  // A page the editor does not own: a regular (non-Elementor) page.
  const plain = await tool(f.agent, "wp_prepare_elementor_edit", {
    id: 12,
    operations: [{ op: "remove", id: "abc12345" }],
  });
  assert.match(plain.error, /אינו עמוד Elementor|אינו חושף/);
});

test("targeted edit: a read-back that does not match the original with exactly these operations blocks the project", async (t) => {
  const f = await fixture(t, { dropMeta: true });
  const r = await prepare(f.agent, "wp_prepare_elementor_edit", {
    id: 10,
    operations: [{ op: "set", id: "ttl00001", set: { text: "שלום" } }],
  });
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "unknown");
  assert.equal(f.agent.isBlocked("p"), true);
  assert.equal(pageWrites(f).length, 1, "no retry");
});

// ---- 5. build plans: copy, then edit the copy --------------------------------------------------------------------------------------
test("build plan: duplicate the page, then edit the copy by {{copy.id}}; undo of the plan trashes the copy", async (t) => {
  const step = (key, tool, args) => ({ key, tool, args });
  const dup = step("copy", "wp_prepare_duplicate_page", {
    id: 10,
    title: "דף בית חדש",
  });
  const edit = step("tweak", "wp_prepare_elementor_edit", {
    id: "{{copy.id}}",
    operations: [{ op: "set", id: "ttl00001", set: { text: "כותרת חדשה" } }],
  });
  assert.doesNotThrow(() =>
    validatePlan({ title: "x", steps: [dup, edit] }, argumentsFor),
  );
  assert.throws(
    () => validatePlan({ title: "x", steps: [edit, dup] }, argumentsFor),
    /הפניה|קודם/,
  );
  assert.throws(
    () =>
      validatePlan(
        {
          title: "x",
          steps: [
            step("up", "wp_prepare_upload_image", {
              url: "https://example.com/a.png",
              fileName: "a.png",
              alt: "x",
            }),
            step("tweak", "wp_prepare_elementor_edit", {
              id: "{{up.id}}",
              operations: edit.args.operations,
            }),
          ],
        },
        argumentsFor,
      ),
    /עותק שנוצר/,
  );
  const f = await fixture(t);
  const r = await prepare(f.agent, "wp_prepare_build_plan", {
    title: "העתקה ועריכה",
    steps: [dup, edit],
  });
  assert.ok(r.review, r.text);
  assert.equal(pageWrites(f).length, 0, "nothing is written while preparing");
  assert.match(JSON.stringify(r.review), /כותרת חדשה|שינויים ממוקדים/);
  const done = await f.agent.decide("p", r.review.token, true);
  assert.equal(done.outcome, "verified");
  const copy = [...f.state.pages.values()].find(
    (p) => p.title === "דף בית חדש",
  );
  assert.ok(copy);
  const data = JSON.parse(copy.meta._elementor_data);
  assert.equal(flatten(data).get("ttl00001").settings.title, "כותרת חדשה");
  assert.ok(
    sameJson(
      flatten(data).get("frm00001"),
      flatten(JSON.parse(f.bigData)).get("frm00001"),
    ),
  );
  assert.equal(
    JSON.parse(f.state.pages.get(10).meta._elementor_data)[0].elements[0]
      .settings.title,
    "ברוכים הבאים",
    "the source is untouched",
  );
  // Undo the whole plan.
  const rev = await f.agent.plans.prepareUndo("p", r.review.token);
  const token = rev.review?.token ?? rev.token ?? f.agent.review("p").token;
  const undone = await f.agent.decide("p", token, true);
  assert.equal(undone.outcome, "verified");
  assert.equal(copy.status, "trash");
  assert.equal(f.state.pages.get(10).status, "publish");
});

test("guards and wiring: only valid template strings reach the site; the agent is told to copy and edit, never to rebuild", async (t) => {
  const f = await fixture(t);
  const el = f.agent.elementor;
  const post = (payload) =>
    el.request("p", {
      route: "pages",
      method: "POST",
      payload,
      signal: AbortSignal.timeout(5000),
    });
  await assert.rejects(post({ title: "x", template: "../../evil" }));
  await assert.rejects(post({ title: "x", template: 5 }));
  await assert.rejects(
    post({ title: "x", meta: { _elementor_template_type: "<b>" } }),
  );
  const { ELEMENTOR_GUIDE } = require("../src/elementor-instructions.cjs");
  assert.match(ELEMENTOR_GUIDE, /NEVER rebuild an existing page/);
  assert.match(ELEMENTOR_GUIDE, /wp_prepare_duplicate_page/);
  assert.match(ELEMENTOR_GUIDE, /wp_prepare_elementor_edit/);
  assert.match(ELEMENTOR_GUIDE, /per_page up to 50/);
  assert.ok(f.agent.context("p").includes("wp_prepare_elementor_edit"));
});

// ---- page layout (template) --------------------------------------------------------------------------------------------------------
test("page template: create with full width, edit a page's layout alone or with operations; review, read-back and undo", async (t) => {
  const f = await fixture(t);
  // Create with Elementor Full Width ("רוחב מלא").
  const created = await prepare(f.agent, "wp_prepare_elementor_page", {
    title: "עמוד ברוחב מלא",
    pageTemplate: "full-width",
    containers: [{ children: [{ type: "heading", text: "שלום", level: 2 }] }],
  });
  assert.match(created.review.summary, /תבנית העמוד: Elementor רוחב מלא/);
  const out = await f.agent.decide("p", created.review.token, true);
  assert.equal(out.outcome, "verified");
  const [w] = pageWrites(f);
  assert.equal(w.payload.template, "elementor_header_footer");
  const copy = [...f.state.pages.values()].find(
    (p) => p.title === "עמוד ברוחב מלא",
  );
  assert.equal(copy.template, "elementor_header_footer");
  // Not given: no template key is sent.
  const g = await fixture(t);
  await approve(g, "wp_prepare_elementor_page", {
    title: "רגיל",
    containers: [{ children: [{ type: "heading", text: "שלום", level: 2 }] }],
  });
  assert.ok(!("template" in pageWrites(g)[0].payload));
  // Invalid layout name.
  const bad = await tool(f.agent, "wp_prepare_elementor_page", {
    title: "x",
    pageTemplate: "wide",
    containers: [{ children: [{ type: "heading", text: "שלום", level: 2 }] }],
  });
  assert.match(bad.error, /pageTemplate/);

  // Layout alone on an existing page (no operations), then the same again, then undo.
  const h = await fixture(t);
  const before = h.state.pages.get(11).meta._elementor_data;
  const r = await prepare(h.agent, "wp_prepare_elementor_edit", {
    id: 11,
    pageTemplate: "full-width",
  });
  assert.match(
    r.review.summary,
    /תבנית העמוד: ברירת המחדל של ערכת העיצוב ← Elementor רוחב מלא/,
  );
  assert.equal(pageWrites(h).length, 0);
  const done = await h.agent.decide("p", r.review.token, true);
  assert.equal(done.outcome, "verified");
  assert.deepEqual(pageWrites(h)[0].payload, {
    template: "elementor_header_footer",
  });
  assert.equal(h.state.pages.get(11).template, "elementor_header_footer");
  assert.equal(
    h.state.pages.get(11).meta._elementor_data,
    before,
    "the content is untouched",
  );
  const same = await tool(h.agent, "wp_prepare_elementor_edit", {
    id: 11,
    pageTemplate: "full-width",
  });
  assert.match(same.error, /אין שינוי/);
  const entry = h.agent
    .getActivityLog("p")
    .find((e) => e.action === "elementor-edit");
  const review = await h.agent.prepareUndo("p", entry.id);
  assert.equal(review.kind, "elementor-revert");
  const undone = await h.agent.decide("p", review.token, true);
  assert.equal(undone.outcome, "verified");
  assert.equal(
    h.state.pages.get(11).template,
    "",
    "the previous layout is back",
  );
  assert.equal(h.state.pages.get(11).meta._elementor_data, before);

  // Canvas together with operations on the big page; default goes back to the theme's.
  const k = await fixture(t);
  const both = await approve(k, "wp_prepare_elementor_edit", {
    id: 10,
    pageTemplate: "canvas",
    operations: [{ op: "set", id: "ttl00001", set: { text: "שלום" } }],
  });
  assert.equal(both.result.outcome, "verified");
  assert.equal(k.state.pages.get(10).template, "elementor_canvas");
  assert.match(both.review.summary, /Elementor Canvas/);
  assert.equal(dataOf(k, 10)[0].elements[0].settings.title, "שלום");
  const back = await approve(k, "wp_prepare_elementor_edit", {
    id: 10,
    pageTemplate: "default",
  });
  assert.equal(back.result.outcome, "verified");
  assert.equal(k.state.pages.get(10).template, "");
  // A template that the read-back does not find blocks the project (a site that ignores the field).
  const stuck = await fixture(t, { ignoreTemplate: true });
  const r2 = await prepare(stuck.agent, "wp_prepare_elementor_edit", {
    id: 11,
    pageTemplate: "canvas",
  });
  const o2 = await stuck.agent.decide("p", r2.review.token, true);
  assert.equal(o2.outcome, "unknown");
  assert.equal(stuck.agent.isBlocked("p"), true);
  assert.match(f.agent.context("p"), /pageTemplate|PAGE LAYOUT/);
});
