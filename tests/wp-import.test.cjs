"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Agent, argumentsFor } = require("../src/wp-agent.cjs");
const { WordPress } = require("../src/wordpress.cjs");
const { SiteImporter } = require("../src/wp-import.cjs");
const { createImportReader, publicGet } = require("../src/wp-import-browser.cjs");
const storage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
const signal = () => new AbortController().signal;
const rendered = (url, links = []) => ({ url, title: "Source", sections: [{ tag: "h1", text: "Original heading" }], images: [{ url: "https://cdn.example/hero.png", alt: "Hero" }], links, truncated: false });
const draft = { key: "home", tool: "wp_prepare_create_page", args: { title: "Imported home", content: '<!-- wp:heading --><h2>Original heading</h2><!-- /wp:heading -->' } };
const menuStep = (ids) => ({ key: "menu", tool: "wp_prepare_menu", args: { title: "Imported", links: ids.map((pageId, i) => ({ pageId, label: `Page ${i + 1}` })) } });
const site = (count) => async (url) => rendered(url, url === "https://source.example/" ? Array.from({ length: count }, (_, i) => ({ url: `https://source.example/p${i + 1}`, label: `P${i + 1}`, navigation: true })) : []);
async function importPass(agent, args, steps = [draft]) {
  const read = await agent.importer.read("p", args, signal());
  const prepared = await agent.importer.prepare("p", { sourceToken: read.sourceToken, title: "Imported site", steps: typeof steps === "function" ? steps(read) : steps }, signal());
  return { read, prepared };
}
async function fixture(t, reader = async (url) => rendered(url)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-import-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [], pages = new Map(); let next = 10;
  const wp = new WordPress(dir, storage, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (url, options) => {
      calls.push({ url, options });
      const route = url.searchParams.get("rest_route");
      let body;
      if (route.endsWith("users/me")) body = { id: 1 };
      else if (options.method === "POST") {
        const payload = JSON.parse(options.body), id = Number(route.split("/").pop()) || next++;
        const before = pages.get(id);
        body = { id, title: { raw: payload.title ?? before?.title.raw }, content: { raw: payload.content ?? before?.content.raw }, status: payload.status || before?.status, modified: "now" };
        pages.set(id, body);
      } else body = pages.get(Number(route.split("/").pop()));
      return { status: 200, body: JSON.stringify(body), contentType: "application/json" };
    },
  });
  await wp.connect("p", { site: "https://destination.example", username: "test", password: "PUBLIC-DUMMY" });
  const agent = new Agent(wp, dir, { importReader: reader });
  return { agent, wp, calls, pages };
}

test("import reads bounded same-origin rendered pages, prioritizes navigation and reports unread pages", async () => {
  const reads = [];
  const importer = new SiteImporter({ fingerprint: () => "connection", now: () => 0 }, async (url) => {
    reads.push(url);
    return rendered(url, url.endsWith("/home") ? [
      { url: "https://source.example/article", label: "Article" },
      { url: "https://source.example/about", label: "About", navigation: true },
      { url: "https://outside.example/page", label: "External", navigation: true },
    ] : []);
  });
  const data = await importer.read("p", { url: "https://source.example/home", maxPages: 2 }, signal());
  assert.deepEqual(reads, ["https://source.example/home", "https://source.example/about"]);
  assert.equal(data.untrusted, true);
  assert.equal(data.truncated, true);
  assert.deepEqual(data.unread, ["https://source.example/article"]);
});

