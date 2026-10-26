"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Agent, argumentsFor } = require("../src/wp-agent.cjs");
const { WordPress } = require("../src/wordpress.cjs");
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const provider = (name, args) => ({
  step: async () => ({ calls: [{ id: "fixture", name, args }] }),
});
const prepare = (agent, name, args) => agent.run("p", [], provider(name, args));
const writes = (f) => f.calls.filter((c) => c.method !== "GET");
const page = (id, title = "Existing", status = "draft") => ({
  id,
  status,
  title: { raw: title },
  content: { raw: "<p>Existing content</p>" },
  modified: "initial",
  link: `https://public.example/?page_id=${id}`,
});
async function fixture(t, { block = false, ref = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-structure-plan-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const state = {
    block,
    settings: {
      title: "Old site",
      description: "Old tagline",
      show_on_front: "posts",
      page_on_front: 0,
      timezone: "UTC",
    },
    pages: new Map([
      [5, page(5)],
      [6, page(6, "About")],
    ]),
    locations: { primary: 1, footer: 1 },
    menus: new Map([[1, { id: 1, name: "Original menu", auto_add: true }]]),
    items: new Map([
      [
        10,
        {
          id: 10,
          title: { raw: "Original" },
          status: "publish",
          type: "post_type",
          object: "page",
          object_id: 5,
          menus: 1,
          menu_order: 1,
        },
      ],
    ]),
    navigation: new Map([
      [
        20,
        {
          id: 20,
          status: "publish",
          title: { raw: "Original navigation" },
          content: { raw: "<!-- wp:page-list /-->" },
        },
      ],
    ]),
    header: {
      id: "fixture//header",
      theme: "fixture",
      slug: "header",
      area: "header",
      content: {
        raw: `<!-- wp:group --><div class="wp-block-group"><!-- wp:navigation ${ref ? '{"ref":20}' : '{"layout":{"type":"flex"}}'} /--></div><!-- /wp:group -->`,
      },
    },
    next: 100,
    revision: 0,
    media: null,
  };
  const wp = new WordPress(dir, storage, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (url, options) => {
      const route = url.searchParams.get("rest_route") || "image";
      const parts = route.split("/");
      const resource = parts[3],
        rawId = parts.slice(4).join("/"),
        target = rawId ? Number(rawId) : null;
      const method = options.method || "GET";
      const payload =
        options.body && !Buffer.isBuffer(options.body)
          ? JSON.parse(options.body)
          : undefined;
      const call = { route, resource, target, method, payload, url, options };
      calls.push(call);
      if (state.fail?.(call)) throw Error("Injected network failure");
      if (options.binary)
        return { status: 200, contentType: "image/png", body: png };
      const reply = (data, status = 200) => ({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
      const missing = (term = false) =>
        reply(
          {
            code: term ? "rest_term_invalid" : "rest_post_invalid_id",
            data: { status: 404 },
          },
          404,
        );
      if (resource === "users" && rawId === "me") return reply({ id: 7 });
      if (resource === "themes")
        return reply([
          {
            stylesheet: "fixture",
            status: "active",
            is_block_theme: state.block,
          },
        ]);
      if (resource === "settings") {
        if (method === "POST") Object.assign(state.settings, payload);
        return reply(state.settings);
      }
      if (["pages", "posts"].includes(resource)) {
        if (method === "POST") {
          const current = target ? state.pages.get(target) : page(state.next++);
          if (!current) return missing();
          for (const [key, value] of Object.entries(payload))
            current[key] = ["title", "content"].includes(key)
              ? { raw: value }
              : value;
          current.modified = `revision-${++state.revision}`;
          state.pages.set(current.id, current);
          return reply(current, target ? 200 : 201);
        }
        const current = state.pages.get(target);
        return current ? reply(current) : missing();
      }
      if (resource === "menu-locations")
        return reply(
          Object.fromEntries(
            Object.entries(state.locations).map(([key, menu]) => [
              key,
              { name: key, description: key, menu },
            ]),
          ),
        );
      if (resource === "menus") {
        if (method === "POST") {
          const menu = target
            ? state.menus.get(target)
            : { id: state.next++, name: payload.name, auto_add: false };
          if (!menu) return missing(true);
          if (payload.name !== undefined) menu.name = payload.name;
          if (payload.auto_add !== undefined) menu.auto_add = payload.auto_add;
          if (payload.locations) {
            for (const key of Object.keys(state.locations))
              if (state.locations[key] === menu.id) state.locations[key] = 0;
            for (const key of payload.locations) state.locations[key] = menu.id;
          }
          state.menus.set(menu.id, menu);
          return reply(
            {
              ...menu,
              locations: Object.keys(state.locations).filter(
                (key) => state.locations[key] === menu.id,
              ),
            },
            target ? 200 : 201,
          );
        }
        const menu = state.menus.get(target);
        if (!menu) return missing(true);
        if (method === "DELETE") {
          state.menus.delete(target);
          for (const key of Object.keys(state.locations))
            if (state.locations[key] === target) state.locations[key] = 0;
          return reply({ deleted: true, previous: menu });
        }
        return reply({
          ...menu,
          locations: Object.keys(state.locations).filter(
            (key) => state.locations[key] === target,
          ),
        });
      }
      if (resource === "menu-items") {
        if (method === "POST") {
          const item = {
            ...payload,
            id: state.next++,
            title: { raw: payload.title },
          };
          state.items.set(item.id, item);
          return reply(item, 201);
        }
        if (target === null)
          return reply(
            [...state.items.values()]
              .filter(
                (item) => item.menus === Number(url.searchParams.get("menus")),
              )
              .sort((a, b) => a.menu_order - b.menu_order),
          );
        const item = state.items.get(target);
        if (!item) return missing();
        if (method === "DELETE") {
          state.items.delete(target);
          return reply({ deleted: true, previous: item });
        }
        return reply(item);
      }
      if (resource === "navigation") {
        if (method === "POST") {
          const item = {
            id: target || state.next++,
            title: { raw: payload.title },
            content: { raw: payload.content },
            status: payload.status,
          };
          state.navigation.set(item.id, item);
          return reply(item, target ? 200 : 201);
        }
        const item = state.navigation.get(target);
        if (!item) return missing();
        if (method === "DELETE") {
          state.navigation.delete(target);
          return reply({ deleted: true, previous: item });
        }
        return reply(item);
      }
      if (resource === "template-parts") {
        if (method === "POST") {
          assert.equal(rawId, state.header.id);
          state.header.content.raw = payload.content;
          return reply(state.header);
        }
        return reply(rawId ? state.header : [state.header]);
      }
      if (resource === "media") {
        if (method === "POST") {
          const body = options.body.toString("utf8");
          const field = (name) =>
            body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))[1];
          state.media = {
            id: state.next++,
            status: "inherit",
            title: { raw: field("title") },
            alt_text: field("alt_text"),
            media_type: "image",
            mime_type: "image/png",
            source_url: "https://public.example/uploads/hero.png",
            modified: "media",
          };
          return reply(state.media, 201);
        }
        if (!state.media || state.media.id !== target) return missing();
        if (method === "DELETE") {
          const previous = state.media;
          state.media = null;
          return reply({ deleted: true, previous });
        }
        return reply(state.media);
      }
      throw Error(`Unexpected mock route ${route}`);
    },
  });
  await wp.connect("p", {
    site: "https://public.example",
    username: "fixture",
    password: "PUBLIC-DUMMY",
  });
  return { dir, wp, agent: new Agent(wp, dir), state, calls };
}

