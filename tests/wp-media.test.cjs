"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { WordPress } = require("../src/wordpress.cjs");
const { Agent } = require("../src/wp-agent.cjs");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
const fields = { url: "https://images.example/hero.png", fileName: "hero.png", alt: "נוף ירוק" };
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
}; // Public test-only storage and injected transport: no real credentials/network.
const provider = (name, args) => ({ step: async () => ({ calls: [{ id: "call", name, args }] }) });
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-media-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const state = {
    deleted: false, bytes: png,
    item: { id: 42, status: "inherit", title: { raw: fields.fileName },
      alt_text: fields.alt, media_type: "image", mime_type: "image/png",
      source_url: "https://public.example/wp-content/uploads/hero.png", modified: "2026-10-13T10:00:00" },
  };
  const wp = new WordPress(dir, storage, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (url, options) => {
      calls.push({ url, options });
      if (options.binary) return { status: 200, contentType: "image/png", body: state.bytes };
      const route = url.searchParams.get("rest_route");
      let body, status = 200;
      if (route === "/wp/v2/users/me") body = { id: 7 };
      else if (route === "/wp/v2/media" && options.method === "POST") {
        status = 201; body = state.item;
      } else if (route === "/wp/v2/media/42" && options.method === "DELETE") {
        state.deleted = true; body = { deleted: true, previous: { id: 42 } };
      } else if (route === "/wp/v2/media/42") {
        if (state.readError) return state.readError;
        if (state.deleted) { status = 404; body = { code: "rest_post_invalid_id", data: { status: 404 } }; }
        else body = { ...state.item, alt_text: state.readAlt ?? state.item.alt_text };
      } else if (route === "/wp/v2/pages" && options.method === "POST") {
        const payload = JSON.parse(options.body);
        state.page = { id: 91, status: payload.status, title: { raw: payload.title }, content: { raw: payload.content } };
        status = 201; body = state.page;
      } else if (route === "/wp/v2/pages/91") body = state.page;
      else throw new Error("Unexpected fixture request");
      return { status, contentType: "application/json", body: JSON.stringify(body) };
    },
  });
  await wp.connect("p", { site: "https://public.example", username: "fixture", password: "PUBLIC-DUMMY" });
  return { wp, dir, agent: new Agent(wp, dir), state, calls };
}
const prepare = (agent) => agent.run("p", [{ role: "user", content: "Upload image" }], provider("wp_prepare_upload_image", fields));
const writes = (calls) => calls.filter((c) => ["POST", "DELETE"].includes(c.options.method));

test("image review binds bytes and metadata; deny writes nothing; approve posts once and verifies", async (t) => {
  const { agent, wp, dir, calls } = await fixture(t);
  const first = await prepare(agent);
  assert.equal(first.review.kind, "upload");
  assert.equal(first.review.payload.url, fields.url);
  assert.equal(first.review.payload.fileName, fields.fileName);
  assert.equal(first.review.payload.alt, fields.alt);
  assert.equal(first.review.image, undefined);
  assert.equal(writes(calls).length, 0);
  const imageGet = calls.find((c) => c.options.binary);
  assert.equal(imageGet.options.authorization, undefined);
  assert.equal(imageGet.options.address, "93.184.216.34");
  assert.equal(imageGet.options.maxBytes, 10 * 1024 * 1024);
  await agent.decide("p", first.review.token, false);
  assert.equal(writes(calls).length, 0);
  const second = await prepare(agent);
  // Returned review objects are copies, not the main-owned upload.
  second.review.payload.url = "https://other.example/evil.png";
  second.review.payload.alt = "modified renderer text";
  const result = await agent.decide("p", second.review.token, true);
  assert.equal(result.media.id, 42);
  assert.equal(result.media.alt, fields.alt);
  assert.equal(writes(calls).length, 1);
  const upload = writes(calls)[0];
  assert.equal(upload.url.searchParams.get("rest_route"), "/wp/v2/media");
  assert.match(upload.options.contentType, /^multipart\/form-data; boundary=ADActive/);
  assert.ok(Buffer.isBuffer(upload.options.body));
  assert.ok(upload.options.body.includes(png));
  assert.ok(upload.options.body.includes(Buffer.from(fields.alt)));
  assert.ok(upload.options.body.includes(Buffer.from('filename="hero.png"')));
  assert.ok(!upload.options.body.includes(Buffer.from("modified renderer text")));
  assert.ok(calls.some((c) => c.options.binary && c.url.href === result.media.source));
  await assert.rejects(agent.decide("p", second.review.token, true));
  assert.equal(writes(calls).length, 1);
  const restarted = new Agent(wp, dir);
  const row = restarted.getActivityLog("p")[0];
  assert.equal(row.action, "upload");
  assert.equal(row.state, "verified");
  assert.equal(row.canUndo, true);
  assert.equal(row.createdByApp, true);
  assert.equal(restarted.getActivityLog("other").length, 0);
  assert.ok(!fs.readFileSync(restarted.logFile("p"), "utf8").includes("PUBLIC-DUMMY"));
});