test("import is draft-only, binds source to project/connection, and cannot upload undiscovered images", async (t) => {
  const { agent, calls } = await fixture(t);
  agent.structure.menuSnapshot = async () => ({ theme: { block: false } });
  const read = await agent.importer.read("p", { url: "https://source.example/home" }, signal());
  assert.equal(read.menuRequired, true);
  assert.deepEqual(read.previousImportedPages, []);
  const base = { sourceToken: read.sourceToken, title: "Imported site", steps: [draft, menuStep(["{{home.id}}"])] };
  for (const tool of ["wp_prepare_publish_page", "wp_prepare_front_page", "wp_prepare_site_identity", "wp_prepare_update_page"]) {
    assert.throws(() => argumentsFor("wp_prepare_site_import", { ...base, steps: [draft, { key: "unsafe", tool, args: {} }] }));
  }
  const about = { ...draft, key: "about", args: { ...draft.args, title: "Imported about" } };
  for (const steps of [[draft], [draft, menuStep(["{{home.id}}", "{{home.id}}"])], [draft, about, menuStep(["{{home.id}}"])], [draft, menuStep(["{{home.id}}", 5])]]) {
    await assert.rejects(agent.importer.prepare("p", { ...base, steps }, signal()), /תפריט/);
  }
  const prepared = await agent.importer.prepare("p", base, signal());
  assert.equal(prepared.review.steps.at(-1).label, "הגדרת התפריט הראשי");
  await assert.rejects(agent.importer.prepare("other", base, signal()));
  await assert.rejects(agent.importer.prepare("p", { ...base, steps: [{ key: "image", tool: "wp_prepare_upload_image", args: { url: "https://other.example/image.png", fileName: "image.png", alt: "" } }, ...base.steps] }, signal()));
  assert.equal(calls.filter((c) => c.options.method === "POST").length, 0);
  agent.importer.sources.get("p").fingerprint = "different connection";
  await assert.rejects(agent.importer.prepare("p", base, signal()));
});

test("draft import reuses approval, zero-write rejection, verification, logging and reverse-plan undo", async (t) => {
  const { agent, calls, pages } = await fixture(t, site(1));
  const source = await agent.importer.read("p", { url: "https://source.example/", maxPages: 1 }, signal());
  const args = { sourceToken: source.sourceToken, title: "Imported site", steps: [draft] };
  const rejected = await agent.importer.prepare("p", args, signal());
  await agent.decide("p", rejected.review.token, false);
  assert.equal(calls.filter((c) => c.options.method === "POST").length, 0);
  const proposed = await agent.importer.prepare("p", args, signal());
  assert.match(proposed.review.warning, /טיוטות בלבד/);
  proposed.review.steps[0].payload.content = "tampered renderer preview";
  await agent.decide("p", proposed.review.token, true);
  assert.equal([...pages.values()][0].status, "draft");
  assert.equal([...pages.values()][0].content.raw, draft.args.content);
  assert.equal(agent.getActivityLog("p")[0].state, "verified");
  const undo = await agent.plans.prepareUndo("p", proposed.review.token);
  await agent.decide("p", undo.token, true);
  assert.equal([...pages.values()][0].status, "trash");
  assert.equal(agent.getActivityLog("p").find((r) => r.action === "create").state, "restored");
  await assert.rejects(agent.decide("p", proposed.review.token, true));
});

test("an import read cannot be followed by an unrestricted write preparation in the same agent run", async (t) => {
  const { agent, calls } = await fixture(t); let turn = 0;
  const provider = { step: async () => ({ calls: [++turn === 1
    ? { id: "read", name: "wp_read_import_site", args: { url: "https://source.example/home", maxPages: 1 } }
    : { id: "write", name: "wp_prepare_create_page", args: draft.args }] }) };
  await assert.rejects(agent.run("p", [], provider), /ייבוא/);
  assert.equal(calls.filter((c) => c.options.method === "POST").length, 0);
});

test("multi-pass import offers the next pass, resumes without re-reading, and the final menu links every imported page", async (t) => {
  const reads = [];
  const { agent } = await fixture(t, async (url) => { reads.push(url); return site(7)(url); });
  agent.structure.menuSnapshot = async () => ({ theme: { block: false } });
  const first = await importPass(agent, { url: "https://source.example/", maxPages: 5 });
  assert.equal(first.read.remainingCount, 3);
  assert.match(first.prepared.text, /נמצאו עוד 3 עמודים — להמשיך לסבב הבא\?/);
  await agent.decide("p", first.prepared.review.token, true);
  const created = agent.getActivityLog("p").find((e) => e.action === "create").pageId;
  const second = await agent.importer.read("p", { continue: true, maxPages: 5 }, signal());
  assert.deepEqual(reads.slice(5), ["https://source.example/p5", "https://source.example/p6", "https://source.example/p7"]);
  assert.equal(second.continuePrompt, null);
  assert.equal(second.menuRequired, true);
  assert.deepEqual(second.previousImportedPages.map((p) => p.id), [created]);
  const base = { sourceToken: second.sourceToken, title: "Imported site, pass 2" };
  await assert.rejects(agent.importer.prepare("p", { ...base, steps: [draft] }, signal()), /תפריט/);
  await assert.rejects(agent.importer.prepare("p", { ...base, steps: [draft, menuStep(["{{home.id}}"])] }, signal()), /כל העמודים/);
  const final = await agent.importer.prepare("p", { ...base, steps: [draft, menuStep([created, "{{home.id}}"])] }, signal());
  assert.equal(final.review.steps.at(-1).label, "הגדרת התפריט הראשי");
  assert.match(final.review.warning, /סבב 2/);
});