test("settings allowlist maps site identity, verifies writes and restores only original permitted keys", async (t) => {
  const f = await fixture(t);
  const review = await prepare(f.agent, "wp_prepare_site_identity", {
    blogname: "New site",
    blogdescription: "New tagline",
  });
  assert.deepEqual(review.review.payload, {
    title: "New site",
    description: "New tagline",
  });
  assert.equal(writes(f).length, 0);
  await f.agent.decide("p", review.review.token, true);
  assert.equal(f.state.settings.title, "New site");
  assert.equal(f.state.settings.timezone, "UTC");
  const original = f.agent.getActivityLog("p")[0];
  const undo = await f.agent.prepareUndo("p", original.id);
  await f.agent.decide("p", undo.token, true);
  assert.equal(f.state.settings.title, "Old site");
  assert.equal(f.state.settings.description, "Old tagline");
  assert.equal(
    f.agent.getActivityLog("p").find((r) => r.id === original.id).state,
    "restored",
  );
  const count = f.calls.length;
  for (const key of [
    "url",
    "email",
    "timezone",
    "page_for_posts",
    "default_role",
    "blogname",
  ]) {
    await assert.rejects(
      f.agent.structure.request("p", "settings", null, "POST", {
        [key]: "forbidden",
      }),
    );
  }
  assert.equal(f.calls.length, count);
  assert.throws(() =>
    argumentsFor("wp_prepare_site_identity", {
      blogname: "Name",
      email: "bad@example.com",
    }),
  );
});