test("uploaded media can be combined into a designed draft through a second independent review", async (t) => {
  const { agent, calls } = await fixture(t);
  const upload = await prepare(agent);
  const result = await agent.decide("p", upload.review.token, true);
  const content = `<!-- wp:columns --><div class="wp-block-columns"><!-- wp:column --><div class="wp-block-column"><!-- wp:image {"id":${result.media.id}} --><figure class="wp-block-image"><img src="${result.media.source}" alt="נוף ירוק" class="wp-image-42" /></figure><!-- /wp:image --></div><!-- /wp:column --><!-- wp:column --><div class="wp-block-column"><!-- wp:heading --><h2 class="wp-block-heading">עיצוב</h2><!-- /wp:heading --></div><!-- /wp:column --></div><!-- /wp:columns -->`;
  const draft = await agent.run("p", [], provider("wp_prepare_create_page", { title: "עמוד מעוצב", content }));
  assert.equal(writes(calls).length, 1);
  assert.equal(draft.review.status, "draft");
  const page = await agent.decide("p", draft.review.token, true);
  assert.equal(page.page.content, content);
  assert.equal(page.page.status, "draft");
  assert.equal(writes(calls).length, 2);
});

test("upload undo verifies app ownership and requires a fresh review before permanent deletion", async (t) => {
  const { agent, calls, state } = await fixture(t);
  const pending = await prepare(agent);
  await agent.decide("p", pending.review.token, true);
  const original = agent.getActivityLog("p")[0];
  await assert.rejects(agent.prepareUndo("other", original.id));
  await assert.rejects(agent.prepareUndo("p", "arbitrary-media-id"));
  const denied = await agent.prepareUndo("p", original.id);
  assert.equal(denied.kind, "delete-media");
  assert.match(denied.warning, /לצמיתות/);
  assert.equal(writes(calls).length, 1);
  await agent.decide("p", denied.token, false);
  assert.equal(state.deleted, false);
  const undo = await agent.prepareUndo("p", original.id);
  await agent.decide("p", undo.token, true);
  assert.equal(writes(calls).length, 2);
  assert.equal(writes(calls)[1].options.method, "DELETE");
  assert.equal(writes(calls)[1].url.searchParams.get("force"), "true");
  assert.equal(calls.at(-1).options.method, "GET");
  assert.equal(agent.getActivityLog("p").find((e) => e.id === original.id).state, "restored");
  await assert.rejects(agent.prepareUndo("p", original.id));
  await assert.rejects(agent.decide("p", undo.token, true));
  assert.equal(writes(calls).length, 2);
});

test("changed media between undo review and approval is never deleted", async (t) => {
  const { agent, calls, state } = await fixture(t);
  const upload = await prepare(agent);
  await agent.decide("p", upload.review.token, true);
  const row = agent.getActivityLog("p")[0];
  const undo = await agent.prepareUndo("p", row.id);
  state.item.alt_text = "Someone edited this";
  await assert.rejects(agent.decide("p", undo.token, true));
  assert.equal(writes(calls).length, 1);
  assert.equal(state.deleted, false);
  assert.equal(agent.isBlocked("p"), false);
});

