"use strict";
// Site infrastructure writes against an in-memory fake WordPress REST API: taxonomies, custom post type items, plugins.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Agent, argumentsFor, tools } = require("../src/wp-agent.cjs");
const { WordPress } = require("../src/wordpress.cjs");
const { PLUGIN_WARNING, ZIP_REFUSED } = require("../src/wp-infra.cjs");

const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};
const esc = (s) => String(s).replace(/&/g, "&amp;");
const TYPES = {
  post: {
    slug: "post",
    name: "Posts",
    rest_base: "posts",
    rest_namespace: "wp/v2",
    hierarchical: false,
    taxonomies: ["category", "post_tag"],
  },
  page: {
    slug: "page",
    name: "Pages",
    rest_base: "pages",
    rest_namespace: "wp/v2",
    hierarchical: true,
    taxonomies: [],
  },
  attachment: {
    slug: "attachment",
    name: "Media",
    rest_base: "media",
    rest_namespace: "wp/v2",
    hierarchical: false,
    taxonomies: [],
  },
  book: {
    slug: "book",
    name: "Books",
    rest_base: "books",
    rest_namespace: "wp/v2",
    hierarchical: false,
    taxonomies: ["genre"],
  },
  jet: {
    slug: "jet",
    name: "Custom namespace",
    rest_base: "jets",
    rest_namespace: "jet/v1",
    hierarchical: false,
    taxonomies: [],
  },
};
const TAXES = {
  category: {
    slug: "category",
    name: "Categories",
    rest_base: "categories",
    rest_namespace: "wp/v2",
    hierarchical: true,
    types: ["post"],
  },
  post_tag: {
    slug: "post_tag",
    name: "Tags",
    rest_base: "tags",
    rest_namespace: "wp/v2",
    hierarchical: false,
    types: ["post"],
  },
  genre: {
    slug: "genre",
    name: "Genres",
    rest_base: "genres",
    rest_namespace: "wp/v2",
    hierarchical: true,
    types: ["book"],
  },
};
const FIELDS = { posts: ["categories", "tags"], books: ["genres"], pages: [] };
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-infra-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const state = {
    next: 100,
    terms: {
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
      tags: new Map(),
      genres: new Map(),
    },
    items: { posts: new Map(), books: new Map(), pages: new Map() },
    metaKeys: {
      books: { isbn: "", pages: 0, featured: false },
      posts: {},
      pages: {},
    },
    plugins: new Map([
      [
        "hello-dolly/hello",
        {
          plugin: "hello-dolly/hello",
          status: "inactive",
          name: "Hello Dolly",
          version: "1.7.2",
        },
      ],
    ]),
    canInstall: true,
    denyTerms: false,
    failAfterApply: null,
  };
  const termJson = (base, term) => ({
    ...term,
    name: esc(term.name),
    count: [...Object.values(state.items)]
      .flatMap((m) => [...m.values()])
      .filter((i) => (i[base] || []).includes(term.id)).length,
  });
  const itemJson = (base, item) => ({
    id: item.id,
    title: { raw: item.title, rendered: esc(item.title) },
    content: { raw: item.content ?? "", rendered: item.content ?? "" },
    status: item.status,
    slug: `item-${item.id}`,
    link: `https://public.example/?p=${item.id}`,
    ...Object.fromEntries(FIELDS[base].map((f) => [f, item[f] || []])),
    meta: { ...state.metaKeys[base], ...(item.meta || {}) },
  });
  const wp = new WordPress(dir, storage, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (url, options) => {
      const route = url.searchParams.get("rest_route") || "image";
      const parts = route.split("/");
      const resource = parts[3],
        rawId = parts.slice(4).join("/");
      const target = /^\d+$/.test(rawId) ? Number(rawId) : null;
      const method = options.method || "GET";
      const payload =
        options.body && !Buffer.isBuffer(options.body)
          ? JSON.parse(options.body)
          : undefined;
      const call = { route, resource, target, rawId, method, payload, url };
      calls.push(call);
      const reply = (data, status = 200) => ({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
      const err = (status, code) =>
        reply({ code, message: "x", data: { status } }, status);
      const result = () => {
        if (resource === "users" && rawId === "me") return reply({ id: 7 });
        if (resource === "types") return reply(TYPES);
        if (resource === "taxonomies") return reply(TAXES);
        if (state.terms[resource]) {
          const map = state.terms[resource];
          if (state.denyTerms && method !== "GET")
            return err(403, "rest_cannot_create");
          if (method === "GET" && target === null) {
            const q = url.searchParams;
            let list = [...map.values()];
            if (q.get("search"))
              list = list.filter((x) =>
                x.name.toLowerCase().includes(q.get("search").toLowerCase()),
              );
            if (q.get("slug"))
              list = list.filter((x) => x.slug === q.get("slug"));
            if (q.get("parent"))
              list = list.filter((x) => x.parent === Number(q.get("parent")));
            if (q.get("include"))
              list = list.filter((x) =>
                q.get("include").split(",").map(Number).includes(x.id),
              );
            return reply(
              list
                .slice(0, Number(q.get("per_page") || 10))
                .map((x) => termJson(resource, x)),
            );
          }
          if (method === "POST" && target === null) {
            if (
              [...map.values()].some(
                (x) =>
                  x.name.toLowerCase() === payload.name.toLowerCase() &&
                  x.parent === (payload.parent || 0),
              )
            )
              return err(400, "term_exists");
            const id = state.next++;
            const term = {
              id,
              name: payload.name,
              slug:
                payload.slug ||
                (/^[ -~]+$/.test(payload.name)
                  ? payload.name
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, "")
                  : `term-${id}`),
              description: payload.description || "",
              parent: payload.parent || 0,
            };
            map.set(id, term);
            return reply(termJson(resource, term), 201);
          }
          const term = map.get(target);
          if (!term) return err(404, "rest_term_invalid");
          if (method === "POST") {
            for (const k of ["name", "slug", "description", "parent"])
              if (payload[k] !== undefined) term[k] = payload[k];
            return reply(termJson(resource, term));
          }
          if (method === "DELETE") {
            if (url.searchParams.get("force") !== "true")
              return err(501, "rest_trash_not_supported");
            if (term.id === 1) return err(400, "rest_cannot_delete");
            map.delete(term.id);
            for (const [base, items] of Object.entries(state.items))
              for (const item of items.values())
                if ((item[resource] || []).includes(term.id)) {
                  item[resource] = item[resource].filter((n) => n !== term.id);
                  if (
                    base === "posts" &&
                    resource === "categories" &&
                    !item[resource].length
                  )
                    item[resource] = [1];
                }
            return reply({ deleted: true, previous: termJson(resource, term) });
          }
          return reply(termJson(resource, term));
        }
        if (state.items[resource]) {
          const map = state.items[resource];
          const fields = FIELDS[resource];
          if (method === "GET" && target === null) {
            let list = [...map.values()];
            for (const f of fields)
              if (url.searchParams.get(f))
                list = list.filter((i) =>
                  (i[f] || []).includes(Number(url.searchParams.get(f))),
                );
            if (url.searchParams.get("_fields")) {
              const keep = url.searchParams.get("_fields").split(",");
              return reply(
                list.map((i) =>
                  Object.fromEntries(
                    Object.entries(itemJson(resource, i)).filter(([k]) =>
                      keep.includes(k),
                    ),
                  ),
                ),
              );
            }
            return reply(list.map((i) => itemJson(resource, i)));
          }
          if (method === "POST") {
            let item =
              target === null
                ? { id: state.next++, status: "draft", title: "", content: "" }
                : map.get(target);
            if (!item) return err(404, "rest_post_invalid_id");
            for (const k of ["title", "content", "status"])
              if (payload[k] !== undefined) item[k] = payload[k];
            for (const f of fields)
              if (payload[f] !== undefined) item[f] = payload[f];
            if (payload.meta) {
              item.meta = { ...(item.meta || {}) };
              for (const [k, v] of Object.entries(payload.meta))
                if (Object.hasOwn(state.metaKeys[resource], k))
                  item.meta[k] = v;
            }
            map.set(item.id, item);
            return reply(itemJson(resource, item), target === null ? 201 : 200);
          }
          const item = map.get(target);
          return item
            ? reply(itemJson(resource, item))
            : err(404, "rest_post_invalid_id");
        }
        if (resource === "plugins") {
          if (!state.canInstall && method !== "GET")
            return err(403, "rest_cannot_install_plugin");
          if (method === "GET" && !rawId)
            return reply([...state.plugins.values()]);
          if (method === "POST" && !rawId) {
            if (payload.slug !== "classic-editor")
              return err(404, "plugins_api_failed");
            const plugin = {
              plugin: "classic-editor/classic-editor",
              status: payload.status,
              name: "Classic Editor",
              version: "1.6.7",
            };
            state.plugins.set(plugin.plugin, plugin);
            return reply(plugin, 201);
          }
          const plugin = state.plugins.get(rawId);
          if (!plugin) return err(404, "rest_plugin_not_found");
          if (method === "POST") {
            plugin.status = payload.status;
            return reply(plugin);
          }
          if (method === "DELETE") {
            if (plugin.status === "active")
              return err(400, "rest_cannot_delete_active_plugin");
            state.plugins.delete(rawId);
            return reply({ deleted: true, previous: plugin });
          }
          return reply(plugin);
        }
        throw Error(`Unexpected mock route ${route}`);
      };
      const response = result();
      if (state.failAfterApply?.(call)) throw Error("Injected network failure");
      return response;
    },
  });
  await wp.connect("p", {
    site: "https://public.example",
    username: "fixture",
    password: "PUBLIC-DUMMY",
  });
  return { dir, wp, agent: new Agent(wp, dir), state, calls };
}
const provider = (name, args) => ({
  step: async () => ({ calls: [{ id: "fixture", name, args }] }),
});
const prepare = (agent, name, args) => agent.run("p", [], provider(name, args));
async function read(agent, name, args) {
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
const writes = (f) => f.calls.filter((c) => c.method !== "GET");
const approve = async (f, name, args) => {
  const r = await prepare(f.agent, name, args);
  assert.ok(r.review, r.text);
  const before = writes(f).length;
  assert.equal(before, writes(f).length);
  const result = await f.agent.decide("p", r.review.token, true);
  return { review: r.review, result };
};
const undo = async (f, action) => {
  const entry = f.agent.getActivityLog("p").find((e) => e.action === action);
  assert.ok(entry, "log entry " + action);
  assert.equal(entry.canUndo, true);
  const review = await f.agent.prepareUndo("p", entry.id);
  const result = await f.agent.decide("p", review.token, true);
  return { entry, review, result };
};

// ---- taxonomies -----------------------------------------------------------------------------------------------------------------
test("category with a parent: review first, exact read-back, activity log, undo deletes it", async (t) => {
  const f = await fixture(t);
  const parent = await approve(f, "wp_prepare_term_create", {
    taxonomy: "category",
    name: "Parent",
  });
  assert.equal(parent.result.outcome, "verified");
  const parentId = [...f.state.terms.categories.values()].find(
    (x) => x.name === "Parent",
  ).id;
  const r = await prepare(f.agent, "wp_prepare_term_create", {
    taxonomy: "category",
    name: "Tom & Jerry",
    parent: parentId,
    description: "תיאור",
  });
  assert.equal(r.review.kind, "term-create");
  assert.match(r.review.summary, /ייווצר קטגוריה: 'Tom & Jerry' תחת 'Parent'/);
  assert.equal(
    f.state.terms.categories.size,
    2,
    "nothing is written before approval",
  );
  const before = writes(f).length;
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified");
  assert.equal(writes(f).length, before + 1);
  const created = [...f.state.terms.categories.values()].find(
    (x) => x.name === "Tom & Jerry",
  );
  assert.equal(created.parent, parentId);
  assert.ok(out.undo, "undo is offered");
  const log = f.agent
    .getActivityLog("p")
    .find(
      (e) => e.action === "term-create" && e.written?.name === "Tom & Jerry",
    );
  assert.equal(log.state, "verified");
  const u = await undo(f, "term-create");
  assert.equal(u.result.outcome, "verified");
  assert.equal(
    [...f.state.terms.categories.values()].some(
      (x) => x.name === "Tom & Jerry",
    ),
    false,
  );
  assert.equal(
    f.agent
      .getActivityLog("p")
      .find((e) => e.id === log.id || e.action === "term-create").state !==
      undefined,
    true,
  );
});
test("duplicate terms, tag parents, missing parents and denied permission are explained, not written", async (t) => {
  const f = await fixture(t);
  await approve(f, "wp_prepare_term_create", {
    taxonomy: "post_tag",
    name: "חדשות",
  });
  const dup = await prepare(f.agent, "wp_prepare_term_create", {
    taxonomy: "post_tag",
    name: "חדשות",
  });
  assert.equal(dup.review, undefined);
  const tool = async (name, args) => read(f.agent, name, args);
  assert.match(
    (
      await tool("wp_prepare_term_create", {
        taxonomy: "post_tag",
        name: "X",
        parent: 1,
      })
    ).error,
    /אין היררכיה/,
  );
  assert.match(
    (
      await tool("wp_prepare_term_create", {
        taxonomy: "category",
        name: "Y",
        parent: 9999,
      })
    ).error,
    /לא נמצאה/,
  );
  assert.match(
    (
      await tool("wp_prepare_term_create", {
        taxonomy: "post_tag",
        name: "חדשות",
      })
    ).error,
    /כבר קיים/,
  );
  f.state.denyTerms = true;
  const r = await prepare(f.agent, "wp_prepare_term_create", {
    taxonomy: "category",
    name: "Denied",
  });
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "denied");
  assert.match(out.text, /אין לחשבון המחובר הרשאה לנהל קטגוריות/);
  assert.equal(
    f.agent.isBlocked("p"),
    false,
    "a rejected write does not block the project",
  );
});
test("rename and move a term, then undo restores the previous values", async (t) => {
  const f = await fixture(t);
  await approve(f, "wp_prepare_term_create", {
    taxonomy: "category",
    name: "Old name",
    description: "d1",
  });
  const term = [...f.state.terms.categories.values()].find(
    (x) => x.name === "Old name",
  );
  const { review } = await approve(f, "wp_prepare_term_update", {
    taxonomy: "category",
    id: term.id,
    name: "New & better",
    description: "d2",
  });
  assert.deepEqual(review.payload, { name: "New & better", description: "d2" });
  assert.equal(term.name, "New & better");
  const noChange = await read(f.agent, "wp_prepare_term_update", {
    taxonomy: "category",
    id: term.id,
    name: "New & better",
  });
  assert.match(noChange.error, /אין שינוי/);
  await undo(f, "term-update");
  assert.equal(term.name, "Old name");
  assert.equal(term.description, "d1");
});
test("deleting a term with posts warns, removes only the assignment, and undo restores term and assignments", async (t) => {
  const f = await fixture(t);
  await approve(f, "wp_prepare_term_create", {
    taxonomy: "category",
    name: "News",
  });
  const news = [...f.state.terms.categories.values()].find(
    (x) => x.name === "News",
  );
  f.state.items.posts.set(500, {
    id: 500,
    title: "A",
    content: "",
    status: "publish",
    categories: [news.id, 1],
  });
  f.state.items.posts.set(501, {
    id: 501,
    title: "B",
    content: "",
    status: "publish",
    categories: [news.id],
  });
  const r = await prepare(f.agent, "wp_prepare_term_delete", {
    taxonomy: "category",
    id: news.id,
  });
  assert.match(r.review.warning, /אזהרה: ל־2 פריטים משויך/);
  assert.match(r.review.warning, /הפריטים עצמם לא יימחקו/);
  assert.equal(f.state.terms.categories.has(news.id), true);
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified");
  assert.equal(f.state.terms.categories.has(news.id), false);
  assert.deepEqual(f.state.items.posts.get(500).categories, [1]);
  assert.deepEqual(
    f.state.items.posts.get(501).categories,
    [1],
    "WordPress moved the orphan to the default category",
  );
  assert.equal(f.state.items.posts.size, 2, "posts are kept");
  const u = await undo(f, "term-delete");
  assert.equal(u.result.outcome, "verified");
  const back = [...f.state.terms.categories.values()].find(
    (x) => x.name === "News",
  );
  assert.ok(back && back.id !== news.id);
  assert.deepEqual(
    f.state.items.posts.get(500).categories,
    [1, back.id].sort((a, b) => a - b),
  );
  assert.deepEqual(f.state.items.posts.get(501).categories, [back.id]);
});
test("a term with child terms is not deleted, and no-post terms delete cleanly", async (t) => {
  const f = await fixture(t);
  await approve(f, "wp_prepare_term_create", {
    taxonomy: "category",
    name: "Top",
  });
  const top = [...f.state.terms.categories.values()].find(
    (x) => x.name === "Top",
  );
  await approve(f, "wp_prepare_term_create", {
    taxonomy: "category",
    name: "Child",
    parent: top.id,
  });
  const refused = await read(f.agent, "wp_prepare_term_delete", {
    taxonomy: "category",
    id: top.id,
  });
  assert.match(refused.error, /תתי־קטגוריות/);
  const child = [...f.state.terms.categories.values()].find(
    (x) => x.name === "Child",
  );
  const r = await prepare(f.agent, "wp_prepare_term_delete", {
    taxonomy: "category",
    id: child.id,
  });
  assert.match(r.review.warning, /אין פריטים משויכים/);
  await f.agent.decide("p", r.review.token, true);
  assert.equal(f.state.terms.categories.has(child.id), false);
});
test("custom taxonomies are discovered; one that is not exposed gets a clear Hebrew explanation", async (t) => {
  const f = await fixture(t);
  const list = await read(f.agent, "wp_read_taxonomies", {});
  assert.deepEqual(
    list.data.taxonomies.map((x) => x.slug),
    ["category", "post_tag", "genre"],
  );
  await approve(f, "wp_prepare_term_create", {
    taxonomy: "genre",
    name: "Fantasy",
  });
  assert.equal([...f.state.terms.genres.values()][0].name, "Fantasy");
  const terms = await read(f.agent, "wp_list_terms", { taxonomy: "genre" });
  assert.equal(terms.data.terms[0].name, "Fantasy");
  const hidden = await read(f.agent, "wp_prepare_term_create", {
    taxonomy: "secret_tax",
    name: "Z",
  });
  assert.match(hidden.error, /אינו חשוף ל־REST API/);
  assert.match(hidden.error, /show_in_rest/);
  assert.match(hidden.instruction, /site admin|manually/i);
});
test("assigning terms to a post (add) is a reviewed write and undo restores the previous terms", async (t) => {
  const f = await fixture(t);
  await approve(f, "wp_prepare_term_create", {
    taxonomy: "post_tag",
    name: "Sale",
  });
  const tag = [...f.state.terms.tags.values()][0];
  f.state.items.posts.set(500, {
    id: 500,
    title: "Post",
    content: "<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->",
    status: "publish",
    categories: [1],
    tags: [],
  });
  const { review } = await approve(f, "wp_prepare_item_update", {
    type: "post",
    id: 500,
    terms: [{ taxonomy: "post_tag", ids: [tag.id], mode: "add" }],
  });
  assert.match(review.warning, /מפורסם/);
  assert.deepEqual(f.state.items.posts.get(500).tags, [tag.id]);
  assert.deepEqual(
    f.state.items.posts.get(500).categories,
    [1],
    "other terms are untouched",
  );
  const missing = await read(f.agent, "wp_prepare_item_update", {
    type: "post",
    id: 500,
    terms: [{ taxonomy: "post_tag", ids: [987654] }],
  });
  assert.match(missing.error, /מונחים לא קיימים/);
  const same = await read(f.agent, "wp_prepare_item_update", {
    type: "post",
    id: 500,
    terms: [{ taxonomy: "post_tag", ids: [tag.id], mode: "add" }],
  });
  assert.match(same.error, /אין שינוי/);
  await undo(f, "item-update");
  assert.deepEqual(f.state.items.posts.get(500).tags, []);
});