test("homepage changes exactly two settings and undo restores posts mode and the previous page ID", async (t) => {
  const f = await fixture(t);
  const pending = await prepare(f.agent, "wp_prepare_front_page", {
    pageId: 5,
  });
  assert.equal(writes(f).length, 0);
  await f.agent.decide("p", pending.review.token, true);
  assert.deepEqual(writes(f)[0].payload, {
    show_on_front: "page",
    page_on_front: 5,
  });
  assert.equal(f.state.pages.get(5).status, "draft");
  const row = f.agent.getActivityLog("p")[0];
  const undo = await f.agent.prepareUndo("p", row.id);
  await f.agent.decide("p", undo.token, true);
  assert.equal(f.state.settings.show_on_front, "posts");
  assert.equal(f.state.settings.page_on_front, 0);
});

test("publish has a Hebrew public warning, preserves content, consumes approval once and undoes to draft", async (t) => {
  const f = await fixture(t);
  const pending = await prepare(f.agent, "wp_prepare_publish_page", { id: 5 });
  assert.match(pending.review.warning, /גלוי לציבור/);
  assert.equal(writes(f).length, 0);
  await f.agent.decide("p", pending.review.token, true);
  assert.equal(f.state.pages.get(5).status, "publish");
  assert.deepEqual(writes(f)[0].payload, { status: "publish" });
  await assert.rejects(f.agent.decide("p", pending.review.token, true));
  assert.equal(writes(f).length, 1);
  const row = f.agent.getActivityLog("p")[0];
  const undo = await f.agent.prepareUndo("p", row.id);
  await f.agent.decide("p", undo.token, true);
  assert.equal(f.state.pages.get(5).status, "draft");
  assert.equal(f.state.pages.get(5).content.raw, "<p>Existing content</p>");
});

test("classic menu is built and verified before primary assignment; undo preserves the original identities and other locations", async (t) => {
  const f = await fixture(t);
  const pending = await prepare(f.agent, "wp_prepare_menu", {
    title: "New main",
    links: [
      { pageId: 5, label: "Home" },
      { pageId: 6, label: "About" },
    ],
  });
  assert.equal(pending.review.resource, "menus");
  assert.equal(writes(f).length, 0);
  await f.agent.decide("p", pending.review.token, true);
  assert.notEqual(f.state.locations.primary, 1);
  assert.equal(f.state.locations.footer, 1);
  assert.equal(f.state.menus.get(1).auto_add, false);
  assert.ok(f.state.items.has(10));
  const sequence = writes(f);
  const assignment = sequence.findIndex(
    (c) => c.resource === "menus" && c.payload?.locations?.includes("primary"),
  );
  assert.equal(
    sequence.slice(0, assignment).filter((c) => c.resource === "menu-items")
      .length,
    2,
  );
  const row = f.agent.getActivityLog("p")[0];
  assert.equal(row.createdItemIds.length, 2);
  const undo = await f.agent.prepareUndo("p", row.id);
  await f.agent.decide("p", undo.token, true);
  assert.deepEqual(f.state.locations, { primary: 1, footer: 1 });
  assert.equal(f.state.menus.get(1).auto_add, true);
  assert.deepEqual([...f.state.menus.keys()], [1]);
  assert.deepEqual([...f.state.items.keys()], [10]);
  assert.equal(
    f.agent.getActivityLog("p").find((e) => e.id === row.id).state,
    "restored",
  );
});