test("unknown upload is logged, blocks just that project, and never retries", async (t) => {
  const { agent, calls, state } = await fixture(t);
  const pending = await prepare(agent);
  state.readAlt = "Server changed alt text";
  await assert.rejects(agent.decide("p", pending.review.token, true));
  assert.equal(writes(calls).length, 1);
  assert.equal(agent.isBlocked("p"), true);
  assert.equal(agent.isBlocked("other"), false);
  const row = agent.getActivityLog("p")[0];
  assert.equal(row.action, "upload");
  assert.equal(row.state, "unknown");
  assert.equal(row.canUndo, false);
  await assert.rejects(prepare(agent));
  assert.equal(writes(calls).length, 1);
});

test("changed uploaded bytes fail read-back even when metadata matches", async (t) => {
  const { agent, state, calls } = await fixture(t);
  const pending = await prepare(agent);
  state.bytes = Buffer.concat([png, Buffer.from([1])]);
  await assert.rejects(agent.decide("p", pending.review.token, true));
  assert.equal(agent.isBlocked("p"), true);
  assert.equal(writes(calls).length, 1);
});

test("failed/ambiguous deletion read-back is unknown, not a successful undo", async (t) => {
  const { agent, state } = await fixture(t);
  const upload = await prepare(agent);
  await agent.decide("p", upload.review.token, true);
  const row = agent.getActivityLog("p")[0];
  const undo = await agent.prepareUndo("p", row.id);
  // Fail only the post-delete GET; a generic 404/HTML page is not proof.
  Object.defineProperty(state, "readError", { get: () => state.deleted ? { status: 404, contentType: "text/html", body: "not found" } : undefined });
  await assert.rejects(agent.decide("p", undo.token, true));
  assert.equal(agent.isBlocked("p"), true);
  assert.equal(agent.getActivityLog("p").find((e) => e.id === row.id).state, "verified");
});

test("image download rejects private/mixed DNS, redirects, oversized bytes and MIME spoofing", async (t) => {
  const { wp, calls } = await fixture(t);
  for (const addresses of [
    [{ address: "127.0.0.1", family: 4 }],
    [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }],
    [{ address: "::1", family: 6 }],
  ]) {
    wp.lookup = async () => addresses;
    const count = calls.length;
    await assert.rejects(wp.downloadImage(fields.url));
    assert.equal(calls.length, count);
  }
  wp.lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  for (const response of [
    { status: 302, contentType: "image/png", body: png },
    { status: 200, contentType: "image/svg+xml", body: Buffer.from("<svg/>") },
    { status: 200, contentType: "image/png", body: Buffer.from("<svg onload='alert(1)'/>") },
    { status: 200, contentType: "text/html", body: png },
    { status: 200, contentType: "image/png", body: Buffer.alloc(10 * 1024 * 1024 + 1) },
  ]) {
    let requests = 0;
    wp.request = async (_url, options) => { requests++; assert.equal(options.authorization, undefined); return response; };
    await assert.rejects(wp.downloadImage(fields.url));
    assert.equal(requests, 1);
  }
});

test("image download abort covers DNS lookup, before any request", async (t) => {
  const { wp, calls } = await fixture(t);
  wp.lookup = () => new Promise(() => {});
  const controller = new AbortController();
  const count = calls.length;
  const pending = wp.downloadImage(fields.url, controller.signal);
  controller.abort();
  await assert.rejects(pending);
  assert.equal(calls.length, count);
});

test("only an authenticated WordPress missing-ID response proves media is gone", async (t) => {
  const { wp } = await fixture(t);
  for (const response of [
    { status: 200, body: "null" },
    { status: 200, body: "false" },
    { status: 200, body: "[]" },
    { status: 404, body: '{"code":"rest_no_route","data":{"status":404}}' },
    { status: 403, body: '{"code":"rest_forbidden","data":{"status":403}}' },
  ]) {
    wp.request = async () => ({ contentType: "application/json", ...response });
    await assert.rejects(wp.mediaItem("p", 42));
  }
  wp.request = async () => ({ status: 404, contentType: "application/json", body: '{"code":"rest_post_invalid_id","data":{"status":404}}' });
  assert.equal(await wp.mediaItem("p", 42), null);
});
