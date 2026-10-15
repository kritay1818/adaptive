"use strict";
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const root = path.join(__dirname, "..");
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "model-window-"));
  const app = await electron.launch({
    args: [".", `--adactive-data=${dir}`],
    cwd: root,
  });
  try {
    await app.firstWindow();
    await app.evaluate(async ({ app }) => {
      await app.whenReady();
    });
    for (let i = 0; i < 60; i++) {
      if (
        await app.evaluate(
          () =>
            !!process.mainModule.require(process.cwd() + "/src/main.cjs")
              .trayMenu,
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const route = await app.evaluate(() =>
      process.mainModule
        .require(process.cwd() + "/src/main.cjs")
        .trayMenu.items.some((i) => i.label === "חיבור מודל"),
    );
    assert.ok(route, "tray must expose dedicated model connection");
    const open = () =>
      app.evaluate(() =>
        process.mainModule
          .require(process.cwd() + "/src/main.cjs")
          .trayMenu.items.find((i) => i.label === "חיבור מודל")
          .click(),
      );
    await open();
    let page;
    for (let i = 0; i < 100; i++) {
      page = app.windows().find((p) => p.url().endsWith("model.html"));
      if (page) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(page, "native model window loaded");
    await page.waitForSelector("#provider option", { state: "attached" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    assert.equal(await page.locator("#provider").inputValue(), "gemini");
    assert.equal(await page.locator("#provider option").count(), 5);
    assert.equal(
      await page.locator("#api-key").getAttribute("type"),
      "password",
    );
    assert.equal(await page.locator("#api-key").inputValue(), "");
    for (const method of [
      "state",
      "create",
      "save",
      "send",
      "testWordPress",
      "wordPressState",
      "connectWordPress",
      "selectModel",
      "disconnect",
    ]) {
      assert.match(
        await page.evaluate(
          (method) => window.adactive[method]({}).catch((e) => e.message),
          method,
        ),
        /Access denied/,
        method,
      );
    }
    const before = await page.evaluate(() => window.adactive.modelState());
    assert.equal(before.connected, false);
    await page.screenshot({ path: "artifacts/model-native-empty.png" });
    // Transport fixtures only. Never contact Google or any provider.
    await app.evaluate((_, root) => {
      global.modelRequests = [];
      const proto = process.mainModule.require(root + "/src/provider.cjs")
        .Provider.prototype;
      proto.transport = async function (a, key, url, body) {
        global.modelRequests.push({ provider: a.id, generation: !!body });
        if (body)
          return { candidates: [{ content: { parts: [{ text: "OK" }] } }] };
        return {
          models: [
            {
              name: "models/gemini-fixture",
              displayName: "MOCK Gemini",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        };
      };
    }, root);
    await page.locator("#api-key").fill("public-dummy-new-key");
    await page.waitForTimeout(350);
    assert.equal(await app.evaluate(() => global.modelRequests.length), 0);
    await page.waitForFunction(
      () => document.querySelector("#model").options.length === 1,
    );
    assert.equal(await page.locator("#api-key").inputValue(), "");
    assert.equal(
      await page.evaluate(() =>
        window.adactive.modelState().then((s) => s.connected),
      ),
      false,
    );
    await page.locator("#api-key").press("Enter");
    assert.equal(
      await app.evaluate(
        () => global.modelRequests.filter((r) => r.generation).length,
      ),
      0,
    );
    await page.locator("#model-search").fill("absent");
    assert.equal(await page.locator("#model option").count(), 0);
    await page.locator("#model-search").fill("MOCK");
    await page.locator("#model").selectOption("gemini-fixture");
    await page.locator("#connect-model").click();
    await page.waitForFunction(() =>
      document.querySelector("#result").textContent.includes("מחובר"),
    );
    assert.equal(
      await app.evaluate(
        () => global.modelRequests.filter((r) => r.generation).length,
      ),
      1,
    );
    const saved = JSON.parse(
      fs.readFileSync(path.join(dir, "connection.json"), "utf8"),
    );
    assert.equal(saved.active.slot, "gemini");
    assert.ok(!JSON.stringify(saved).includes("public-dummy"));
    await page.evaluate(() => {
      document.querySelector("#result").textContent +=
        " · MOCK בלבד — ללא חיבור Google אמיתי";
    });
    await page.screenshot({
      path: "artifacts/model-native-connected-MOCK.png",
    });
    await page.locator("#api-key").fill("public-close-before-debounce");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith("model.html"))
        .close(),
    );
    await page.waitForFunction(
      () => document.querySelector("#api-key").value === "",
    );
    await page.waitForTimeout(950);
    assert.equal(await app.evaluate(() => global.modelRequests.length), 2);
    await open();
    assert.equal(await page.locator("#api-key").inputValue(), "");
    assert.equal(await page.locator("#provider").inputValue(), "gemini");
    await page.locator("#api-key").fill("public-provider-switch");
    await page.locator("#provider").selectOption("qwen");
    assert.equal(await page.locator("#api-key").inputValue(), "");
    assert.equal(await page.locator("#region").inputValue(), "singapore");
    await page.waitForTimeout(950);
    assert.equal(await app.evaluate(() => global.modelRequests.length), 2);
    await page.locator("#provider").selectOption("gemini");
    // Delayed transport exercises actual main cancellation, not only renderer epochs.
    await app.evaluate((_, root) => {
      const proto = process.mainModule.require(root + "/src/provider.cjs")
        .Provider.prototype;
      const original = proto.transport;
      proto.transport = async function (...args) {
        await new Promise((resolve) => {
          global.releaseModelDiscovery = resolve;
        });
        return original.apply(this, args);
      };
    }, root);
    await page.locator("#api-key").fill("public-delayed-fixture");
    await page.waitForFunction(
      () =>
        document.querySelector("#picker").getAttribute("aria-busy") === "true",
    );
    await page.keyboard.press("Escape");
    await app.evaluate(() => global.releaseModelDiscovery());
    await page.waitForTimeout(200);
    assert.equal(await page.locator("#model option").count(), 0);
    assert.equal(await page.locator("#api-key").inputValue(), "");
    assert.equal(
      await page.evaluate(() =>
        window.adactive.modelState().then((s) => s.model),
      ),
      "gemini-fixture",
    );
    const wpCreated = app.waitForEvent("window");
    await app.evaluate(() =>
      process.mainModule
        .require(process.cwd() + "/src/main.cjs")
        .trayMenu.items.find((i) => i.label === "חיבור WordPress")
        .click(),
    );
    const wp = await wpCreated;
    await wp.waitForSelector("#wp-password");
    assert.equal(await wp.locator("input").count(), 3);
    assert.equal(await wp.locator("#api-key").count(), 0);
    assert.match(
      await wp.evaluate(() =>
        window.adactive.modelState().catch((e) => e.message),
      ),
      /Access denied/,
    );
    const pet = app.windows().find((p) => p.url().endsWith("pet.html"));
    assert.match(
      await pet.evaluate(() =>
        window.adactive.modelState().catch((e) => e.message),
      ),
      /Access denied/,
    );
    assert.ok(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((w) => {
          const p = w.webContents.getLastWebPreferences();
          return p.sandbox && p.contextIsolation && !p.nodeIntegration;
        }),
      ),
    );
    assert.deepEqual(
      await page.evaluate(() => [localStorage.length, sessionStorage.length]),
      [0, 0],
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS dedicated native tray model dialog: Gemini default; 5 providers; narrow IPC; 800ms discovery; masked clear; search; explicit-only MOCK validation; encrypted persistence; native close/reset; sandbox. NO live provider requests.",
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