test("block theme updates the navigation actually referenced by its header and restores the old navigation", async (t) => {
  const f = await fixture(t, { block: true });
  const original = structuredClone(f.state.navigation.get(20));
  const header = f.state.header.content.raw;
  const pending = await prepare(f.agent, "wp_prepare_menu", {
    title: "Main",
    links: [{ pageId: 5, label: "בית" }],
  });
  assert.equal(pending.review.resource, "navigation");
  await f.agent.decide("p", pending.review.token, true);
  assert.equal(f.state.header.content.raw, header);
  assert.match(f.state.navigation.get(20).content.raw, /navigation-link/);
  assert.ok(writes(f).every((c) => c.resource === "navigation"));
  const row = f.agent.getActivityLog("p")[0];
  const undo = await f.agent.prepareUndo("p", row.id);
  await f.agent.decide("p", undo.token, true);
  assert.deepEqual(f.state.navigation.get(20), original);
});

test("new block navigation is bound to the header and undo restores the exact prior header", async (t) => {
  const f = await fixture(t, { block: true, ref: false });
  const before = f.state.header.content.raw;
  const pending = await prepare(f.agent, "wp_prepare_menu", {
    title: "Main",
    links: [{ pageId: 5, label: "Home" }],
  });
  await f.agent.decide("p", pending.review.token, true);
  const row = f.agent.getActivityLog("p")[0];
  assert.ok(row.createdMenuId);
  assert.match(
    f.state.header.content.raw,
    new RegExp(`"ref":${row.createdMenuId}`),
  );
  assert.equal(
    writes(f).filter((c) => c.resource === "template-parts").length,
    1,
  );
  const undo = await f.agent.prepareUndo("p", row.id);
  await f.agent.decide("p", undo.token, true);
  assert.equal(f.state.header.content.raw, before);
  assert.equal(f.state.navigation.has(row.createdMenuId), false);
  assert.equal(f.state.navigation.has(20), true);
});

const fullPlan = () => ({
  title: "בניית אתר",
  steps: [
    {
      key: "home",
      tool: "wp_prepare_create_page",
      args: { title: "בית", content: "<p>Home</p>" },
    },
    {
      key: "about",
      tool: "wp_prepare_create_page",
      args: { title: "אודות", content: "<p>About</p>" },
    },
    {
      key: "publish_home",
      tool: "wp_prepare_publish_page",
      args: { id: "{{home.id}}" },
    },
    {
      key: "publish_about",
      tool: "wp_prepare_publish_page",
      args: { id: "{{about.id}}" },
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
      key: "identity",
      tool: "wp_prepare_site_identity",
      args: { blogname: "אתר חדש" },
    },
  ],
});

test("one approval resolves earlier IDs, logs each step, persists outcomes and reverses the completed plan", async (t) => {
  const f = await fixture(t);
  let pending = await prepare(f.agent, "wp_prepare_build_plan", fullPlan());
  assert.equal(pending.review.steps.length, 7);
  assert.equal(writes(f).length, 0);
  await f.agent.decide("p", pending.review.token, false);
  assert.equal(writes(f).length, 0);
  pending = await prepare(f.agent, "wp_prepare_build_plan", fullPlan());
  const planId = pending.review.token;
  pending.review.steps[0].payload.title = "renderer tampering";
  const result = await f.agent.decide("p", planId, true);
  assert.equal(result.plan.state, "complete");
  assert.ok(result.plan.steps.every((step) => step.state === "verified"));
  const rows = f.agent.getActivityLog("p").filter((e) => e.planId === planId);
  assert.equal(rows.length, 7);
  const home = rows.find((r) => r.planIndex === 0).pageId;
  assert.equal(f.state.pages.get(home).title.raw, "בית");
  assert.equal(f.state.pages.get(home).status, "publish");
  assert.equal(f.state.settings.page_on_front, home);
  assert.equal(f.agent.plans.list("other").length, 0);
  const restarted = new Agent(f.wp, f.dir);
  assert.equal(restarted.plans.list("p")[0].canUndo, true);
  const beforeUndo = writes(f).length;
  const undo = await restarted.plans.prepareUndo("p", planId);
  assert.equal(undo.kind, "undo-plan");
  assert.equal(undo.steps.length, 7);
  assert.equal(writes(f).length, beforeUndo);
  assert.match(undo.steps[0].label, /7/);
  const undone = await restarted.decide("p", undo.token, true);
  assert.equal(undone.plan.state, "complete");
  assert.equal(f.state.settings.title, "Old site");
  assert.equal(f.state.settings.show_on_front, "posts");
  assert.equal(f.state.pages.get(home).status, "trash");
  assert.deepEqual(f.state.locations, { primary: 1, footer: 1 });
  assert.ok(
    restarted
      .getActivityLog("p")
      .filter((e) => e.planId === planId)
      .every((e) => e.state === "restored"),
  );
  const count = writes(f).length;
  await assert.rejects(restarted.decide("p", undo.token, true));
  assert.equal(writes(f).length, count);
});

