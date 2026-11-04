"use strict";
// Elementor page building through core REST against an in-memory fake WordPress: simple structure -> validated, built Elementor
// JSON; review first; exact read-back; activity log; undo; unsafe content refused; build plans with image references.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Agent, argumentsFor, tools } = require("../src/wp-agent.cjs");
const { WordPress } = require("../src/wordpress.cjs");
const { validatePlan } = require("../src/wp-plans.cjs");
const {
  validateElementor,
  buildElementorData,
  checkBuilt,
  toStructure,
  canonText,
} = require("../src/wp-elementor.cjs");

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
const mediaItem = (id, over = {}) => ({
  id,
  status: "inherit",
  title: { raw: id === 42 ? "hero.png" : `file-${id}` },
  alt_text: id === 42 ? "נוף ירוק" : "",
  media_type: "image",
  mime_type: "image/png",
  source_url: `${SITE}/wp-content/uploads/file-${id}.png`,
  modified: "2026-10-13T10:00:00",
  ...over,
});
const stored = (text = "ישן") =>
  JSON.stringify([
    {
      id: "a1b2c3d4",
      elType: "container",
      isInner: false,
      settings: { content_width: "boxed", flex_direction: "column" },
      elements: [
        {
          id: "b2c3d4e5",
          elType: "widget",
          widgetType: "heading",
          isInner: false,
          settings: { title: text, header_size: "h2" },
          elements: [],
        },
      ],
    },
  ]);