// ---- custom post types ------------------------------------------------------------------------------------------------------------
test("custom post types: discovery, draft creation with terms and meta, update, undo", async (t) => {
  const f = await fixture(t);
  const types = await read(f.agent, "wp_read_post_types", {});
  assert.deepEqual(
    types.data.types.map((x) => [x.slug, x.writable]),
    [
      ["post", true],
      ["page", true],
      ["attachment", false],
      ["book", true],
      ["jet", false],
    ],
  );
  await approve(f, "wp_prepare_term_create", {
    taxonomy: "genre",
    name: "Fantasy",
  });
  const genre = [...f.state.terms.genres.values()][0];
  const noSample = await read(f.agent, "wp_prepare_item_create", {
    type: "book",
    title: "Dune",
    meta: [{ key: "isbn", value: "1" }],
  });
  assert.match(noSample.error, /צרו את הפריט תחילה/);
  const created = await approve(f, "wp_prepare_item_create", {
    type: "book",
    title: "Dune",
    content: "<!-- wp:paragraph --><p>ספר</p><!-- /wp:paragraph -->",
    terms: [{ taxonomy: "genre", ids: [genre.id] }],
  });
  assert.equal(created.review.payload.status, "draft");
  assert.match(
    created.review.summary,
    /ייווצר פריט חדש כטיוטה ב־Books: 'Dune'/,
  );
  const book = [...f.state.items.books.values()][0];
  assert.equal(book.status, "draft");
  assert.deepEqual(book.genres, [genre.id]);
  const meta = await approve(f, "wp_prepare_item_update", {
    type: "book",
    id: book.id,
    meta: [
      { key: "isbn", value: "978-0" },
      { key: "pages", value: "412" },
      { key: "featured", value: "true" },
    ],
  });
  assert.deepEqual(meta.review.payload.meta, {
    isbn: "978-0",
    pages: 412,
    featured: true,
  });
  assert.deepEqual(book.meta, { isbn: "978-0", pages: 412, featured: true });
  const read1 = await read(f.agent, "wp_read_item", {
    type: "book",
    id: book.id,
  });
  assert.equal(read1.untrusted, true);
  assert.equal(read1.data.meta.isbn, "978-0");
  assert.deepEqual(read1.data.terms.genre, [genre.id]);
  assert.match(
    (
      await read(f.agent, "wp_prepare_item_update", {
        type: "book",
        id: book.id,
        meta: [{ key: "secret", value: "x" }],
      })
    ).error,
    /אינו חשוף ל־REST/,
  );
  assert.match(
    (
      await read(f.agent, "wp_prepare_item_update", {
        type: "book",
        id: book.id,
        meta: [{ key: "pages", value: "many" }],
      })
    ).error,
    /מספר/,
  );
  await undo(f, "item-update");
  assert.deepEqual(book.meta, { isbn: "", pages: 0, featured: false });
  const u = await undo(f, "item-create");
  assert.equal(u.result.outcome, "verified");
  assert.equal(book.status, "trash");
});
test("custom post types that are not exposed to REST are explained in Hebrew", async (t) => {
  const f = await fixture(t);
  for (const [name, args] of [
    ["wp_list_items", { type: "event" }],
    ["wp_read_item", { type: "event", id: 1 }],
    ["wp_prepare_item_create", { type: "event", title: "x" }],
  ]) {
    const out = await read(f.agent, name, args);
    assert.match(
      out.error,
      /סוג התוכן "event" אינו חשוף ל־REST API של האתר \(show_in_rest\)/,
    );
    assert.match(out.error, /Show in REST API/);
  }
  const custom = await read(f.agent, "wp_list_items", { type: "jet" });
  assert.match(custom.error, /נתיב REST מותאם/);
  const media = await read(f.agent, "wp_prepare_item_create", {
    type: "attachment",
    title: "x",
  });
  assert.match(media.error, /אינו נתמך לעריכה/);
  assert.equal(writes(f).length, 0);
});
test("item content gets the same block validation as pages", async (t) => {
  const f = await fixture(t);
  assert.throws(() =>
    argumentsFor("wp_prepare_item_create", {
      type: "book",
      title: "x",
      content: "<script>alert(1)</script>",
    }),
  );
  assert.throws(() =>
    argumentsFor("wp_prepare_item_update", {
      type: "book",
      id: 1,
      content: '<!-- wp:html --><div onclick="x()">x</div><!-- /wp:html -->',
    }),
  );
  assert.throws(
    () => argumentsFor("wp_prepare_item_update", { type: "book", id: 1 }),
    /נדרש שינוי/,
  );
  assert.throws(() =>
    argumentsFor("wp_prepare_item_create", {
      type: "book",
      title: "x",
      meta: [{ key: "_hidden", value: "1" }],
    }),
  );
  assert.throws(() =>
    argumentsFor("wp_prepare_item_create", {
      type: "book",
      title: "x",
      meta: [{ key: "a", value: "<b>" }],
    }),
  );
  // Videos must be files on this site, exactly like page content (agent.checkMedia runs before anything is read).
  await assert.rejects(
    f.agent.infra.prepare(f.agent, "p", "wp_prepare_item_create", {
      type: "post",
      title: "x",
      content:
        '<!-- wp:video {"src":"https://evil.example/v.mp4"} --><figure class="wp-block-video"><video controls src="https://evil.example/v.mp4"></video></figure><!-- /wp:video -->',
    }),
  );
  assert.equal(writes(f).length, 0);
});

