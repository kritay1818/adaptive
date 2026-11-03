"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createUpdater, CHECK_EVERY_MS } = require("../src/updater.cjs");

const root = path.join(__dirname, "..");
function fake(check) {
  const u = new EventEmitter();
  u.quit = [];
  u.checkForUpdates = async () => check(u);
  u.quitAndInstall = (...args) => u.quit.push(args);
  return u;
}
function make(over = {}, check = async () => {}) {
  const autoUpdater = over.autoUpdater || fake(check);
  const logs = [],
    changes = [];
  const timers = [];
  const state = { busy: false, prepared: 0 };
  const updater = createUpdater({
    autoUpdater,
    currentVersion: "0.1.2",
    enabled: true,
    isBusy: () => state.busy,
    prepareInstall: () => state.prepared++,
    onChange: () => changes.push(1),
    log: (type, data) => logs.push({ type, data }),
    setTimer: (fn, ms) => (
      timers.push({ fn, ms, kind: "once" }),
      timers.at(-1)
    ),
    setRepeat: (fn, ms) => (
      timers.push({ fn, ms, kind: "every" }),
      timers.at(-1)
    ),
    clear: () => {},
    ...over,
  });
  return { updater, autoUpdater, logs, changes, timers, state };
}

test("configures electron-updater: background download, install on quit, no downgrade or prerelease", () => {
  const { autoUpdater } = make();
  assert.equal(autoUpdater.autoDownload, true);
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);
  assert.equal(autoUpdater.allowDowngrade, false);
  assert.equal(autoUpdater.allowPrerelease, false);
});

test("checks shortly after start and then every 6 hours", async () => {
  let checks = 0;
  const { updater, timers } = make({}, async () => void checks++);
  updater.start();
  updater.start();
  assert.equal(timers.length, 2, "start is idempotent");
  assert.equal(timers[1].kind, "every");
  assert.equal(timers[1].ms, 6 * 60 * 60 * 1000);
  assert.equal(CHECK_EVERY_MS, 6 * 60 * 60 * 1000);
  await timers[0].fn();
  assert.equal(checks, 1);
});

test("downloaded update: ready notice, restart only on a click, 'later' leaves install to the next quit", async () => {
  const { updater, autoUpdater, changes } = make({}, async (u) => {
    u.emit("update-available", { version: "0.2.0" });
    u.emit("update-downloaded", { version: "0.2.0" });
  });
  await updater.check();
  assert.equal(updater.state().ready, true);
  assert.equal(updater.state().readyVersion, "0.2.0");
  assert.ok(changes.length >= 1, "windows are told");
  assert.equal(autoUpdater.quit.length, 0, "never restarts on its own");
  assert.equal(autoUpdater.autoInstallOnAppQuit, true, "'later' = next quit");
  assert.deepEqual(updater.install(), { ok: true });
  assert.deepEqual(autoUpdater.quit, [[true, true]]);
});

test("never restarts, and never shows the question, while a task or approval is in progress", async () => {
  const { updater, autoUpdater, state } = make({}, async (u) =>
    u.emit("update-downloaded", { version: "0.2.0" }),
  );
  await updater.check();
  state.busy = true;
  assert.equal(updater.state().ready, false);
  const r = updater.install();
  assert.equal(r.ok, false);
  assert.match(r.message, /משימה|אישור/);
  assert.equal(autoUpdater.quit.length, 0);
  state.busy = false;
  assert.equal(updater.state().ready, true);
  assert.equal(updater.install().ok, true);
  assert.equal(state.prepared, 1);
});

test("manual check says 'יש לך את הגרסה האחרונה' when nothing is new", async () => {
  const { updater } = make({}, async (u) => u.emit("update-not-available", {}));
  const r = await updater.checkNow();
  assert.equal(r.status, "latest");
  assert.equal(r.message, "יש לך את הגרסה האחרונה");
});