async function fixture(t, over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-elementor-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const state = {
    plugins: [
      { plugin: "elementor/elementor", status: "active", version: "4.3.6" },
    ],
    pluginsForbidden: false,
    namespaces: ["wp/v2", "elementor/v1"],
    globals: {
      colors: {
        primary: { id: "primary", title: "Primary", value: "#6EC1E4" },
        secondary: { id: "secondary", title: "Secondary", value: "#54595F" },
        text: { id: "text", title: "Text", value: "#7A7A7A" },
        accent: { id: "accent", title: "Accent", value: "#61CE70" },
      },
      typography: Object.fromEntries(
        ["primary", "secondary", "text", "accent"].map((id, i) => [
          id,
          {
            id,
            title: id[0].toUpperCase() + id.slice(1),
            value: {
              typography_typography: "custom",
              typography_font_family: [
                "Roboto",
                "Roboto Slab",
                "Roboto",
                "Roboto",
              ][i],
              typography_font_weight: ["600", "400", "400", "500"][i],
              typography_font_size: { unit: "px", size: "", sizes: [] },
            },
          },
        ]),
      ),
    },
    categories: new Map([
      [
        1,
        {
          id: 1,
          name: "Uncategorized",
          slug: "uncategorized",
          description: "",
          parent: 0,
        },
      ],
    ]),
    posts: new Map(),
    cacheCalls: [],
    cacheMode: "ok",
    globalsRoutesMissing: false,
    globalsForbidden: false,
    globalsDrop: false,
    globalsMissing: false,
    language: "he_IL",
    exposeMeta: true,
    dropMeta: false,
    next: 100,
    pages: new Map([
      [
        2,
        {
          id: 2,
          title: "Sample Page",
          status: "publish",
          meta: {
            _elementor_data: "",
            _elementor_edit_mode: "",
            _elementor_template_type: "",
          },
        },
      ],
    ]),
    media: new Map([
      [42, mediaItem(42)],
      [43, mediaItem(43, { media_type: "file", mime_type: "video/mp4" })],
      [44, mediaItem(44, { source_url: "https://evil.example/x.png" })],
    ]),
    deletedMedia: false,
    failAfterApply: null,
    failBeforeApply: null,
    ...over,
  };
  const pageJson = (p) => ({
    id: p.id,
    title: { raw: p.title, rendered: p.title },
    content: { raw: "", rendered: "" },
    status: p.status,
    modified: "2026-10-13T10:00:00",
    meta: state.exposeMeta ? { footnotes: "", ...p.meta } : { footnotes: "" },
  });
  const wp = new WordPress(dir, storage, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (url, options) => {
      if (options.binary)
        return { status: 200, contentType: "image/png", body: png };
      const route = url.searchParams.get("rest_route") || "/";
      const method = options.method || "GET";
      const payload =
        options.body && !Buffer.isBuffer(options.body)
          ? JSON.parse(options.body)
          : undefined;
      calls.push({ route, method, payload, url });
      const reply = (data, status = 200) => ({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
      const err = (status, code) =>
        reply({ code, message: "x", data: { status } }, status);
      const result = () => {
        if (route === "/wp/v2/users/me") return reply({ id: 7 });
        if (route === "/") return reply({ namespaces: state.namespaces });
        if (route === "/elementor/v1/cache") {
          state.cacheCalls.push({ method, order: calls.length });
          if (method !== "DELETE") return err(404, "rest_no_route");
          if (state.cacheMode === "forbidden")
            return err(403, "rest_forbidden");
          if (state.cacheMode === "missing") return err(404, "rest_no_route");
          if (state.cacheMode === "empty")
            return { status: 204, contentType: "application/json", body: "" };
          return reply({ success: true });
        }
        if (route === "/wp/v2/settings")
          return reply({ title: "Site", language: state.language });
        if (route === "/wp/v2/plugins")
          return state.pluginsForbidden
            ? err(403, "rest_cannot_view_plugins")
            : reply(state.plugins);
        if (route === "/wp/v2/types")
          return reply({
            post: {
              slug: "post",
              name: "Posts",
              rest_base: "posts",
              rest_namespace: "wp/v2",
              hierarchical: false,
              taxonomies: ["category"],
            },
            page: {
              slug: "page",
              name: "Pages",
              rest_base: "pages",
              rest_namespace: "wp/v2",
              hierarchical: true,
              taxonomies: [],
            },
          });
        if (route === "/wp/v2/taxonomies")
          return reply({
            category: {
              slug: "category",
              name: "Categories",
              rest_base: "categories",
              rest_namespace: "wp/v2",
              hierarchical: true,
              types: ["post"],
            },
          });
        const cat = /^\/wp\/v2\/categories(?:\/(\d+))?$/.exec(route);
        if (cat) {
          const id = cat[1] ? Number(cat[1]) : null;
          const json = (c) => ({ ...c, count: 0 });
          if (method === "GET" && id === null) {
            const q = url.searchParams;
            let list = [...state.categories.values()];
            if (q.get("search"))
              list = list.filter((x) =>
                x.name.toLowerCase().includes(q.get("search").toLowerCase()),
              );
            if (q.get("slug"))
              list = list.filter((x) => x.slug === q.get("slug"));
            if (q.get("parent"))
              list = list.filter((x) => x.parent === Number(q.get("parent")));
            return reply(list.map(json));
          }
          if (method === "GET")
            return state.categories.has(id)
              ? reply(json(state.categories.get(id)))
              : err(404, "rest_term_invalid");
          if (method === "DELETE") {
            const prev = state.categories.get(id);
            state.categories.delete(id);
            return reply({ deleted: true, previous: json(prev) });
          }
          if (method === "POST" && id === null) {
            const c = {
              id: state.next++,
              name: payload.name,
              slug:
                payload.slug || payload.name.toLowerCase().replace(/\s+/g, "-"),
              description: payload.description || "",
              parent: payload.parent || 0,
            };
            state.categories.set(c.id, c);
            return reply(json(c), 201);
          }
        }
        const post = /^\/wp\/v2\/posts(?:\/(\d+))?$/.exec(route);
        if (post) {
          const id = post[1] ? Number(post[1]) : null;
          const out = (x) => ({
            id: x.id,
            title: { raw: x.title },
            content: { raw: x.content },
            status: x.status,
            modified: "2026-10-13T10:00:00",
          });
          if (method === "GET")
            return state.posts.has(id)
              ? reply(out(state.posts.get(id)))
              : err(404, "rest_post_invalid_id");
          let x;
          if (id === null) {
            x = {
              id: state.next++,
              title: payload.title,
              content: payload.content ?? "",
              status: payload.status || "draft",
            };
            state.posts.set(x.id, x);
          } else x = state.posts.get(id);
          for (const k of ["title", "content", "status"])
            if (payload[k] !== undefined) x[k] = payload[k];
          return reply(out(x), id === null ? 201 : 200);
        }
        const gl =
          /^\/elementor\/v1\/globals\/(colors|typography)(?:\/([a-z0-9_-]+))?$/.exec(
            route,
          );
        if (gl) {
          if (state.globalsRoutesMissing) return err(404, "rest_no_route");
          const bucket = state.globals[gl[1]];
          if (method === "GET")
            return gl[2]
              ? bucket[gl[2]]
                ? reply(bucket[gl[2]])
                : err(404, "x")
              : reply(bucket);
          if (state.globalsForbidden) return err(403, "rest_forbidden");
          if (state.globalsDrop) return reply({ ...payload, id: gl[2] });
          bucket[gl[2]] = {
            id: gl[2],
            title: payload.title,
            value: payload.value,
          };
          return reply(bucket[gl[2]]);
        }
        if (route === "/elementor/v1/globals")
          return state.globalsMissing
            ? err(404, "rest_no_route")
            : reply(state.globals);
        const media = /^\/wp\/v2\/media(?:\/(\d+))?$/.exec(route);
        if (media) {
          if (method === "POST") {
            state.media.set(42, mediaItem(42));
            return reply(state.media.get(42), 201);
          }
          const id = Number(media[1]);
          if (method === "DELETE") {
            state.deletedMedia = true;
            return reply({ deleted: true, previous: { id } });
          }
          if (state.deletedMedia && id === 42)
            return err(404, "rest_post_invalid_id");
          return state.media.has(id)
            ? reply(state.media.get(id))
            : err(404, "rest_post_invalid_id");
        }
        const pages = /^\/wp\/v2\/pages(?:\/(\d+))?$/.exec(route);
        if (pages) {
          const id = pages[1] ? Number(pages[1]) : null;
          if (method === "GET" && id === null)
            return reply([...state.pages.values()].map(pageJson));
          if (method === "GET")
            return state.pages.has(id)
              ? reply(pageJson(state.pages.get(id)))
              : err(404, "rest_post_invalid_id");
          if (state.failBeforeApply?.(payload, id))
            throw Error("Injected network failure");
          let page;
          if (id === null) {
            page = {
              id: state.next++,
              title: payload.title,
              status: payload.status || "draft",
              meta: {
                _elementor_data: "",
                _elementor_edit_mode: "",
                _elementor_template_type: "",
              },
            };
            state.pages.set(page.id, page);
          } else page = state.pages.get(id);
          if (!page) return err(404, "rest_post_invalid_id");
          if (payload.title !== undefined) page.title = payload.title;
          if (payload.status !== undefined) page.status = payload.status;
          if (payload.meta && !state.dropMeta)
            Object.assign(page.meta, payload.meta);
          const out = reply(pageJson(page), id === null ? 201 : 200);
          if (state.failAfterApply?.(payload, id))
            throw Error("Injected network failure");
          return out;
        }
        throw Error(`Unexpected mock route ${route}`);
      };
      return result();
    },
  });
  await wp.connect("p", {
    site: SITE,
    username: "fixture",
    password: "PUBLIC-DUMMY",
  });
  return { dir, wp, agent: new Agent(wp, dir), state, calls };
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
const writes = (f) =>
  f.calls.filter(
    (c) => c.method !== "GET" && c.route.startsWith("/wp/v2/pages"),
  );
const PAGE = {
  title: "עמוד בית",
  containers: [
    {
      width: "full",
      direction: "column",
      gap: 20,
      paddingY: 80,
      paddingX: 24,
      background: "global:primary",
      children: [
        {
          type: "heading",
          text: "ברוכים הבאים",
          level: 1,
          color: "#ffffff",
          font: "global:primary",
        },
        {
          type: "text-editor",
          html: '<p>טקסט <strong>מודגש</strong> ו<a href="/about/">קישור</a></p>',
        },
        { type: "image", mediaId: 42, alt: "נוף", width: 60 },
        {
          type: "button",
          text: "צרו קשר",
          url: "/contact/",
          background: "global:accent",
          color: "#ffffff",
        },
        {
          type: "container",
          direction: "row",
          gap: 10,
          children: [
            {
              type: "icon-list",
              items: [
                { text: "ראשון" },
                { text: "שני", url: "https://example.com/x" },
              ],
              icon: "check",
            },
            { type: "spacer", height: 20 },
            { type: "divider" },
          ],
        },
      ],
    },
  ],
};
const clone = (v) => structuredClone(v);
const approve = async (f, name, args) => {
  const r = await prepare(f.agent, name, args);
  assert.ok(r.review, r.text);
  return {
    review: r.review,
    result: await f.agent.decide("p", r.review.token, true),
  };
};
const undo = async (f, action) => {
  const entry = f.agent.getActivityLog("p").find((e) => e.action === action);
  assert.ok(entry, "log entry " + action);
  assert.equal(entry.canUndo, true);
  const review = await f.agent.prepareUndo("p", entry.id);
  return {
    entry,
    review,
    result: await f.agent.decide("p", review.token, true),
  };
};
const walk = (data, fn) =>
  data.forEach((el) => {
    fn(el);
    walk(el.elements, fn);
  });

test("create: review first, valid Elementor JSON built by the app, RTL + global references, exact read-back, undo to trash", async (t) => {
  const f = await fixture(t);
  const r = await prepare(f.agent, "wp_prepare_elementor_page", clone(PAGE));
  assert.equal(r.review.kind, "elementor-create");
  assert.match(
    r.review.summary,
    /ייווצר עמוד Elementor חדש כטיוטה: 'עמוד בית'/,
  );
  assert.match(r.review.summary, /מכולה 1: כותרת 'ברוכים הבאים'/);
  assert.match(r.review.warning, /טיוטה בלבד/);
  assert.ok(r.review.payload.structure, "the exact simple structure is shown");
  assert.equal(
    r.review.payload.meta,
    undefined,
    "the raw JSON is not dumped into the card",
  );
  assert.equal(writes(f).length, 0, "nothing is written before approval");
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified");
  assert.ok(out.undo && out.view, "undo and view are offered");
  assert.equal(writes(f).length, 1, "exactly one write");
  const sent = writes(f)[0].payload;
  assert.equal(sent.status, "draft");
  assert.equal(sent.title, "עמוד בית");
  assert.equal(sent.meta._elementor_edit_mode, "builder");
  assert.equal(sent.meta._elementor_template_type, "wp-page");
  const data = JSON.parse(sent.meta._elementor_data);
  const ids = [];
  const kinds = new Set();
  walk(data, (el) => {
    ids.push(el.id);
    assert.match(el.id, /^[0-9a-f]{8}$/);
    assert.ok(["container", "widget"].includes(el.elType));
    assert.equal(typeof el.isInner, "boolean");
    assert.ok(Array.isArray(el.elements));
    kinds.add(el.widgetType || "container");
  });
  assert.equal(new Set(ids).size, ids.length, "unique element ids");
  assert.deepEqual([...kinds].sort(), [
    "button",
    "container",
    "divider",
    "heading",
    "icon-list",
    "image",
    "spacer",
    "text-editor",
  ]);
  const [outer] = data;
  assert.equal(outer.settings.content_width, "full");
  assert.deepEqual(outer.settings.__globals__, {
    background_color: "globals/colors?id=primary",
  });
  assert.equal(outer.elements.at(-1).isInner, true);
  const [heading, text, image, button] = outer.elements;
  assert.equal(heading.settings.align, "right", "Hebrew: right aligned");
  assert.equal(text.settings.align, "right");
  assert.equal(button.settings.align, "right");
  assert.equal(heading.settings.header_size, "h1");
  assert.equal(heading.settings.title_color, "#ffffff");
  assert.equal(
    heading.settings.__globals__.typography_typography,
    "globals/typography?id=primary",
  );
  assert.equal(
    button.settings.__globals__.background_color,
    "globals/colors?id=accent",
  );
  assert.deepEqual(button.settings.link.url, "/contact/");
  assert.equal(image.settings.image.id, 42);
  assert.equal(
    image.settings.image.url,
    `${SITE}/wp-content/uploads/file-42.png`,
  );
  assert.equal(image.settings.image.alt, "נוף");
  assert.equal(
    outer.elements.at(-1).settings.flex_justify_content,
    "flex-start",
  );
  // Read-back, ledger and activity log.
  const log = f.agent
    .getActivityLog("p")
    .find((e) => e.action === "elementor-create");
  assert.equal(log.state, "verified");
  assert.equal(log.written.status, "draft");
  assert.equal(log.written.editMode, "builder");
  assert.equal(
    f.state.pages.get(log.written.id).meta._elementor_edit_mode,
    "builder",
  );
  // Undo: the created draft goes to the trash.
  const u = await undo(f, "elementor-create");
  assert.equal(u.review.kind, "elementor-trash");
  assert.equal(u.result.outcome, "verified");
  assert.equal(f.state.pages.get(log.written.id).status, "trash");
});

test("update: replaces an Elementor page, old data is kept, undo restores the previous _elementor_data exactly", async (t) => {
  const f = await fixture(t);
  const original = stored("כותרת ישנה");
  f.state.pages.set(5, {
    id: 5,
    title: "ישן",
    status: "publish",
    meta: {
      _elementor_data: original,
      _elementor_edit_mode: "builder",
      _elementor_template_type: "wp-page",
    },
  });
  const args = { id: 5, containers: clone(PAGE).containers };
  const r = await prepare(f.agent, "wp_prepare_elementor_page", args);
  assert.equal(r.review.kind, "elementor-update");
  assert.match(r.review.warning, /עמוד מפורסם/);
  assert.match(
    r.review.warning,
    /Regenerate CSS/,
    "the CSS cache is not cleared: the user is told",
  );
  assert.equal(
    r.review.before.data,
    undefined,
    "the old JSON is not dumped into the card",
  );
  assert.equal(f.state.pages.get(5).meta._elementor_data, original);
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified");
  assert.match(out.text, /Regenerate CSS/);
  assert.notEqual(f.state.pages.get(5).meta._elementor_data, original);
  assert.equal(
    f.state.pages.get(5).title,
    "ישן",
    "an unchanged title is not rewritten",
  );
  const u = await undo(f, "elementor-update");
  assert.equal(u.review.kind, "elementor-revert");
  assert.equal(u.result.outcome, "verified");
  assert.equal(
    f.state.pages.get(5).meta._elementor_data,
    original,
    "the previous Elementor data is restored byte for byte",
  );
});

test("a page changed on the site after the review is not overwritten", async (t) => {
  const f = await fixture(t);
  f.state.pages.set(5, {
    id: 5,
    title: "ישן",
    status: "draft",
    meta: {
      _elementor_data: stored(),
      _elementor_edit_mode: "builder",
      _elementor_template_type: "",
    },
  });
  const r = await prepare(f.agent, "wp_prepare_elementor_page", {
    id: 5,
    containers: clone(PAGE).containers,
  });
  f.state.pages.get(5).meta._elementor_data = stored("שונה ידנית");
  await assert.rejects(
    f.agent.decide("p", r.review.token, true),
    /השתנה מאז הבדיקה/,
  );
  assert.equal(writes(f).length, 0);
});

test("unsafe or unsupported content is refused with the exact reason, and nothing is written", async (t) => {
  const f = await fixture(t);
  const page = (child) => ({ title: "x", containers: [{ children: [child] }] });
  const bad = [
    [{ type: "html", text: "<b>x</b>" }, /אסור/],
    [{ type: "shortcode", text: "[gallery]" }, /אסור/],
    [
      { type: "text-editor", html: "<p>a</p><script>alert(1)</script>" },
      /script/,
    ],
    [{ type: "text-editor", html: '<p onclick="x()">a</p>' }, /onclick|מאפיין/],
    [
      { type: "text-editor", html: '<a href="javascript:alert(1)">x</a>' },
      /href|מאפיין/,
    ],
    [
      { type: "text-editor", html: '<img src="https://evil.example/a.png">' },
      /img/,
    ],
    [
      {
        type: "text-editor",
        html: '<iframe src="https://evil.example"></iframe>',
      },
      /iframe/,
    ],
    [
      { type: "text-editor", html: "<p>[contact-form-7 id=1]</p>" },
      /shortcode/,
    ],
    [{ type: "heading", text: "<b>x</b>" }, /טקסט רגיל/],
    [{ type: "button", text: "x", url: "javascript:alert(1)" }, /javascript/],
    [{ type: "button", text: "x", url: "data:text/html;base64,AAAA" }, /data/],
    [{ type: "button", text: "x", url: "http://example.com" }, /https/],
    [{ type: "button", text: "x", url: "//evil.example/x" }, /https|יחסית/],
    [{ type: "button", text: "x" }, /כתובת/],
    [{ type: "heading", text: "x", onclick: "alert(1)" }, /onclick/],
    [{ type: "heading", text: "x", css: "color:red" }, /css/],
    [{ type: "image", mediaId: "https://evil.example/a.png" }, /mediaId/],
    [
      { type: "image", mediaId: 42, url: "https://x.example", onload: "x()" },
      /onload/,
    ],
    [
      { type: "video", mediaId: 43, url: "https://youtube.com/watch?v=1" },
      /url/,
    ],
    [{ type: "heading", text: "x", color: "red" }, /#hex/],
    [{ type: "heading", text: "x", color: "url(javascript:x)" }, /#hex/],
    [{ type: "heading", text: "x", font: "Arial" }, /global/],
    [
      { type: "icon-list", items: [{ text: "x", url: "javascript:1" }] },
      /javascript/,
    ],
    [{ type: "spacer" }, /height/],
    [{ type: "unknown-widget" }, /לא מוכר/],
  ];
  for (const [child, pattern] of bad) {
    const result = await tool(
      f.agent,
      "wp_prepare_elementor_page",
      page(child),
    );
    assert.ok(
      result?.error || /נדחה|לא תקין|אסור/.test(JSON.stringify(result)),
      JSON.stringify(child),
    );
    const message = result.error ?? JSON.stringify(result);
    assert.match(message, pattern, JSON.stringify(child));
  }
  assert.equal(writes(f).length, 0);
  // Structure limits: nesting, element count, size.
  assert.throws(
    () =>
      validateElementor("wp_prepare_elementor_page", {
        title: "x",
        containers: [
          {
            children: [
              {
                type: "container",
                children: [
                  {
                    type: "container",
                    children: [{ type: "spacer", height: 1 }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    /רמה אחת/,
  );
  assert.throws(
    () =>
      validateElementor("wp_prepare_elementor_page", {
        title: "x",
        containers: Array.from({ length: 20 }, () => ({
          children: Array.from({ length: 8 }, () => ({
            type: "spacer",
            height: 1,
          })),
        })),
      }),
    /יותר מדי אלמנטים/,
  );
  assert.throws(
    () =>
      validateElementor("wp_prepare_elementor_page", {
        title: "x",
        containers: [
          {
            children: [
              { type: "text-editor", html: "<p>" + "א".repeat(20001) + "</p>" },
            ],
          },
        ],
      }),
    /20,000/,
  );
});

test("the built JSON is size-capped", async (t) => {
  const f = await fixture(t);
  const big = {
    title: "גדול",
    containers: Array.from({ length: 6 }, () => ({
      children: Array.from({ length: 2 }, () => ({
        type: "text-editor",
        html: "<p>" + "א".repeat(19000) + "</p>",
      })),
    })),
  };
  const result = await tool(f.agent, "wp_prepare_elementor_page", big);
  assert.match(result.error, /גדולים מדי/);
  assert.equal(writes(f).length, 0);
});

test("images and videos only from this site's media library", async (t) => {
  const f = await fixture(t);
  const page = (child) => ({ title: "x", containers: [{ children: [child] }] });
  assert.match(
    (
      await tool(
        f.agent,
        "wp_prepare_elementor_page",
        page({ type: "image", mediaId: 999 }),
      )
    ).error,
    /לא נמצאה בספריית המדיה/,
  );
  assert.match(
    (
      await tool(
        f.agent,
        "wp_prepare_elementor_page",
        page({ type: "image", mediaId: 44 }),
      )
    ).error,
    /אינה על האתר המחובר/,
  );
  assert.match(
    (
      await tool(
        f.agent,
        "wp_prepare_elementor_page",
        page({ type: "video", mediaId: 42 }),
      )
    ).error,
    /וידאו/,
  );
  assert.match(
    (
      await tool(
        f.agent,
        "wp_prepare_elementor_page",
        page({ type: "image", mediaId: 43 }),
      )
    ).error,
    /תמונה/,
  );
  const ok = await prepare(
    f.agent,
    "wp_prepare_elementor_page",
    page({ type: "video", mediaId: 43, controls: true }),
  );
  assert.ok(ok.review);
  assert.equal(writes(f).length, 0);
});

test("global colors and fonts must exist on the site; #hex works without the globals route", async (t) => {
  const f = await fixture(t);
  const page = (child) => ({ title: "x", containers: [{ children: [child] }] });
  const missing = await tool(
    f.agent,
    "wp_prepare_elementor_page",
    page({ type: "heading", text: "x", color: "global:nope" }),
  );
  assert.match(missing.error, /אינו קיים באתר/);
  f.state.globalsMissing = true;
  const none = await tool(
    f.agent,
    "wp_prepare_elementor_page",
    page({ type: "heading", text: "x", color: "global:primary" }),
  );
  assert.match(none.error, /#hex/);
  const hex = await prepare(
    f.agent,
    "wp_prepare_elementor_page",
    page({ type: "heading", text: "x", color: "#112233" }),
  );
  assert.ok(hex.review);
});

test("site gates: Elementor inactive, too old, not exposed over REST, wrong page kinds", async (t) => {
  const args = {
    title: "x",
    containers: [{ children: [{ type: "spacer", height: 10 }] }],
  };
  let f = await fixture(t, {
    plugins: [
      { plugin: "elementor/elementor", status: "inactive", version: "4.3.6" },
    ],
  });
  assert.match(
    (await tool(f.agent, "wp_prepare_elementor_page", args)).error,
    /Elementor אינו פעיל/,
  );
  f = await fixture(t, { plugins: [] });
  assert.match(
    (await tool(f.agent, "wp_prepare_elementor_page", args)).error,
    /אינו פעיל/,
  );
  f = await fixture(t, {
    plugins: [
      { plugin: "elementor/elementor", status: "active", version: "3.5.1" },
    ],
  });
  assert.match(
    (await tool(f.agent, "wp_prepare_elementor_page", args)).error,
    /ישנה מדי/,
  );
  f = await fixture(t, { exposeMeta: false });
  assert.match(
    (await tool(f.agent, "wp_prepare_elementor_page", args)).error,
    /REST/,
  );
  // Plugin list not readable: the public REST index still shows Elementor, so building proceeds.
  f = await fixture(t, { pluginsForbidden: true });
  const info = await f.agent.elementor.detect("p");
  assert.equal(info.active, true);
  assert.equal(info.version, null);
  assert.ok((await prepare(f.agent, "wp_prepare_elementor_page", args)).review);
  // Not an Elementor page / unsupported existing elements / missing page.
  f = await fixture(t);
  f.state.pages.set(7, {
    id: 7,
    title: "רגיל",
    status: "draft",
    meta: {
      _elementor_data: "",
      _elementor_edit_mode: "",
      _elementor_template_type: "",
    },
  });
  assert.match(
    (await tool(f.agent, "wp_prepare_elementor_page", { ...args, id: 7 }))
      .error,
    /אינו עמוד Elementor/,
  );
  f.state.pages.set(8, {
    id: 8,
    title: "ישן",
    status: "draft",
    meta: {
      _elementor_edit_mode: "builder",
      _elementor_template_type: "wp-page",
      _elementor_data: JSON.stringify([
        {
          id: "11111111",
          elType: "section",
          settings: [],
          elements: [
            {
              id: "22222222",
              elType: "column",
              settings: [],
              elements: [
                {
                  id: "33333333",
                  elType: "widget",
                  widgetType: "html",
                  settings: { html: "<b>x</b>" },
                  elements: [],
                },
              ],
            },
          ],
        },
      ]),
    },
  });
  const legacy = await tool(f.agent, "wp_prepare_elementor_page", {
    ...args,
    id: 8,
  });
  assert.match(legacy.error, /אינה יכולה לשמר/);
  assert.match(legacy.error, /section/);
  assert.match(
    (await tool(f.agent, "wp_prepare_elementor_page", { ...args, id: 999 }))
      .error,
    /לא נמצא/,
  );
  assert.equal(writes(f).length, 0);
});

test("a server that silently drops the Elementor meta is caught by the read-back and blocks the project", async (t) => {
  const f = await fixture(t, { dropMeta: true });
  const r = await prepare(f.agent, "wp_prepare_elementor_page", clone(PAGE));
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "unknown");
  assert.equal(f.agent.isBlocked("p"), true);
  assert.equal(writes(f).length, 1, "no retry");
});

test("ambiguous update write: ONE read-back decides (applied / not applied), never a second write", async (t) => {
  const original = stored();
  const seed = (f) =>
    f.state.pages.set(5, {
      id: 5,
      title: "ישן",
      status: "draft",
      meta: {
        _elementor_data: original,
        _elementor_edit_mode: "builder",
        _elementor_template_type: "",
      },
    });
  const args = () => ({ id: 5, containers: clone(PAGE).containers });
  // Applied, but the response was lost.
  let f = await fixture(t, { failAfterApply: (_p, id) => id === 5 });
  seed(f);
  let r = await prepare(f.agent, "wp_prepare_elementor_page", args());
  let out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified");
  assert.equal(writes(f).length, 1);
  // Never reached the site: the read-back shows the old state.
  f = await fixture(t, { failBeforeApply: (_p, id) => id === 5 });
  seed(f);
  r = await prepare(f.agent, "wp_prepare_elementor_page", args());
  out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "denied");
  assert.match(out.text, /לא הוחל/);
  assert.equal(f.agent.isBlocked("p"), false);
  assert.equal(writes(f).length, 1);
  assert.equal(f.state.pages.get(5).meta._elementor_data, original);
});

test("read tool returns the simple structure, flags what cannot be updated, and treats text as untrusted", async (t) => {
  const f = await fixture(t);
  f.state.pages.set(5, {
    id: 5,
    title: "ישן",
    status: "draft",
    meta: {
      _elementor_data: stored("שלום"),
      _elementor_edit_mode: "builder",
      _elementor_template_type: "",
    },
  });
  const got = await tool(f.agent, "wp_read_elementor_page", { id: 5 });
  assert.equal(got.untrusted, true);
  assert.equal(got.data.isElementor, true);
  assert.equal(got.data.canUpdate, true);
  assert.equal(got.data.structure.containers[0].children[0].text, "שלום");
  const plain = await tool(f.agent, "wp_read_elementor_page", { id: 2 });
  assert.equal(plain.data.isElementor, false);
});

test("building and reading back the simple structure round-trips", () => {
  const args = validateElementor("wp_prepare_elementor_page", clone(PAGE));
  const media = new Map([[42, { id: 42, url: `${SITE}/a.png`, alt: "" }]]);
  const a = buildElementorData(args, { rtl: true, media });
  const b = buildElementorData(args, { rtl: true, media });
  assert.equal(JSON.stringify(a), JSON.stringify(b), "deterministic ids");
  const back = toStructure(a, true);
  const again = buildElementorData(
    validateElementor("wp_prepare_elementor_page", {
      title: "x",
      containers: back,
    }),
    { rtl: true, media },
  );
  assert.equal(canonText(again), canonText(a));
  const ltr = buildElementorData(args, { rtl: false, media });
  const heading = ltr[0].elements[0];
  assert.equal(
    heading.settings.align,
    undefined,
    "no forced alignment on LTR sites",
  );
});

test("agent context shows Elementor and says to build with it by default", async (t) => {
  const f = await fixture(t);
  assert.match(f.agent.context("p"), /ELEMENTOR: not checked yet/);
  const site = f.wp.status("p").site;
  f.agent.elementorInfo.set("p", {
    site,
    info: await f.agent.elementor.detect("p"),
  });
  const text = f.agent.context("p");
  assert.match(text, /ELEMENTOR: active, version 4\.3\.6, Pro not active/);
  assert.match(text, /BUILD PAGES WITH ELEMENTOR BY DEFAULT/);
  assert.match(text, /global:primary \(Primary #6EC1E4\)/);
  assert.match(text, /wp_prepare_elementor_page/);
  f.agent.elementorInfo.set("p", { site, info: { active: false } });
  assert.match(f.agent.context("p"), /not active on this site/);
  assert.ok(tools.some((x) => x.name === "wp_prepare_elementor_page"));
  assert.ok(tools.some((x) => x.name === "wp_read_elementor_page"));
  assert.throws(
    () =>
      argumentsFor("wp_prepare_elementor_page", {
        title: "x",
        containers: [{ children: [{ type: "html" }] }],
      }),
    /אסור/,
  );
});

// ---- build plans ----------------------------------------------------------------------------------------------------------------
const heroUpload = {
  key: "hero",
  tool: "wp_prepare_upload_image",
  args: {
    url: "https://images.example/hero.png",
    fileName: "hero.png",
    alt: "נוף ירוק",
  },
};
const planPage = (over = {}) => ({
  key: "home",
  tool: "wp_prepare_elementor_page",
  args: {
    title: "בית",
    containers: [
      {
        children: [
          { type: "heading", text: "שלום", level: 1 },
          { type: "image", mediaId: "{{hero.id}}", alt: "נוף" },
        ],
      },
    ],
    ...over,
  },
});
test("build plan: an uploaded image is referenced by the Elementor step, executed in order, and the plan can be undone", async (t) => {
  const f = await fixture(t);
  f.state.media.delete(42); // exists only after the plan's upload step
  const r = await prepare(f.agent, "wp_prepare_build_plan", {
    title: "אתר Elementor",
    steps: [heroUpload, planPage()],
  });
  assert.equal(r.review.kind, "build-plan", r.text);
  assert.equal(r.review.steps.length, 2);
  assert.equal(r.review.steps[1].label, "עמוד Elementor");
  assert.equal(r.review.steps[1].before, null);
  assert.equal(
    f.calls.filter((c) => c.method !== "GET").length,
    0,
    "nothing is written while preparing",
  );
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified", out.text);
  const post = writes(f).find((c) => c.method === "POST");
  const data = JSON.parse(post.payload.meta._elementor_data);
  const image = data[0].elements[1].settings.image;
  assert.equal(
    image.id,
    42,
    "the verified id of the uploaded image replaced the reference",
  );
  assert.equal(image.url, `${SITE}/wp-content/uploads/file-42.png`);
  assert.equal(post.payload.status, "draft");
  assert.ok(out.undoPlan);
  // Undo the whole plan: the draft goes to the trash first, then the upload is deleted.
  const review = await f.agent.plans.prepareUndo("p", out.undo);
  assert.equal(review.kind, "undo-plan");
  assert.equal(review.steps.length, 2);
  const undone = await f.agent.decide("p", review.token, true);
  assert.equal(undone.outcome, "verified", undone.text);
  const page = [...f.state.pages.values()].find((p) => p.title === "בית");
  assert.equal(page.status, "trash");
  assert.equal(f.state.deletedMedia, true);
});
test("build plan validation: image references only from uploads, updates need a real page id", () => {
  const validate = (steps) => validatePlan({ title: "x", steps }, argumentsFor);
  assert.doesNotThrow(() => validate([heroUpload, planPage()]));
  assert.throws(
    () => validate([planPage()]),
    /הפניות מותרות רק ליצירה בשלב קודם|הפניה/,
  );
  assert.throws(
    () =>
      validate([
        {
          key: "a",
          tool: "wp_prepare_elementor_page",
          args: {
            title: "א",
            containers: [{ children: [{ type: "spacer", height: 5 }] }],
          },
        },
        planPage({ id: "{{a.id}}" }),
      ]),
    /מזהה מספרי של עמוד קיים/,
  );
  assert.doesNotThrow(() =>
    validate([heroUpload, planPage({ id: 5, title: undefined })]),
  );
  assert.throws(
    () =>
      validate([
        heroUpload,
        planPage({
          containers: [
            { children: [{ type: "button", text: "x", url: "{{hero.url}}" }] },
          ],
        }),
      ]),
    /הפניות מותרות/,
  );
  // Later steps may point at the Elementor page created earlier (for example the front page).
  assert.doesNotThrow(() =>
    validate([
      heroUpload,
      planPage(),
      {
        key: "front",
        tool: "wp_prepare_front_page",
        args: { pageId: "{{home.id}}" },
      },
    ]),
  );
});

test("wp_read_site_structure reports Elementor (active, version, Pro, globals) and the agent context then tells the model to use it", async (t) => {
  const f = await fixture(t, {
    plugins: [
      { plugin: "elementor/elementor", status: "active", version: "4.3.6" },
      {
        plugin: "elementor-pro/elementor-pro",
        status: "active",
        version: "4.3.1",
      },
    ],
  });
  f.agent.structure.describe = async () => ({ theme: { block: false } }); // the theme part has its own tests
  const got = await tool(f.agent, "wp_read_site_structure", {});
  assert.equal(got.untrusted, true);
  assert.equal(got.data.theme.block, false);
  assert.equal(got.data.elementor.active, true);
  assert.equal(got.data.elementor.version, "4.3.6");
  assert.deepEqual(got.data.elementor.pro, { active: true, version: "4.3.1" });
  assert.ok(got.data.elementor.globals.colors.some((c) => c.id === "primary"));
  const text = f.agent.context("p");
  assert.match(text, /ELEMENTOR: active, version 4\.3\.6, Pro active 4\.3\.1/);
  assert.match(text, /BUILD PAGES WITH ELEMENTOR BY DEFAULT/);
  // Not installed: the structure says so and the context points to blocks.
  const g = await fixture(t, { plugins: [] });
  g.agent.structure.describe = async () => ({ theme: { block: true } });
  assert.equal(
    (await tool(g.agent, "wp_read_site_structure", {})).data.elementor.active,
    false,
  );
  assert.match(g.agent.context("p"), /ELEMENTOR: not active on this site/);
});

test("kit patterns: a whole page from patterns is prepared, written and read back; sites without globals get a hex palette", async (t) => {
  const f = await fixture(t);
  const args = {
    title: "בית",
    patterns: [
      {
        pattern: "hero-image",
        data: {
          title: "ברוכים הבאים",
          buttonText: "צרו קשר",
          buttonUrl: "/contact/",
          mediaId: 42,
        },
      },
      {
        pattern: "services-cards",
        data: {
          title: "שירותים",
          items: [{ title: "א" }, { title: "ב" }, { title: "ג" }],
        },
      },
      {
        pattern: "cta-band",
        data: {
          title: "בואו נדבר",
          buttonText: "התקשרו",
          buttonUrl: "tel:+972501234567",
        },
      },
    ],
  };
  const r = await prepare(f.agent, "wp_prepare_elementor_page", args);
  assert.equal(r.review.kind, "elementor-create", r.text);
  assert.equal(
    r.review.payload.structure.containers.length,
    3,
    "the exact expanded structure is on the card",
  );
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified");
  const data = JSON.parse(writes(f)[0].payload.meta._elementor_data);
  assert.equal(data.length, 3);
  assert.ok(JSON.stringify(data).includes("globals/colors?id=primary"));
  // No global colors available: the same patterns come out with hex values.
  const g = await fixture(t, { globalsMissing: true });
  const r2 = await prepare(g.agent, "wp_prepare_elementor_page", args);
  assert.ok(r2.review, r2.text);
  await g.agent.decide("p", r2.review.token, true);
  const hex = writes(g)[0].payload.meta._elementor_data;
  assert.ok(!hex.includes("globals/colors"));
  assert.ok(hex.includes("#1F3A5F"));
});

// ---- global colors and fonts ----------------------------------------------------------------------------------------------------
const gwrites = (f) =>
  f.calls.filter(
    (c) => c.method === "POST" && c.route.startsWith("/elementor/v1/globals/"),
  );
const CHANGE = {
  globalColors: [
    { id: "primary", value: "#123456" },
    { id: "accent", value: "#ff6600" },
    { title: "Brand light", value: "#abcdef" },
  ],
  globalFonts: [
    { id: "primary", family: "Assistant", weight: "700" },
    { title: "Display", family: "Rubik", weight: "500" },
  ],
};
test("globals: read tool, review with swatches and fonts, one write per item, exact read-back, activity log", async (t) => {
  const f = await fixture(t);
  const got = await tool(f.agent, "wp_read_elementor_globals", {});
  assert.equal(got.data.available, true);
  assert.deepEqual(
    got.data.colors.map((c) => c.id),
    ["primary", "secondary", "text", "accent"],
  );
  assert.equal(got.data.colors[0].system, true);
  assert.equal(got.data.fonts[0].family, "Roboto");
  const r = await prepare(
    f.agent,
    "wp_prepare_elementor_globals",
    clone(CHANGE),
  );
  assert.equal(r.review.kind, "elementor-globals", r.text);
  assert.equal(r.review.payload.swatches.length, 3);
  assert.equal(r.review.payload.fonts.length, 2);
  assert.deepEqual(r.review.payload.swatches[0], {
    id: "primary",
    title: "Primary",
    before: "#6EC1E4",
    after: "#123456",
    isNew: false,
    system: true,
  });
  assert.ok(r.review.payload.swatches[2].isNew);
  assert.match(r.review.summary, /3 צבעים, 2 גופנים/);
  assert.match(r.review.warning, /לא מתועדים/);
  assert.match(r.review.warning, /אי אפשר|אינו מאפשר למחוק/);
  assert.equal(gwrites(f).length, 0, "nothing is written before approval");
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified", out.text);
  assert.equal(gwrites(f).length, 5);
  assert.equal(f.state.globals.colors.primary.value, "#123456");
  assert.equal(
    f.state.globals.colors.accent.title,
    "Accent",
    "system titles stay",
  );
  const font = f.state.globals.typography.primary.value;
  assert.equal(font.typography_font_family, "Assistant");
  assert.equal(font.typography_font_weight, "700");
  assert.deepEqual(
    font.typography_font_size,
    { unit: "px", size: "", sizes: [] },
    "other font settings are kept",
  );
  const customs = Object.values(f.state.globals.colors).filter(
    (c) => !["primary", "secondary", "text", "accent"].includes(c.id),
  );
  assert.equal(customs.length, 1);
  assert.equal(customs[0].title, "Brand light");
  const log = f.agent
    .getActivityLog("p")
    .find((e) => e.action === "elementor-globals");
  assert.equal(log.state, "verified");
  assert.equal(log.canUndo, true);
});
test("globals undo: previous values return, new custom globals stay (they cannot be deleted) and the review says so", async (t) => {
  const f = await fixture(t);
  await approve(f, "wp_prepare_elementor_globals", clone(CHANGE));
  const u = await undo(f, "elementor-globals");
  assert.equal(u.review.kind, "elementor-globals-revert");
  assert.match(u.review.warning, /יישארו/);
  assert.equal(u.result.outcome, "verified", u.result.text);
  assert.equal(f.state.globals.colors.primary.value, "#6EC1E4");
  assert.equal(f.state.globals.colors.accent.value, "#61CE70");
  assert.equal(
    f.state.globals.typography.primary.value.typography_font_family,
    "Roboto",
  );
  assert.equal(
    f.state.globals.typography.primary.value.typography_font_weight,
    "600",
  );
  assert.ok(
    Object.values(f.state.globals.colors).some(
      (c) => c.title === "Brand light",
    ),
    "the created custom color remains",
  );
  // Only new custom globals: nothing can be restored.
  const g = await fixture(t);
  await approve(g, "wp_prepare_elementor_globals", {
    globalColors: [{ title: "Only new", value: "#010203" }],
  });
  const entry = g.agent
    .getActivityLog("p")
    .find((e) => e.action === "elementor-globals");
  await assert.rejects(g.agent.prepareUndo("p", entry.id), /אין מה לשחזר/);
});
test("globals undo refuses when a value changed on the site since", async (t) => {
  const f = await fixture(t);
  await approve(f, "wp_prepare_elementor_globals", {
    globalColors: [{ id: "primary", value: "#123456" }],
  });
  f.state.globals.colors.primary.value = "#999999";
  const entry = f.agent
    .getActivityLog("p")
    .find((e) => e.action === "elementor-globals");
  await assert.rejects(f.agent.prepareUndo("p", entry.id), /השתנו באתר/);
});
test("globals validation: hex colors, allowed fonts only (Google or system), ids, duplicates", async (t) => {
  const f = await fixture(t);
  const err = async (args) =>
    (await tool(f.agent, "wp_prepare_elementor_globals", args)).error;
  assert.match(
    await err({ globalColors: [{ id: "primary", value: "red" }] }),
    /#RRGGBB/,
  );
  assert.match(
    await err({ globalColors: [{ id: "primary", value: "url(x)" }] }),
    /#RRGGBB/,
  );
  assert.match(await err({ globalColors: [{ value: "#112233" }] }), /title/);
  assert.match(
    await err({ globalColors: [{ id: "Bad Id!", value: "#112233" }] }),
    /id/,
  );
  assert.match(
    await err({
      globalColors: [{ id: "primary", value: "#112233", css: "x" }],
    }),
    /css/,
  );
  assert.match(
    await err({ globalFonts: [{ id: "primary", family: "Comic Sans MS" }] }),
    /אינו ברשימת הגופנים/,
  );
  assert.match(
    await err({
      globalFonts: [{ id: "primary", family: "Heebo; } body { x" }],
    }),
    /אינו ברשימת/,
  );
  assert.match(
    await err({
      globalFonts: [{ id: "primary", family: "Heebo", weight: "950" }],
    }),
    /weight|oneOf|אחד מ/,
  );
  assert.match(
    await err({
      globalColors: [
        { id: "primary", value: "#112233" },
        { id: "primary", value: "#445566" },
      ],
    }),
    /כפילות/,
  );
  assert.match(
    await err({ globalColors: [{ id: "nope123", value: "#112233" }] }),
    /אינו קיים באתר/,
  );
  assert.match(await err({}), /לא התבקש שינוי/);
  assert.match(
    await err({ globalColors: [{ id: "primary", value: "#6ec1e4" }] }),
    /אין שינוי/,
  );
  assert.equal(gwrites(f).length, 0);
  // System fonts and Hebrew Google fonts are accepted (case-insensitive names are normalized).
  const ok = await prepare(f.agent, "wp_prepare_elementor_globals", {
    globalFonts: [
      { id: "text", family: "arial" },
      { id: "secondary", family: "heebo" },
    ],
  });
  assert.equal(ok.review.payload.fonts[0].family, "Arial");
  assert.equal(ok.review.payload.fonts[1].family, "Heebo");
});
test("globals: unavailable routes give a clear Hebrew message and never break page building", async (t) => {
  const f = await fixture(t, { globalsRoutesMissing: true });
  const e = await tool(f.agent, "wp_prepare_elementor_globals", {
    globalColors: [{ id: "primary", value: "#123456" }],
  });
  assert.match(e.error, /לא ניתן לקרוא או לשנות צבעים וגופנים גלובליים/);
  assert.match(e.error, /ידנית/);
  const read = await tool(f.agent, "wp_read_elementor_globals", {});
  assert.equal(read.data.available, false);
  const page = await prepare(f.agent, "wp_prepare_elementor_page", {
    title: "x",
    containers: [{ children: [{ type: "spacer", height: 5 }] }],
  });
  assert.ok(page.review, "pages still work");
  const old = await fixture(t, {
    plugins: [
      { plugin: "elementor/elementor", status: "active", version: "3.5.0" },
    ],
  });
  assert.match(
    (
      await tool(old.agent, "wp_prepare_elementor_globals", {
        globalColors: [{ id: "primary", value: "#123456" }],
      })
    ).error,
    /ישנה מדי/,
  );
  assert.equal(gwrites(f).length, 0);
});
test("globals: no permission is not applied and does not block; a silently ignored write is caught by the read-back", async (t) => {
  const f = await fixture(t, { globalsForbidden: true });
  const r = await prepare(f.agent, "wp_prepare_elementor_globals", {
    globalColors: [{ id: "primary", value: "#123456" }],
  });
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "denied");
  assert.match(out.text, /הרשאה/);
  assert.equal(f.agent.isBlocked("p"), false);
  const g = await fixture(t, { globalsDrop: true });
  const r2 = await prepare(g.agent, "wp_prepare_elementor_globals", {
    globalColors: [{ id: "primary", value: "#123456" }],
  });
  const out2 = await g.agent.decide("p", r2.review.token, true);
  assert.equal(out2.outcome, "unknown");
  assert.equal(g.agent.isBlocked("p"), true);
});
test("globals changed on the site after the review are not overwritten", async (t) => {
  const f = await fixture(t);
  const r = await prepare(f.agent, "wp_prepare_elementor_globals", {
    globalColors: [{ id: "primary", value: "#123456" }],
  });
  f.state.globals.colors.primary.value = "#000000";
  await assert.rejects(
    f.agent.decide("p", r.review.token, true),
    /השתנו מאז הבדיקה/,
  );
  assert.equal(gwrites(f).length, 0);
});
test("build plan: globals first, then a page that uses them; the whole plan undoes", async (t) => {
  const f = await fixture(t);
  const steps = [
    {
      key: "design",
      tool: "wp_prepare_elementor_globals",
      args: {
        globalColors: [{ id: "primary", value: "#123456" }],
        globalFonts: [{ id: "primary", family: "Assistant", weight: "700" }],
      },
    },
    {
      key: "home",
      tool: "wp_prepare_elementor_page",
      args: {
        title: "בית",
        patterns: [
          {
            pattern: "cta-band",
            data: {
              title: "בואו נדבר",
              buttonText: "צרו קשר",
              buttonUrl: "/contact/",
            },
          },
        ],
      },
    },
  ];
  const r = await prepare(f.agent, "wp_prepare_build_plan", {
    title: "אתר",
    steps,
  });
  assert.equal(r.review.kind, "build-plan", r.text);
  assert.equal(r.review.steps[0].label, "צבעים וגופנים גלובליים (Elementor)");
  assert.equal(gwrites(f).length, 0);
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified", out.text);
  assert.equal(f.state.globals.colors.primary.value, "#123456");
  const review = await f.agent.plans.prepareUndo("p", out.undo);
  assert.equal(review.steps.length, 2);
  const undone = await f.agent.decide("p", review.token, true);
  assert.equal(undone.outcome, "verified", undone.text);
  assert.equal(f.state.globals.colors.primary.value, "#6EC1E4");
  assert.throws(
    () =>
      validatePlan(
        { title: "x", steps: [steps[0], { ...steps[0], key: "again" }] },
        argumentsFor,
      ),
    /פעם אחת/,
  );
  assert.throws(
    () =>
      validatePlan(
        {
          title: "x",
          steps: [
            {
              ...steps[0],
              args: { globalColors: [{ id: "primary", value: "{{a.id}}" }] },
            },
          ],
        },
        argumentsFor,
      ),
    /הפניות מותרות/,
  );
});
test("a plan whose only globals step created new custom colors still undoes (that step is reported as not undoable)", async (t) => {
  const f = await fixture(t);
  const steps = [
    {
      key: "design",
      tool: "wp_prepare_elementor_globals",
      args: { globalColors: [{ title: "Only new", value: "#010203" }] },
    },
    {
      key: "home",
      tool: "wp_prepare_elementor_page",
      args: {
        title: "בית",
        containers: [{ children: [{ type: "spacer", height: 5 }] }],
      },
    },
  ];
  const r = await prepare(f.agent, "wp_prepare_build_plan", {
    title: "אתר",
    steps,
  });
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified", out.text);
  const review = await f.agent.plans.prepareUndo("p", out.undo);
  assert.equal(review.steps.length, 1, "only the page step can be undone");
  assert.match(review.warning, /לא ניתן לבטל מרחוק/);
});

// ---- a whole site from a spec: globals, images, Elementor pages from the kit, category, post, placeholders, undo -------------------
const specSteps = () => [
  {
    key: "design",
    tool: "wp_prepare_elementor_globals",
    args: {
      globalColors: [{ id: "primary", value: "#1F4E79" }],
      globalFonts: [{ id: "primary", family: "Heebo", weight: "700" }],
    },
  },
  heroUpload,
  {
    key: "home",
    tool: "wp_prepare_elementor_page",
    args: {
      title: "בית",
      patterns: [
        {
          pattern: "hero-image",
          data: {
            title: "ברוכים הבאים לסטודיו",
            buttonText: "צרו קשר",
            buttonUrl: "/contact/",
            mediaId: "{{hero.id}}",
          },
        },
        {
          pattern: "contact-details",
          data: {
            title: "צרו קשר",
            contacts: [
              { type: "phone", label: "טלפון", value: "(להשלים: מספר טלפון)" },
              { type: "email", value: "info@example.com" },
            ],
          },
        },
      ],
    },
  },
  {
    key: "about",
    tool: "wp_prepare_elementor_page",
    args: {
      title: "אודות",
      patterns: [
        {
          pattern: "hero-simple",
          data: { title: "מי אנחנו", subtitle: "(להשלים: תיאור הצוות)" },
        },
      ],
    },
  },
  {
    key: "news",
    tool: "wp_prepare_term_create",
    args: { taxonomy: "category", name: "חדשות" },
  },
  {
    key: "post1",
    tool: "wp_prepare_create_post",
    args: {
      title: "פוסט ראשון",
      content: "<!-- wp:paragraph --><p>שלום עולם</p><!-- /wp:paragraph -->",
    },
  },
  {
    key: "menu",
    tool: "wp_prepare_menu",
    args: {
      title: "ראשי",
      links: [
        { pageId: "{{home.id}}", label: "בית" },
        { pageId: "{{about.id}}", label: "אודות" },
      ],
    },
  },
  {
    key: "front",
    tool: "wp_prepare_front_page",
    args: { pageId: "{{home.id}}" },
  },
  {
    key: "ident",
    tool: "wp_prepare_site_identity",
    args: { blogname: "הסטודיו", blogdescription: "עיצוב ובנייה" },
  },
];
test("spec plan: every step type of the flow is accepted in order, with references to earlier steps", () => {
  assert.doesNotThrow(() =>
    validatePlan({ title: "אתר מאפיון", steps: specSteps() }, argumentsFor),
  );
  const bad = specSteps();
  bad[2].args.patterns[0].data.mediaId = "{{later.id}}";
  assert.throws(
    () => validatePlan({ title: "x", steps: bad }, argumentsFor),
    /הפניות מותרות/,
  );
});
test("spec plan: globals, image, Elementor pages from the kit, a category and a post run in one plan; placeholders are listed; the plan undoes", async (t) => {
  const f = await fixture(t);
  f.state.media.delete(42);
  const steps = specSteps().filter(
    (s) => !["menu", "front", "ident"].includes(s.key),
  );
  const r = await prepare(f.agent, "wp_prepare_build_plan", {
    title: "אתר מאפיון",
    steps,
  });
  assert.equal(r.review.kind, "build-plan", r.text);
  assert.equal(r.review.steps.length, 6);
  assert.equal(
    r.review.steps.map((s) => s.label).join("|"),
    "צבעים וגופנים גלובליים (Elementor)|העלאת תמונה|עמוד Elementor|עמוד Elementor|יצירת קטגוריה/תגית|יצירת טיוטת פוסט",
  );
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified", out.text);
  assert.match(out.text, /מקומות להשלמה ידנית \(2\)/);
  assert.match(out.text, /\(להשלים: מספר טלפון\)/);
  assert.match(out.text, /\(להשלים: תיאור הצוות\)/);
  const home = [...f.state.pages.values()].find((p) => p.title === "בית");
  const data = JSON.parse(home.meta._elementor_data);
  assert.equal(
    data[0].settings.background_image.id,
    42,
    "the uploaded hero image became the background",
  );
  assert.ok(JSON.stringify(data).includes("(להשלים: מספר טלפון)"));
  assert.equal(f.state.globals.colors.primary.value, "#1F4E79");
  assert.ok([...f.state.categories.values()].some((c) => c.name === "חדשות"));
  assert.equal([...f.state.posts.values()][0].status, "draft");
  const review = await f.agent.plans.prepareUndo("p", out.undo);
  assert.equal(review.steps.length, 6);
  const undone = await f.agent.decide("p", review.token, true);
  assert.equal(undone.outcome, "verified", undone.text);
  assert.equal(home.status, "trash");
  assert.equal(
    [...f.state.categories.values()].some((c) => c.name === "חדשות"),
    false,
  );
  assert.equal([...f.state.posts.values()][0].status, "trash");
  assert.equal(f.state.globals.colors.primary.value, "#6EC1E4");
  assert.equal(f.state.deletedMedia, true);
});
test("a single page review lists its placeholders", async (t) => {
  const f = await fixture(t);
  const r = await prepare(f.agent, "wp_prepare_elementor_page", {
    title: "קשר",
    patterns: [
      {
        pattern: "contact-details",
        data: {
          title: "צרו קשר",
          contacts: [{ type: "address", value: "(להשלים: כתובת)" }],
        },
      },
    ],
  });
  assert.match(
    r.review.summary,
    /מקומות להשלמה ידנית \(1\): \(להשלים: כתובת\)/,
  );
  const out = await f.agent.decide("p", r.review.token, true);
  assert.match(out.text, /\(להשלים: כתובת\)/);
});

// ---- header and footer (Theme Builder) ------------------------------------------------------------------------------------------
test("header/footer: Pro is detected, Theme Builder is never written, and the agent is told to explain and fall back", async (t) => {
  const withPro = await fixture(t, {
    plugins: [
      { plugin: "elementor/elementor", status: "active", version: "4.3.6" },
      {
        plugin: "elementor-pro/elementor-pro",
        status: "active",
        version: "4.3.1",
      },
    ],
  });
  const info = await withPro.agent.elementor.detect("p");
  assert.deepEqual(info.pro, { active: true, version: "4.3.1" });
  assert.equal(info.themeBuilder.proActive, true);
  assert.equal(info.themeBuilder.writable, false);
  assert.match(info.themeBuilder.note, /Theme Builder/);
  assert.match(info.themeBuilder.note, /אי אפשר לכתוב בבטחה מרחוק/);
  withPro.agent.elementorInfo.set("p", {
    site: withPro.wp.status("p").site,
    info,
  });
  assert.match(
    withPro.agent.context("p"),
    /HEADER\/FOOTER: Elementor Pro פעיל/,
  );
  assert.match(withPro.agent.context("p"), /wp_prepare_header/);
  const free = await fixture(t);
  const freeInfo = await free.agent.elementor.detect("p");
  assert.equal(freeInfo.themeBuilder.proActive, false);
  assert.match(freeInfo.themeBuilder.note, /Elementor Pro אינו פעיל/);
  // There is no tool that writes templates, and the page tool refuses template-like input.
  assert.ok(!tools.some((x) => /theme_builder|template/i.test(x.name)));
  for (const type of ["header", "footer"])
    assert.throws(
      () =>
        validateElementor("wp_prepare_elementor_page", {
          title: "x",
          templateType: type,
          containers: [{ children: [{ type: "spacer", height: 1 }] }],
        }),
      /templateType/,
    );
  assert.equal(writes(free).length, 0);
});

// ---- site import with Elementor ---------------------------------------------------------------------------------------------------
test("import with Elementor: source sections map to kit patterns (Elementor page steps) under the same import rules", async (t) => {
  const f = await fixture(t);
  const source = (url) => ({
    url,
    title: "Source",
    sections: [{ tag: "h1", text: "Original heading" }],
    images: [{ url: "https://cdn.example/hero.png", alt: "Hero" }],
    links: [],
    truncated: false,
  });
  const agent = new Agent(f.wp, f.dir, {
    importReader: async (url) => source(url),
  });
  agent.structure.menuSnapshot = async () => ({ theme: { block: false } });
  const signal = () => new AbortController().signal;
  const read = await agent.importer.read(
    "p",
    { url: "https://source.example/home" },
    signal(),
  );
  const steps = [
    {
      key: "hero",
      tool: "wp_prepare_upload_image",
      args: {
        url: "https://cdn.example/hero.png",
        fileName: "hero.png",
        alt: "Hero",
      },
    },
    {
      key: "home",
      tool: "wp_prepare_elementor_page",
      args: {
        title: "Imported home",
        patterns: [
          {
            pattern: "hero-image",
            data: { title: "Original heading", mediaId: "{{hero.id}}" },
          },
          {
            pattern: "cta-band",
            data: {
              title: "Original call",
              buttonText: "Contact",
              buttonUrl: "/contact/",
            },
          },
        ],
      },
    },
    {
      key: "menu",
      tool: "wp_prepare_menu",
      args: {
        title: "Imported",
        links: [{ pageId: "{{home.id}}", label: "Home" }],
      },
    },
  ];
  const base = { sourceToken: read.sourceToken, title: "Imported site", steps };
  assert.doesNotThrow(() => argumentsFor("wp_prepare_site_import", base));
  const prepared = await agent.importer.prepare("p", base, signal());
  assert.equal(prepared.review.kind, "build-plan", prepared.text);
  assert.deepEqual(
    prepared.review.steps.map((x) => x.label),
    ["העלאת תמונה", "עמוד Elementor", "הגדרת התפריט הראשי"],
  );
  assert.match(prepared.review.steps[0].warning, /./);
  assert.equal(
    f.calls.filter((c) => c.method !== "GET").length,
    0,
    "nothing is written before approval",
  );
  // Same rules as before: new draft pages only, order (pages before the menu), at least one page step, menu links every page.
  const page = steps[1];
  assert.throws(
    () =>
      argumentsFor("wp_prepare_site_import", {
        ...base,
        steps: [steps[0], { ...page, args: { ...page.args, id: 5 } }, steps[2]],
      }),
    /אין לעדכן/,
  );
  assert.throws(
    () =>
      argumentsFor("wp_prepare_site_import", {
        ...base,
        steps: [steps[0], steps[2], page],
      }),
    /סדר|הפניות/,
  );
  assert.throws(
    () =>
      argumentsFor("wp_prepare_site_import", {
        ...base,
        steps: [steps[0], steps[2]],
      }),
    /טיוטה|עמודי|ייבוא/,
  );
  await assert.rejects(
    agent.importer.prepare(
      "p",
      {
        ...base,
        steps: [
          steps[0],
          page,
          {
            ...steps[2],
            args: { title: "x", links: [{ pageId: 5, label: "other" }] },
          },
        ],
      },
      signal(),
    ),
    /תפריט/,
  );
  // Exact source text goes into the kit data and the review shows the structure; images only discovered ones.
  assert.ok(
    JSON.stringify(prepared.review.steps[1].payload).includes(
      "Original heading",
    ),
  );
  await assert.rejects(
    agent.importer.prepare(
      "p",
      {
        ...base,
        steps: [
          {
            ...steps[0],
            args: { ...steps[0].args, url: "https://other.example/x.png" },
          },
          page,
          steps[2],
        ],
      },
      signal(),
    ),
  );
});

// ---- Elementor CSS cache after a verified write --------------------------------------------------------------------------------------
const seedPage = (f) =>
  f.state.pages.set(5, {
    id: 5,
    title: "ישן",
    status: "draft",
    meta: {
      _elementor_data: stored(),
      _elementor_edit_mode: "builder",
      _elementor_template_type: "",
    },
  });
const spacerPage = (extra = {}) => ({
  title: "x",
  containers: [{ children: [{ type: "spacer", height: 5 }] }],
  ...extra,
});
test("css cache: after a VERIFIED update (and restore) the app asks Elementor to clear it; creating a draft needs none", async (t) => {
  const f = await fixture(t);
  const created = await approve(f, "wp_prepare_elementor_page", spacerPage());
  assert.equal(f.state.cacheCalls.length, 0, "a new draft has no stale CSS");
  assert.doesNotMatch(created.result.text, /CSS/);
  seedPage(f);
  const r = await prepare(f.agent, "wp_prepare_elementor_page", {
    id: 5,
    ...spacerPage({ title: undefined }),
  });
  assert.match(r.review.warning, /ינסה|תנסה לנקות את מטמון ה־CSS/);
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified");
  assert.equal(f.state.cacheCalls.length, 1);
  assert.equal(f.state.cacheCalls[0].method, "DELETE");
  const postIndex = f.calls.findIndex(
    (c) => c.method === "POST" && c.route === "/wp/v2/pages/5",
  );
  assert.ok(f.state.cacheCalls[0].order > postIndex, "only after the write");
  assert.match(out.text, /נשלחה ל־Elementor בקשה לנקות את מטמון ה־CSS/);
  assert.match(
    out.text,
    /Regenerate CSS/,
    "still points to the manual step in case the page looks stale",
  );
  const u = await undo(f, "elementor-update");
  assert.equal(u.result.outcome, "verified");
  assert.equal(f.state.cacheCalls.length, 2, "a restore clears it too");
});
test("css cache: a refused or missing route never fails the write; the manual note stays", async (t) => {
  for (const mode of ["forbidden", "missing", "empty"]) {
    const f = await fixture(t, { cacheMode: mode });
    seedPage(f);
    const r = await prepare(f.agent, "wp_prepare_elementor_page", {
      id: 5,
      ...spacerPage({ title: undefined }),
    });
    const out = await f.agent.decide("p", r.review.token, true);
    assert.equal(out.outcome, "verified", mode);
    assert.equal(f.agent.isBlocked("p"), false, mode);
    if (mode === "empty")
      assert.match(
        out.text,
        /נשלחה ל־Elementor בקשה/,
        "204 counts as accepted",
      );
    else assert.match(out.text, /לא הצליחה לנקות/, mode);
    assert.match(out.text, /Regenerate CSS/);
  }
});
test("css cache: nothing is cleared when verification fails; globals changes clear it after the read-back", async (t) => {
  const bad = await fixture(t, { dropMeta: true });
  seedPage(bad);
  const r = await prepare(bad.agent, "wp_prepare_elementor_page", {
    id: 5,
    ...spacerPage({ title: undefined }),
  });
  const out = await bad.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "unknown");
  assert.equal(bad.state.cacheCalls.length, 0);
  const f = await fixture(t);
  await approve(f, "wp_prepare_elementor_globals", {
    globalColors: [{ id: "primary", value: "#123456" }],
  });
  assert.equal(f.state.cacheCalls.length, 1);
});
test("css cache: the app can only DELETE that one route; every other method or target is refused", async (t) => {
  const f = await fixture(t);
  const el = f.agent.elementor;
  await assert.rejects(
    el.request("p", { route: "pages", method: "DELETE" }),
    /אינה מורשית/,
  );
  await assert.rejects(
    el.request("p", { route: "cache", method: "GET" }),
    /אינה מורשית/,
  );
  await assert.rejects(
    el.request("p", { route: "cache", method: "POST", payload: { x: 1 } }),
    /אינה מורשית/,
  );
  await assert.rejects(
    el.request("p", { route: "cache", method: "DELETE", target: 5 }),
    /אינה מורשית/,
  );
  await assert.rejects(
    el.request("p", { route: "cache", method: "DELETE", payload: {} }),
    /אינה מורשית/,
  );
  assert.equal(f.state.cacheCalls.length, 0);
  assert.equal(await el.clearCss("p"), true);
});

// ---- video widget: YouTube / Vimeo links ----------------------------------------------------------------------------------------------
const videoPage = (child) => ({
  title: "x",
  containers: [{ children: [child] }],
});
test("video: YouTube and Vimeo links are accepted in canonical form and built as Elementor video widgets", () => {
  const cases = [
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "youtube",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    [
      "https://youtube.com/watch?v=dQw4w9WgXcQ",
      "youtube",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    [
      "https://youtu.be/dQw4w9WgXcQ",
      "youtube",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    ["https://vimeo.com/123456789", "vimeo", "https://vimeo.com/123456789"],
    ["https://www.vimeo.com/123456789", "vimeo", "https://vimeo.com/123456789"],
  ];
  for (const [url, provider, canonical] of cases) {
    const args = validateElementor(
      "wp_prepare_elementor_page",
      videoPage({ type: "video", url }),
    );
    const [c] = buildElementorData(args, { rtl: true, media: new Map() });
    const w = c.elements[0];
    assert.equal(w.settings.video_type, provider);
    assert.equal(w.settings[`${provider}_url`], canonical);
    assert.equal(w.settings.hosted_url, undefined);
    assert.equal(w.settings.controls, "yes");
    assert.doesNotThrow(() =>
      checkBuilt([c], { rtl: true }, "https://public.example"),
    );
    assert.equal(toStructure([c], true)[0].children[0].url, canonical);
  }
  const hosted = validateElementor(
    "wp_prepare_elementor_page",
    videoPage({ type: "video", mediaId: 43 }),
  );
  assert.equal(
    buildElementorData(hosted, {
      rtl: true,
      media: new Map([
        [43, { id: 43, url: "https://public.example/a.mp4", alt: "" }],
      ]),
    })[0].elements[0].settings.video_type,
    "hosted",
  );
});
test("video: anything else is refused (other hosts, http, extra parameters, bad ids, credentials, both sources)", async (t) => {
  const bad = [
    ["https://www.dailymotion.com/video/x7tgad0", /רק קישורי YouTube/],
    ["https://evil.example/watch?v=dQw4w9WgXcQ", /רק קישורי YouTube/],
    [
      "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      /רק קישורי YouTube/,
    ],
    ["http://www.youtube.com/watch?v=dQw4w9WgXcQ", /https/],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", /פורמט|בצורה|פרמטרים/],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1", /בצורה|פרמטרים/],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=5", /בצורה|פרמטרים/],
    ["https://www.youtube.com/watch?v=short", /בצורה/],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", /בצורה/],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ%22%3E%3Cscript%3E", /בצורה/],
    ["https://youtu.be/dQw4w9WgXcQ?t=5", /פרמטרים/],
    ["https://youtu.be/dQw4w9WgXcQ/extra", /מזהה/],
    ["https://vimeo.com/123456789?autoplay=1", /פרמטרים/],
    ["https://vimeo.com/channels/staffpicks/123456789", /מזהה/],
    ["https://vimeo.com/abc", /מזהה/],
    ["https://user:pw@vimeo.com/123456789", /פרטי גישה/],
    ["https://vimeo.com:8443/123456789", /פורט|פרטי גישה/],
    ["javascript:alert(1)", /כתובת וידאו/],
    ["data:text/html,<iframe src=x>", /כתובת וידאו/],
    ["not a url", /כתובת וידאו/],
  ];
  for (const [url, re] of bad)
    assert.throws(
      () =>
        validateElementor(
          "wp_prepare_elementor_page",
          videoPage({ type: "video", url }),
        ),
      re,
      url,
    );
  assert.throws(
    () =>
      validateElementor(
        "wp_prepare_elementor_page",
        videoPage({
          type: "video",
          mediaId: 43,
          url: "https://vimeo.com/123456789",
        }),
      ),
    /בדיוק אחד/,
  );
  assert.throws(
    () =>
      validateElementor(
        "wp_prepare_elementor_page",
        videoPage({ type: "video" }),
      ),
    /בדיוק אחד/,
  );
  // Still no HTML / embed widgets, even with a video link.
  for (const type of ["html", "embed", "iframe", "shortcode"])
    assert.throws(
      () =>
        validateElementor(
          "wp_prepare_elementor_page",
          videoPage({ type, url: "https://vimeo.com/123456789" }),
        ),
      /אסור/,
    );
  // The built JSON is checked again: a tampered embed link cannot be written.
  const args = validateElementor(
    "wp_prepare_elementor_page",
    videoPage({ type: "video", url: "https://vimeo.com/123456789" }),
  );
  const [c] = buildElementorData(args, { rtl: false, media: new Map() });
  c.elements[0].settings.vimeo_url = "https://vimeo.com/123456789?autoplay=1";
  assert.throws(() => checkBuilt([c], {}, "https://public.example"), /פרמטרים/);
  c.elements[0].settings.vimeo_url = "https://vimeo.com/123456789";
  c.elements[0].settings.video_type = "dailymotion";
  assert.throws(
    () => checkBuilt([c], {}, "https://public.example"),
    /סוג וידאו/,
  );
  // End to end: the review shows the link, the write goes through.
  const f = await fixture(t);
  const out = await approve(
    f,
    "wp_prepare_elementor_page",
    videoPage({
      type: "video",
      url: "https://youtu.be/dQw4w9WgXcQ",
      loop: true,
    }),
  );
  assert.equal(out.result.outcome, "verified");
  assert.match(
    out.review.summary,
    /וידאו \(https:\/\/youtu\.be\/dQw4w9WgXcQ\)/,
  );
  const data = JSON.parse(writes(f)[0].payload.meta._elementor_data);
  assert.equal(
    data[0].elements[0].settings.youtube_url,
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
});

// ---- a blocked project after an unverified write: ONE card, reads still allowed, short pointer ----------------------------------------
test("blocked project: one info object for the card, short pointer instead of the long message, reads still work, release reopens writes", async (t) => {
  const { BLOCKED_SHORT } = require("../src/wp-agent.cjs");
  const f = await fixture(t, { dropMeta: true });
  const r = await prepare(f.agent, "wp_prepare_elementor_page", clone(PAGE));
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "unknown");
  const info = f.agent.blockedInfo("p");
  assert.equal(info.kind, "elementor-create");
  assert.equal(info.what, "יצירת עמוד Elementor");
  assert.equal(info.title, "עמוד בית");
  assert.match(info.reason, /נתוני Elementor שנשמרו שונים/);
  assert.ok(info.operation);
  assert.ok(BLOCKED_SHORT.length < 150, "the pointer is short");
  // A write attempt returns the short pointer as a tool result: the run continues, nothing is repeated at length.
  const attempt = await tool(
    f.agent,
    "wp_prepare_elementor_page",
    spacerPage(),
  );
  assert.equal(attempt.error, BLOCKED_SHORT);
  assert.match(attempt.instruction, /do not repeat the long explanation/i);
  // Reads and questions still work.
  const read = await tool(f.agent, "wp_read_elementor_page", { id: 2 });
  assert.equal(read.data.isElementor, false);
  const globalsRead = await tool(f.agent, "wp_read_elementor_globals", {});
  assert.equal(globalsRead.data.available, true);
  // The other write entry points use the same short pointer.
  await assert.rejects(
    f.agent.prepareUndo("p", f.agent.getActivityLog("p")[0].id),
    (e) => e.message === BLOCKED_SHORT,
  );
  // Releasing the block (the card's button) reopens writes and the card disappears.
  f.agent.unblock("p");
  assert.equal(f.agent.blockedInfo("p"), null);
  f.state.dropMeta = false;
  assert.ok(
    (await prepare(f.agent, "wp_prepare_elementor_page", spacerPage())).review,
  );
});
test("the blocked card and the model-key card exist in the chat window and the small bar", () => {
  const read = (f) =>
    fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8");
  for (const page of ["ui/index.html", "ui/history.html"])
    assert.match(read(page), /id="blocked-card"/, page);
  const js = read("ui/renderer.js");
  for (const text of [
    "בדקתי באתר — שחרור חסימה",
    "צפייה באתר",
    "פרטים טכניים",
    "openBlockedSite",
    "unblockWordPress",
  ])
    assert.ok(js.includes(text), text);
  assert.match(read("preload.cjs"), /openBlockedSite/);
  const main = read("main.cjs");
  assert.match(main, /handle\("openBlockedSite", \["index", "history"\]/);
  assert.match(main, /handle\("unblockWordPress", \["index", "history"\]/);
  assert.match(main, /blocked: agent\.blockedInfo/);
});