test("upload references use verified image ID/URL without changing image/block validation", async (t) => {
  const f = await fixture(t);
  const pending = await prepare(f.agent, "wp_prepare_build_plan", {
    title: "תמונה ועמוד",
    steps: [
      {
        key: "hero",
        tool: "wp_prepare_upload_image",
        args: {
          url: "https://images.example/hero.png",
          fileName: "hero.png",
          alt: "תמונה",
        },
      },
      {
        key: "home",
        tool: "wp_prepare_create_page",
        args: {
          title: "בית",
          content:
            '<!-- wp:image {"id":{{hero.id}}} --><figure class="wp-block-image"><img src="{{hero.url}}" alt="תמונה" class="wp-image-{{hero.id}}" /></figure><!-- /wp:image -->',
        },
      },
    ],
  });
  assert.equal(writes(f).length, 0);
  const result = await f.agent.decide("p", pending.review.token, true);
  assert.equal(result.plan.state, "complete");
  const created = f.agent
    .getActivityLog("p")
    .find((e) => e.planId === pending.review.token && e.action === "create");
  assert.match(
    f.state.pages.get(created.pageId).content.raw,
    new RegExp(`"id":${f.state.media.id}`),
  );
  assert.ok(
    f.state.pages
      .get(created.pageId)
      .content.raw.includes(f.state.media.source_url),
  );
  const undo = await f.agent.plans.prepareUndo("p", pending.review.token);
  const undone = await f.agent.decide("p", undo.token, true);
  assert.equal(undone.plan.state, "complete");
  assert.equal(f.state.pages.get(created.pageId).status, "trash");
  assert.equal(f.state.media, null);
});

test("a known conflict stops the plan without blocking or executing later steps; completed steps remain undoable", async (t) => {
  const f = await fixture(t);
  const pending = await prepare(f.agent, "wp_prepare_build_plan", {
    title: "Conflict",
    steps: [
      {
        key: "home",
        tool: "wp_prepare_create_page",
        args: { title: "New", content: "<p>New</p>" },
      },
      {
        key: "identity",
        tool: "wp_prepare_site_identity",
        args: { blogname: "Expected" },
      },
      {
        key: "publish",
        tool: "wp_prepare_publish_page",
        args: { id: "{{home.id}}" },
      },
    ],
  });
  f.state.settings.title = "External change";
  const result = await f.agent.decide("p", pending.review.token, true);
  assert.deepEqual(
    result.plan.steps.map((s) => s.state),
    ["verified", "failed", "not-run"],
  );
  assert.equal(writes(f).length, 1);
  assert.equal(f.agent.isBlocked("p"), false);
  const undo = await f.agent.plans.prepareUndo("p", pending.review.token);
  assert.equal(undo.steps.length, 1);
  await f.agent.decide("p", undo.token, true);
  assert.equal(f.state.settings.title, "External change");
});

test("unknown step stops immediately, blocks only its project and remains unknown after restart", async (t) => {
  const f = await fixture(t);
  const pending = await prepare(f.agent, "wp_prepare_build_plan", {
    title: "Unknown",
    steps: [
      {
        key: "home",
        tool: "wp_prepare_create_page",
        args: { title: "New", content: "<p>New</p>" },
      },
      {
        key: "front",
        tool: "wp_prepare_front_page",
        args: { pageId: "{{home.id}}" },
      },
      {
        key: "publish",
        tool: "wp_prepare_publish_page",
        args: { id: "{{home.id}}" },
      },
    ],
  });
  // The write fails AND the read-back shows a state that is neither the approved one nor the old one: truly unknown.
  f.state.fail = (call) => {
    if (call.resource === "settings" && call.method === "POST") {
      f.state.settings.page_on_front = 999;
      return true;
    }
    return false;
  };
  const result = await f.agent.decide("p", pending.review.token, true);
  assert.deepEqual(
    result.plan.steps.map((s) => s.state),
    ["verified", "unknown", "not-run"],
  );
  assert.equal(writes(f).length, 2);
  assert.equal(f.agent.isBlocked("p"), true);
  assert.equal(f.agent.isBlocked("other"), false);
  const restarted = new Agent(f.wp, f.dir);
  assert.equal(restarted.isBlocked("p"), true);
  assert.deepEqual(
    restarted.plans.list("p")[0].steps.map((s) => s.state),
    ["verified", "unknown", "not-run"],
  );
  await assert.rejects(restarted.plans.prepareUndo("p", pending.review.token));
  assert.equal(writes(f).length, 2);
});