test("manual check with a new version reports downloading, then ready", async () => {
  const { updater, autoUpdater } = make({}, async (u) =>
    u.emit("update-available", { version: "0.2.0" }),
  );
  assert.equal((await updater.checkNow()).status, "downloading");
  autoUpdater.emit("update-downloaded", { version: "0.2.0" });
  assert.equal((await updater.checkNow()).status, "ready");
});

test("failures are silent: logged, technical text only, the app is never blocked", async () => {
  const { updater, logs } = make({}, async () => {
    throw new Error("getaddrinfo ENOTFOUND github.com");
  });
  await updater.check(); // background: does not throw
  assert.ok(logs.some((l) => l.type === "update-error"));
  assert.equal(updater.state().ready, false);
  const r = await updater.checkNow();
  assert.equal(r.status, "error");
  assert.ok(
    !r.message.includes("ENOTFOUND"),
    "the friendly line has no jargon",
  );
  assert.match(r.tech, /ENOTFOUND/);
  // An 'error' event (for example a failed download) is also swallowed.
  const quiet = make();
  quiet.autoUpdater.emit("error", new Error("HTTP 503"));
  assert.equal(quiet.updater.state().ready, false);
});

test("dev runs and the portable exe never check or touch electron-updater", async () => {
  let called = false;
  const dev = make({ enabled: false }, async () => void (called = true));
  dev.updater.start();
  await dev.updater.check();
  assert.equal(called, false);
  assert.equal(dev.timers.length, 0);
  assert.equal((await dev.updater.checkNow()).status, "dev");
  const portable = make({ portable: true }, async () => void (called = true));
  portable.updater.start();
  assert.equal(called, false);
  assert.equal((await portable.updater.checkNow()).status, "portable");
  assert.equal(portable.updater.state().enabled, false);
});

test("a missing electron-updater module degrades to no updates instead of a crash", async () => {
  const { updater } = make({ autoUpdater: null });
  updater.start();
  await updater.check();
  assert.equal(updater.state().ready, false);
  assert.equal(updater.install().ok, false);
});

test("packaging: GitHub provider for the public repo, no token anywhere", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  assert.ok(pkg.dependencies["electron-updater"]);
  assert.deepEqual(
    pkg.build.publish.map((p) => [p.provider, p.owner, p.repo]),
    [["github", "kritay1818", "adaptive"]],
  );
  for (const file of ["src/updater.cjs", "src/main.cjs", "package.json"]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(!/GH_TOKEN|GITHUB_TOKEN|ghp_|github_pat_/.test(text), file);
  }
});

test("release workflow: v* tag, normal release, installer + portable + latest.yml + blockmap, built-in token", () => {
  const yml = fs.readFileSync(
    path.join(root, ".github/workflows/release-windows.yml"),
    "utf8",
  );
  assert.match(yml, /tags:\s*\["v\*"\]/);
  assert.match(yml, /draft:\s*false/);
  assert.doesNotMatch(yml, /draft:\s*true/);
  for (const f of [
    "ADActive-Setup-*.exe",
    "ADActive-Setup-*.exe.blockmap",
    "ADActive-*-portable.exe",
    "latest.yml",
  ])
    assert.ok(yml.includes("dist/" + f), f);
  assert.match(yml, /GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  assert.match(yml, /contents:\s*write/);
  assert.match(yml, /CODE SIGNING/);
});

test("the chat window shows the version, 'בדיקת עדכונים' and the Hebrew restart question", () => {
  const html = fs.readFileSync(path.join(root, "src/ui/history.html"), "utf8");
  assert.match(html, /id="app-version"/);
  assert.match(html, /בדיקת עדכונים/);
  assert.match(html, /הפעלה מחדש עכשיו/);
  assert.match(html, /אחר כך/);
  const js = fs.readFileSync(path.join(root, "src/ui/renderer.js"), "utf8");
  assert.ok(js.includes("גרסה חדשה מוכנה — להפעיל מחדש?"));
});
