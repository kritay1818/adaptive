const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "tray-ui-"));
  let app;
  try {
    app = await electron.launch({
      args: [".", `--adactive-data=${dir}`],
      cwd: path.join(__dirname, ".."),
    });
    let page;
    for (let i = 0; i < 80; i++) {
      page = app.windows().find((p) => p.url().endsWith("index.html"));
      if (page) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await page.waitForFunction(() => document.querySelector("#projects").value);
    const native = () =>
      app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith("index.html"),
        );
        return { bounds: w.getBounds(), visible: w.isVisible() };
      });
    const initial = await native();
    assert.equal(initial.bounds.height, 64);
    assert.equal(initial.bounds.width, 760);
    assert.equal(
      await page.evaluate(() => {
        const c = document
          .querySelector(".composer-box")
          .getBoundingClientRect();
        const s = document.querySelector("#send").getBoundingClientRect();
        return (
          c.height <= 48 &&
          c.top >= 0 &&
          c.bottom <= innerHeight &&
          s.bottom <= innerHeight
        );
      }),
      true,
      "slim composer fits the native 64px bar",
    );
    await page.screenshot({ path: "artifacts/tray-slim-chat.png" });
    const clickTray = () =>
      app.evaluate(() =>
        process.mainModule
          .require(process.cwd() + "/src/main.cjs")
          .tray.emit("click"),
      );
    await clickTray();
    assert.equal((await native()).visible, false);
    await clickTray();
    await page.waitForFunction(() => document.activeElement.id === "composer");
    assert.equal((await native()).visible, true);
    assert.deepEqual((await native()).bounds, initial.bounds);
    assert.equal(
      await app.evaluate(() =>
        process.mainModule
          .require(process.cwd() + "/src/main.cjs")
          .tray.listenerCount("right-click"),
      ),
      process.platform === "darwin" ? 1 : 0,
    );
    await page.locator("#connection").click();
    let wp;
    for (let i = 0; i < 80; i++) {
      wp = app.windows().find((p) => p.url().endsWith("wordpress.html"));
      if (wp) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(wp, "key opens production WP-only native dialog");
    await wp.waitForFunction(
      () => document.querySelector("#wp-project").textContent,
    );
    assert.equal(await wp.locator("input").count(), 3);
    assert.equal(await wp.locator("select, textarea, [role=tab]").count(), 0);
    assert.equal(
      await wp.evaluate(() => getComputedStyle(document.body).backgroundColor),
      "rgb(32, 32, 41)",
    );
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.querySelector(".shell")).borderRadius,
      ),
      "20px",
    );
    await assert.rejects(
      page.evaluate(() => window.adactive.testWordPress({})),
      /Access denied/,
    );
    await assert.rejects(
      wp.evaluate(() => window.adactive.openWordPress()),
      /Access denied/,
    );
    assert.equal(
      await wp.locator("#wp-password").getAttribute("type"),
      "password",
    );
    assert.equal(await wp.locator("#wp-password").inputValue(), "");
    assert.equal(
      await wp.locator("#api-key, #provider, #model, #connect-form").count(),
      0,
    );
    assert.deepEqual((await native()).bounds, initial.bounds);
    assert.equal(await page.locator("#connection").isDisabled(), false);
    assert.equal(await page.locator("#options-toggle").isDisabled(), true);
    await assert.rejects(
      wp.evaluate(() => window.adactive.connect({})),
      /Access denied/,
    );
    await assert.rejects(
      wp.evaluate(() => window.adactive.connectWordPress({})),
      /Access denied/,
    );
    await assert.rejects(
      wp.evaluate(() => window.adactive.disconnectWordPress("other")),
      /Access denied/,
    );
    await assert.rejects(
      wp.evaluate(() => window.adactive.send({})),
      /Access denied/,
    );
    const pet = app.windows().find((p) => p.url().endsWith("pet.html"));
    await assert.rejects(
      pet.evaluate(() => window.adactive.wordPressState()),
      /Access denied/,
    );
    await assert.rejects(
      pet.evaluate(() => window.adactive.openWordPress()),
      /Access denied/,
    );
    await wp.screenshot({ path: "artifacts/tray-wordpress-empty.png" });
    // Public dummy only. Invalid HTTP URL is rejected before network access.
    await wp.locator("#wp-site").fill("http://127.0.0.1");
    await wp.locator("#wp-username").fill("PUBLIC-DUMMY");
    await wp.locator("#wp-password").fill("PUBLIC-DUMMY-PASSWORD");
    await wp.locator("#wp-password").press("Enter");
    assert.equal(
      await wp.locator("#wp-password").inputValue(),
      "PUBLIC-DUMMY-PASSWORD",
      "Enter does not authenticate",
    );
    await wp.locator("#wp-test").click();
    await wp.waitForFunction(() =>
      document.querySelector("#wp-result").textContent.includes("HTTPS"),
    );
    assert.equal(await wp.locator("#wp-password").inputValue(), "");
    await wp.locator("#wp-password").fill("PUBLIC-DUMMY-CANCEL");
    await wp.keyboard.press("Escape");
    await wp.waitForFunction(
      () => document.querySelector("#wp-password").value === "",
    );
    await app.evaluate(() =>
      process.mainModule
        .require(process.cwd() + "/src/main.cjs")
        .trayMenu.items.find((i) => i.label === "חיבור WordPress")
        .click(),
    );
    assert.equal(await wp.locator("#wp-password").inputValue(), "");
    assert.deepEqual(
      await wp.evaluate(() => [localStorage.length, sessionStorage.length]),
      [0, 0],
    );
    console.log(
      "PASS tray Electron: native 760x64 slim layout; real Tray emitted click hides/shows and focuses; macOS no attached context menu; WP-only guarded native dialog; no model UI/authorization; masked credential cleared; Enter cannot authenticate; explicit test rejects unsafe URL; chat geometry and only send/key active; other controls disabled. No live credentials/network/model requests.",
    );
    console.log(
      "LIMIT: Tray events emitted programmatically, not physical macOS menu-bar clicks; physical drag/resize not verified; Windows runtime not tested.",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