test("partial classic menu failure is journaled and never assigns or retries the incomplete menu", async (t) => {
  const f = await fixture(t);
  const pending = await prepare(f.agent, "wp_prepare_menu", {
    title: "Partial",
    links: [
      { pageId: 5, label: "Home" },
      { pageId: 6, label: "About" },
    ],
  });
  f.state.fail = (c) =>
    c.resource === "menu-items" &&
    c.method === "POST" &&
    c.payload.menu_order === 2;
  assert.equal(
    (await f.agent.decide("p", pending.review.token, true)).outcome,
    "unknown",
  ); // ambiguous writes are reported as a result and still block
  assert.equal(f.state.locations.primary, 1);
  assert.equal(writes(f).filter((c) => c.resource === "menu-items").length, 2);
  const row = f.agent.getActivityLog("p")[0];
  assert.equal(row.state, "unknown");
  assert.ok(row.progress.length >= 2);
  assert.equal(f.agent.isBlocked("p"), true);
});

test("plan validation rejects forward/cross-type references, hidden settings and more than 40 steps before network", () => {
  const one = {
    key: "home",
    tool: "wp_prepare_create_page",
    args: { title: "Home", content: "<p>Home</p>" },
  };
  for (const steps of [
    [
      {
        key: "pub",
        tool: "wp_prepare_publish_page",
        args: { id: "{{home.id}}" },
      },
      one,
    ],
    [
      one,
      {
        key: "pub",
        tool: "wp_prepare_publish_post",
        args: { id: "{{home.id}}" },
      },
    ],
    [
      one,
      {
        key: "front",
        tool: "wp_prepare_front_page",
        args: { pageId: "{{home.id}}", timezone: "bad" },
      },
    ],
    [
      one,
      {
        key: "home",
        tool: "wp_prepare_site_identity",
        args: { blogname: "Duplicate" },
      },
    ],
    [
      one,
      {
        key: "upload",
        tool: "wp_prepare_upload_image",
        args: { url: "{{home.url}}", fileName: "x.png", alt: "x" },
      },
    ],
    Array.from({ length: 41 }, (_, i) => ({ ...one, key: `page_${i}` })),
    [
      {
        key: "settings",
        tool: "wp_prepare_site_identity",
        args: { blogname: "A" },
      },
      {
        key: "again",
        tool: "wp_prepare_site_identity",
        args: { blogname: "B" },
      },
    ],
  ])
    assert.throws(() =>
      argumentsFor("wp_prepare_build_plan", { title: "Invalid", steps }),
    );
});

test("plan references do not mistake nested Gutenberg attributes for reference delimiters", () => {
  const content =
    '<!-- wp:group {"style":{"color":{"background":"#ffffff"}}} --><div class="wp-block-group" style="background-color:#ffffff"><!-- wp:paragraph --><p>Welcome</p><!-- /wp:paragraph --></div><!-- /wp:group -->';
  assert.doesNotThrow(() =>
    argumentsFor("wp_prepare_build_plan", {
      title: "Designed page",
      steps: [
        {
          key: "home",
          tool: "wp_prepare_create_page",
          args: { title: "Home", content },
        },
        {
          key: "publish",
          tool: "wp_prepare_publish_page",
          args: { id: "{{home.id}}" },
        },
      ],
    }),
  );
  assert.throws(() =>
    argumentsFor("wp_prepare_menu", {
      title: "Main",
      location: 1,
      links: [{ pageId: 5, label: "Home" }],
    }),
  );
});