// ---- plugins ---------------------------------------------------------------------------------------------------------------------
test("plugin install by slug: warning card, inactive install, exact verification, undo removes only what the app installed", async (t) => {
  const f = await fixture(t);
  const r = await prepare(f.agent, "wp_prepare_plugin_install", {
    slug: "classic-editor",
  });
  assert.equal(r.review.kind, "plugin-install");
  assert.ok(
    r.review.warning.startsWith(PLUGIN_WARNING),
    "the Hebrew warning that plugins run code is on the card",
  );
  assert.match(r.review.warning, /מריצים קוד על האתר/);
  assert.deepEqual(r.review.payload, {
    slug: "classic-editor",
    status: "inactive",
  });
  assert.equal(writes(f).length, 0);
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified");
  const post = writes(f).find((c) => c.method === "POST");
  assert.deepEqual(
    post.payload,
    { slug: "classic-editor", status: "inactive" },
    "only a slug is sent, never a URL or file",
  );
  assert.equal(
    f.state.plugins.get("classic-editor/classic-editor").status,
    "inactive",
  );
  const act = await approve(f, "wp_prepare_plugin_activate", {
    plugin: "classic-editor/classic-editor",
  });
  assert.match(act.review.warning, /מריצים קוד/);
  assert.equal(
    f.state.plugins.get("classic-editor/classic-editor").status,
    "active",
  );
  const listed = await read(f.agent, "wp_list_plugins", {});
  assert.deepEqual(
    listed.data.plugins.map((p) => [p.plugin, p.installedByThisApp]),
    [
      ["hello-dolly/hello", false],
      ["classic-editor/classic-editor", true],
    ],
  );
  await undo(f, "plugin-activate");
  assert.equal(
    f.state.plugins.get("classic-editor/classic-editor").status,
    "inactive",
  );
  const removed = await undo(f, "plugin-install");
  assert.equal(removed.result.outcome, "verified");
  assert.equal(f.state.plugins.has("classic-editor/classic-editor"), false);
  assert.equal(
    f.state.plugins.has("hello-dolly/hello"),
    true,
    "other plugins are untouched",
  );
});
test("zip files, URLs and other sources are refused for plugin installs; only a wordpress.org slug is accepted", async (t) => {
  const f = await fixture(t);
  for (const slug of [
    "https://evil.example/plugin.zip",
    "plugin.zip",
    "http://x/y",
    "../evil",
    "a/b",
    "Plugin Name",
    "git@github.com:x/y",
    "classic editor",
    "",
  ])
    assert.throws(
      () => argumentsFor("wp_prepare_plugin_install", { slug }),
      (e) => e.message.length > 10,
      slug,
    );
  for (const slug of [
    "https://evil.example/plugin.zip",
    "plugin.zip",
    "a/b",
    "x:y",
  ])
    assert.throws(
      () => argumentsFor("wp_prepare_plugin_install", { slug }),
      (e) => e.message === ZIP_REFUSED,
      slug,
    );
  for (const key of [
    "url",
    "zip",
    "package",
    "source",
    "file",
    "download",
    "link",
  ])
    assert.throws(
      () =>
        argumentsFor("wp_prepare_plugin_install", {
          slug: "classic-editor",
          [key]: "https://evil.example/p.zip",
        }),
      (e) => e.message === ZIP_REFUSED,
      key,
    );
  assert.throws(
    () =>
      argumentsFor("wp_prepare_plugin_install", {
        url: "https://wordpress.org/plugins/x.zip",
      }),
    (e) => e.message === ZIP_REFUSED,
  );
  assert.deepEqual(
    argumentsFor("wp_prepare_plugin_install", { slug: "classic-editor" }),
    { slug: "classic-editor" },
  );
  assert.deepEqual(
    argumentsFor("wp_prepare_plugin_install", { slug: "zip-code-checker" }),
    { slug: "zip-code-checker" },
  );
  const schema = tools.find(
    (x) => x.name === "wp_prepare_plugin_install",
  ).parameters;
  assert.deepEqual(
    Object.keys(schema.properties),
    ["slug"],
    "the tool schema has no URL or file field",
  );
  assert.ok(
    ZIP_REFUSED.includes("ZIP") && ZIP_REFUSED.includes("wordpress.org"),
  );
  // Even if validation were bypassed, the review path rejects it before any request.
  const r = await prepare(f.agent, "wp_prepare_plugin_install", {
    slug: "https://evil.example/p.zip",
  }).catch((e) => ({ error: e.message }));
  assert.equal(r.review, undefined);
  assert.equal(writes(f).length, 0);
  // The low-level request only reaches the fixed plugin routes.
  await assert.rejects(
    f.agent.infra.request("p", { route: "plugins", target: "../users/me" }),
  );
  await assert.rejects(f.agent.infra.request("p", { route: "users" }));
  await assert.rejects(
    f.agent.infra.request("p", { route: "terms", base: "users" }),
  );
  await assert.rejects(
    f.agent.infra.request("p", {
      route: "items",
      base: "settings",
      method: "POST",
      payload: { title: "x" },
      allow: ["title"],
    }),
  );
  await assert.rejects(
    f.agent.infra.request("p", {
      route: "items",
      base: "books",
      target: 1,
      method: "DELETE",
    }),
  );
  await assert.rejects(
    f.agent.infra.request("p", {
      route: "plugins",
      method: "POST",
      payload: { slug: "x", url: "https://evil.example/x.zip" },
      allow: ["slug", "status"],
    }),
  );
});
test("unknown slug, existing plugin, and a missing permission are explained in Hebrew", async (t) => {
  const f = await fixture(t);
  const unknown = await prepare(f.agent, "wp_prepare_plugin_install", {
    slug: "no-such-plugin-xyz",
  });
  const out = await f.agent.decide("p", unknown.review.token, true);
  assert.equal(out.outcome, "denied");
  assert.match(out.text, /לא נמצא בספרייה הרשמית של wordpress.org/);
  const have = await read(f.agent, "wp_prepare_plugin_install", {
    slug: "hello-dolly",
  });
  assert.match(have.error, /כבר מותקן/);
  f.state.canInstall = false;
  const r = await prepare(f.agent, "wp_prepare_plugin_install", {
    slug: "classic-editor",
  });
  const denied = await f.agent.decide("p", r.review.token, true);
  assert.equal(denied.outcome, "denied");
  assert.match(denied.text, /אין לחשבון המחובר הרשאה לנהל תוספים/);
  assert.equal(f.agent.isBlocked("p"), false);
  assert.equal(f.state.plugins.size, 1);
});
test("plugins the app did not install are touched only on an explicit user request", async (t) => {
  const f = await fixture(t);
  const refused = await read(f.agent, "wp_prepare_plugin_activate", {
    plugin: "hello-dolly/hello",
  });
  assert.match(refused.error, /לא הותקן על ידי האפליקציה/);
  assert.match(refused.error, /userRequested/);
  assert.equal(f.state.plugins.get("hello-dolly/hello").status, "inactive");
  const { review } = await approve(f, "wp_prepare_plugin_activate", {
    plugin: "hello-dolly/hello",
    userRequested: true,
  });
  assert.match(review.warning, /לבקשתך המפורשת/);
  assert.equal(f.state.plugins.get("hello-dolly/hello").status, "active");
  const already = await read(f.agent, "wp_prepare_plugin_activate", {
    plugin: "hello-dolly/hello",
    userRequested: true,
  });
  assert.match(already.error, /כבר פעיל/);
  assert.match(
    (
      await read(f.agent, "wp_prepare_plugin_deactivate", {
        plugin: "nope/nope",
        userRequested: true,
      })
    ).error,
    /לא נמצא/,
  );
  // Undo of a change to a foreign plugin only toggles it back; it never deletes it.
  await undo(f, "plugin-activate");
  assert.equal(f.state.plugins.get("hello-dolly/hello").status, "inactive");
  assert.equal(f.state.plugins.has("hello-dolly/hello"), true);
});
test("an ambiguous write that did land is verified by ONE read-back, never a second write", async (t) => {
  const f = await fixture(t);
  await approve(f, "wp_prepare_term_create", {
    taxonomy: "category",
    name: "Base",
  });
  const term = [...f.state.terms.categories.values()].find(
    (x) => x.name === "Base",
  );
  f.state.failAfterApply = (call) =>
    call.method === "POST" && call.target === term.id;
  const r = await prepare(f.agent, "wp_prepare_term_update", {
    taxonomy: "category",
    id: term.id,
    name: "Renamed",
  });
  const before = writes(f).length;
  const out = await f.agent.decide("p", r.review.token, true);
  assert.equal(out.outcome, "verified");
  assert.equal(writes(f).length, before + 1, "exactly one write");
  assert.equal(term.name, "Renamed");
});
test("a state that changed since the review blocks the write", async (t) => {
  const f = await fixture(t);
  await approve(f, "wp_prepare_term_create", {
    taxonomy: "category",
    name: "Moving",
  });
  const term = [...f.state.terms.categories.values()].find(
    (x) => x.name === "Moving",
  );
  const r = await prepare(f.agent, "wp_prepare_term_update", {
    taxonomy: "category",
    id: term.id,
    name: "Mine",
  });
  term.name = "Someone else";
  const count = writes(f).length;
  await assert.rejects(
    f.agent.decide("p", r.review.token, true),
    /האתר השתנה מאז הבדיקה/,
  );
  assert.equal(writes(f).length, count);
  assert.equal(term.name, "Someone else");
});
test("the new tools are valid for every provider and one prepare call per response is enforced like other writes", () => {
  const names = [
    "wp_read_taxonomies",
    "wp_list_terms",
    "wp_read_post_types",
    "wp_list_items",
    "wp_read_item",
    "wp_list_plugins",
    "wp_prepare_term_create",
    "wp_prepare_term_update",
    "wp_prepare_term_delete",
    "wp_prepare_item_create",
    "wp_prepare_item_update",
    "wp_prepare_plugin_install",
    "wp_prepare_plugin_activate",
    "wp_prepare_plugin_deactivate",
  ];
  for (const name of names) {
    const tool = tools.find((x) => x.name === name);
    assert.ok(tool, name);
    assert.equal(tool.parameters.additionalProperties, false);
  }
  assert.throws(() =>
    argumentsFor("wp_prepare_term_create", {
      taxonomy: "category",
      name: "<b>x</b>",
    }),
  );
  assert.throws(() =>
    argumentsFor("wp_prepare_term_create", {
      taxonomy: "Category!",
      name: "x",
    }),
  );
  assert.throws(() =>
    argumentsFor("wp_prepare_term_create", {
      taxonomy: "category",
      name: "x",
      slug: "Bad Slug",
    }),
  );
  assert.throws(
    () =>
      argumentsFor("wp_prepare_term_update", { taxonomy: "category", id: 3 }),
    /נדרש שינוי/,
  );
  assert.throws(
    () =>
      argumentsFor("wp_prepare_term_delete", {
        taxonomy: "category",
        id: 3,
        force: true,
      }),
    /פרמטרים לא מורשים/,
  );
});