test("a pass whose plan was not approved is read again on continue", async (t) => {
  const reads = [];
  const { agent } = await fixture(t, async (url) => { reads.push(url); return site(4)(url); });
  await importPass(agent, { url: "https://source.example/", maxPages: 2 });
  await agent.importer.read("p", { continue: true, maxPages: 2 }, signal());
  assert.deepEqual(reads, ["https://source.example/", "https://source.example/p1", "https://source.example/", "https://source.example/p1"]);
});

test("multi-pass import stops at 20 pages and lists the extra discovered pages as not imported", async (t) => {
  const { agent } = await fixture(t, site(25));
  agent.structure.menuSnapshot = async () => ({ theme: { block: false } });
  let pass = await importPass(agent, { url: "https://source.example/", maxPages: 5 });
  assert.match(pass.prepared.text, /נמצאו עוד 21 עמודים; במגבלת 20 העמודים אפשר לייבא עוד 15 מהם/);
  for (let i = 0; i < 2; i++) {
    await agent.decide("p", pass.prepared.review.token, true);
    pass = await importPass(agent, { continue: true, maxPages: 5 });
  }
  await agent.decide("p", pass.prepared.review.token, true);
  pass = await importPass(agent, { continue: true, maxPages: 5 }, (read) => [draft, menuStep([...read.previousImportedPages.map((p) => p.id), "{{home.id}}"])]);
  assert.equal(pass.read.pages.length, 5);
  assert.equal(pass.read.previousImportedPages.length, 3);
  assert.equal(pass.read.notImportedCount, 6);
  assert.match(pass.prepared.text, /20 עמודים לייבוא\. עמודים שנמצאו ולא יובאו \(6\)/);
  assert.match(pass.prepared.text, /source\.example\/p25/);
});

test("import transport refuses private DNS, HTTP and credential URLs before HTTP dispatch", async (t) => {
  const { wp } = await fixture(t);
  wp.lookup = async () => [{ address: "127.0.0.1", family: 4 }];
  for (const url of ["https://private.example", "http://public.example", "https://user:pass@public.example", "https://127.0.0.1"]) {
    await assert.rejects(publicGet(wp, url, signal(), { requests: 0, bytes: 0 }));
  }
});

test("rendered reader uses a separate sandbox without preload or IPC and cleans up", async () => {
  let options, beforeRequest, handler, destroyed = false, cleared = false, proxy;
  const isolated = { setProxy: async (v) => { proxy = v; }, setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {},
    webRequest: { onBeforeRequest: (fn) => { beforeRequest = fn; } },
    protocol: { handle: async (_scheme, fn) => { handler = fn; }, unhandle() {} },
    closeAllConnections: async () => {}, clearStorageData: async () => { cleared = true; } };
  class Window {
    constructor(value) { options = value; this.webContents = {
      setWebRTCIPHandlingPolicy: (v) => assert.equal(v, "disable_non_proxied_udp"),
      setWindowOpenHandler: (fn) => assert.equal(fn().action, "deny"), on() {},
      executeJavaScriptInIsolatedWorld: async (_world, scripts) => scripts[0].code.includes("extractRenderedPage") ? rendered("https://source.example/home") : undefined,
    }; }
    isDestroyed() { return destroyed; } destroy() { destroyed = true; } async loadURL() {}
  }
  const reader = createImportReader({ BrowserWindow: Window, session: { fromPartition: (partition) => { assert.ok(!partition.startsWith("persist:")); return isolated; } } }, {});
  await reader("https://source.example/home", signal());
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.preload, undefined);
  assert.equal(proxy.proxyBypassRules, "<-loopback>");
  for (const url of ["file:///etc/passwd", "http://localhost", "ws://public.example"]) beforeRequest({ url, resourceType: "xhr" }, ({ cancel }) => assert.equal(cancel, true));
  assert.equal((await handler({ method: "POST", url: "https://source.example" })).status, 502);
  assert.ok(destroyed && cleared);
});