test("menu undo refuses external changes to the retained menu before requesting approval", async (t) => {
  const f = await fixture(t);
  const pending = await prepare(f.agent, "wp_prepare_menu", {
    title: "Main",
    links: [{ pageId: 5, label: "Home" }],
  });
  await f.agent.decide("p", pending.review.token, true);
  const entry = f.agent.getActivityLog("p")[0];
  f.state.menus.get(1).auto_add = true;
  const count = writes(f).length;
  await assert.rejects(f.agent.prepareUndo("p", entry.id));
  assert.equal(writes(f).length, count);
});

test("header edits during new block navigation creation are preserved and stop the write", async (t) => {
  const f = await fixture(t, { block: true, ref: false });
  const pending = await prepare(f.agent, "wp_prepare_menu", {
    title: "Main",
    links: [{ pageId: 5, label: "Home" }],
  });
  f.state.fail = (call) => {
    if (call.resource === "navigation" && call.method === "POST")
      f.state.header.content.raw += "<!-- External edit -->";
    return false;
  };
  assert.equal(
    (await f.agent.decide("p", pending.review.token, true)).outcome,
    "unknown",
  );
  assert.equal(
    writes(f).filter((call) => call.resource === "template-parts").length,
    0,
  );
  assert.ok(f.state.header.content.raw.endsWith("<!-- External edit -->"));
  assert.equal(f.agent.isBlocked("p"), true);
});

test("header template part and site logo: reviewed, verified in a plan, and undone", async (t) => {
  const f = await fixture(t, { block: true, ref: true });
  f.state.settings.site_logo = 0;
  const originalHeader = f.state.header.content.raw;
  const header =
    '<!-- wp:group {"layout":{"type":"flex","justifyContent":"space-between"}} --><div class="wp-block-group"><!-- wp:site-logo {"width":120} /--><!-- wp:navigation {"ref":20} /--></div><!-- /wp:group -->';
  const pending = await prepare(f.agent, "wp_prepare_build_plan", {
    title: "לוגו וכותרת",
    steps: [
      {
        key: "logo",
        tool: "wp_prepare_upload_image",
        args: {
          url: "https://images.example/logo.png",
          fileName: "logo.png",
          alt: "לוגו",
        },
      },
      {
        key: "mark",
        tool: "wp_prepare_site_logo",
        args: { mediaId: "{{logo.id}}" },
      },
      { key: "top", tool: "wp_prepare_header", args: { content: header } },
    ],
  });
  assert.equal(writes(f).length, 0);
  const result = await f.agent.decide("p", pending.review.token, true);
  assert.equal(result.plan.state, "complete");
  assert.equal(f.state.settings.site_logo, f.state.media.id);
  assert.equal(f.state.header.content.raw, header);
  // Undo restores the previous header (and the previous logo) through a fresh review.
  const rows = f.agent.getActivityLog("p");
  const headerRow = rows.find((e) => e.action === "header");
  assert.equal(headerRow.canUndo, true);
  const undo = await f.agent.prepareUndo("p", headerRow.id);
  assert.equal(undo.kind, "template-restore");
  await f.agent.decide("p", undo.token, true);
  assert.equal(f.state.header.content.raw, originalHeader);
  const logoRow = f.agent
    .getActivityLog("p")
    .find((e) => e.action === "site-logo");
  assert.equal(logoRow.canUndo, true);
});

test("header, footer and logo are refused on a classic theme with a manual-handling reason", async (t) => {
  const f = await fixture(t, { block: false });
  f.state.settings.site_logo = 0;
  for (const [name, args] of [
    ["wp_prepare_header", { content: "<!-- wp:site-logo /-->" }],
    [
      "wp_prepare_footer",
      { content: "<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->" },
    ],
    ["wp_prepare_site_logo", { mediaId: 5 }],
  ])
    await assert.rejects(
      prepare(f.agent, name, args),
      /Block Theme|דורש טיפול ידני/,
    );
  assert.equal(writes(f).length, 0);
});

test("result cards say what each step did, and the view button matches what exists", async (t) => {
  const f = await fixture(t, { block: true, ref: true });
  f.state.settings.site_logo = 0;
  const logoPlan = await prepare(f.agent, "wp_prepare_build_plan", {
    title: "לוגו",
    steps: [
      {
        key: "logo",
        tool: "wp_prepare_upload_image",
        args: {
          url: "https://images.example/logo.png",
          fileName: "logo.png",
          alt: "לוגו",
        },
      },
      {
        key: "mark",
        tool: "wp_prepare_site_logo",
        args: { mediaId: "{{logo.id}}" },
      },
    ],
  });
  const done = await f.agent.decide("p", logoPlan.review.token, true);
  const lines = done.text.split("\n");
  assert.match(lines[0], /^✅ התוכנית בוצעה: 2 מתוך 2 שלבים/);
  assert.equal(lines[1], "✅ התמונה הועלתה לספריית המדיה (logo.png)");
  assert.equal(lines[2], "✅ הלוגו הוגדר");
  assert.equal(
    done.view,
    logoPlan.review.token,
    "upload + logo -> the site's home page can be opened",
  );
  // Media-only plan: the button opens the media item (main resolves it from the verified upload record).
  const mediaPlan = await prepare(f.agent, "wp_prepare_build_plan", {
    title: "תמונה",
    steps: [
      {
        key: "pic",
        tool: "wp_prepare_upload_image",
        args: {
          url: "https://images.example/pic.png",
          fileName: "pic.png",
          alt: "x",
        },
      },
    ],
  });
  const media = await f.agent.decide("p", mediaPlan.review.token, true);
  assert.equal(
    media.text.split("\n")[1],
    "✅ התמונה הועלתה לספריית המדיה (pic.png)",
  );
  assert.ok(media.view);
  // A single upload says it plainly too.
  const single = await prepare(f.agent, "wp_prepare_upload_image", {
    url: "https://images.example/one.png",
    fileName: "one.png",
    alt: "x",
  });
  const one = await f.agent.decide("p", single.review.token, true);
  assert.match(
    one.text,
    /^✅ התמונה הועלתה לספריית המדיה \(one\.png\) — אומת באתר/,
  );
  assert.ok(one.view);
  // Undoing creates nothing to open: no button.
  const row = f.agent
    .getActivityLog("p")
    .find((e) => e.action === "upload" && e.title === "one.png");
  const undo = await f.agent.prepareUndo("p", row.id);
  const undone = await f.agent.decide("p", undo.token, true);
  assert.equal(undone.view, undefined);
});

test("an ambiguous settings write is read back once: applied -> verified, unchanged -> not applied (never blocked), no second POST", async (t) => {
  const landed = await fixture(t);
  const pending = await prepare(landed.agent, "wp_prepare_site_identity", {
    blogname: "שם חדש",
  });
  landed.state.fail = (call) => {
    if (call.resource === "settings" && call.method === "POST") {
      landed.state.settings.title = "שם חדש"; // the server applied it, but the response was lost
      return true;
    }
    return false;
  };
  const done = await landed.agent.decide("p", pending.review.token, true);
  assert.equal(done.outcome, "verified");
  assert.equal(writes(landed).length, 1);
  assert.equal(landed.agent.isBlocked("p"), false);

  const lost = await fixture(t);
  const second = await prepare(lost.agent, "wp_prepare_site_identity", {
    blogname: "שם אחר",
  });
  lost.state.fail = (call) =>
    call.resource === "settings" && call.method === "POST"; // nothing applied
  const result = await lost.agent.decide("p", second.review.token, true);
  assert.equal(result.outcome, "denied");
  assert.match(result.text, /לא הוחל/);
  assert.equal(writes(lost).length, 1, "never a second POST");
  assert.equal(lost.agent.isBlocked("p"), false);
});

test("template parts verify when the site returns CRLF, NFD and a trailing newline", async (t) => {
  const f = await fixture(t, { block: true, ref: true });
  const content =
    "<!-- wp:paragraph --><p>café שלום</p><!-- /wp:paragraph -->\n<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->";
  const pending = await prepare(f.agent, "wp_prepare_header", { content });
  const original = f.wp.request;
  f.wp.request = async (url, options) => {
    const out = await original(url, options);
    if (
      options.method === "POST" &&
      url.searchParams.get("rest_route")?.startsWith("/wp/v2/template-parts")
    )
      f.state.header.content.raw =
        f.state.header.content.raw.replace(/\n/g, "\r\n").normalize("NFD") +
        "\r\n";
    return out;
  };
  const done = await f.agent.decide("p", pending.review.token, true);
  assert.equal(done.outcome, "verified");
  assert.equal(f.agent.isBlocked("p"), false);
});
