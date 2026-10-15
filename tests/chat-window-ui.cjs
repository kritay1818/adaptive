const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "chat-window-"));
  let app;
  const launch = async () => {
    app = await electron.launch({
      args: [".", `--adactive-data=${dir}`],
      cwd: path.join(__dirname, ".."),
    });
    for (let i = 0; i < 80; i++) {
      const page = app.windows().find((p) => p.url().endsWith("index.html"));
      if (page) {
        await page.waitForFunction(
          () => document.querySelector("#projects").value,
        );
        return page;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("chat missing");
  };
  const native = () =>
    app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith("index.html"),
      );
      return {
        bounds: w.getBounds(),
        area: screen.getDisplayMatching(w.getBounds()).workArea,
        visible: w.isVisible(),
        resizable: w.isResizable(),
        movable: w.isMovable(),
      };
    });
  const resize = async (width, height) =>
    app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith("index.html"))
          .setSize(...size),
      [width, height],
    );
  try {
    let page = await launch();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const initial = await native();
    assert.equal(initial.resizable, true);
    assert.equal(initial.movable, true);
    assert.equal(initial.bounds.height, 64);
    assert.equal(initial.bounds.width, Math.min(760, initial.area.width - 32));
    for (const [position, size] of [
      ["x", "width"],
      ["y", "height"],
    ])
      assert.ok(
        Math.abs(
          initial.bounds[position] +
            initial.bounds[size] / 2 -
            initial.area[position] -
            initial.area[size] / 2,
        ) <= 1,
      );
    assert.deepEqual(
      await page.evaluate(() =>
        [...document.querySelectorAll("button:not(:disabled)")].map(
          (e) => e.id,
        ),
      ),
      ["history-close", "connection", "model-setup", "history-toggle", "send"],
    );
    for (const id of ["options-toggle"]) {
      assert.equal(await page.locator("#" + id).isDisabled(), true);
      await page.locator("#" + id).evaluate((e) => {
        e.click();
        e.focus();
        e.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      assert.equal(await page.locator("dialog[open]").count(), 0);
      assert.equal(await page.locator("#options-panel").isVisible(), false);
    }
    await page.locator("#composer").focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "send");
    await page.keyboard.press("Tab");
    assert.ok(
      !["options-toggle"].includes(
        await page.evaluate(() => document.activeElement.id),
      ),
    );
    assert.equal(
      await page
        .locator("#chat-drag")
        .evaluate((e) => getComputedStyle(e).webkitAppRegion),
      "drag",
    );
    for (const id of ["composer", "send"])
      assert.equal(
        await page
          .locator("#" + id)
          .evaluate((e) => getComputedStyle(e).webkitAppRegion),
        "no-drag",
      );
    await page.screenshot({ path: "artifacts/chat-controls-initial.png" });
    await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith("index.html"),
      );
      const area = screen.getDisplayMatching(w.getBounds()).workArea;
      w.setPosition(area.x + 40, area.y + 50);
    });
    assert.notDeepEqual((await native()).bounds, initial.bounds);
    await resize(420, 280);
    assert.equal((await native()).bounds.width, 420);
    assert.equal((await native()).bounds.height, 280);
    const moved = (await native()).bounds;
    await page.locator("#composer").fill("שורה אחת");
    await page.locator("#composer").press("Shift+Enter");
    assert.match(await page.locator("#composer").inputValue(), /\n/);
    assert.deepEqual((await native()).bounds, moved);
    await page.locator("#composer").fill("מהיום תעבוד עם ChatGPT");
    await page.locator("#composer").press("Enter");
    await page.waitForFunction(() =>
      document.querySelector("#notice").textContent.includes("חברו מודל"),
    );
    assert.equal(await page.locator("dialog[open]").count(), 0);
    await page.keyboard.press("Escape");
    for (let i = 0; i < 20 && (await native()).visible; i++)
      await page.waitForTimeout(50);
    assert.equal((await native()).visible, false);
    const pet = app.windows().find((p) => p.url().endsWith("pet.html"));
    await pet.locator("#open-chat").click();
    await page.waitForFunction(() => document.activeElement.id === "composer");
    assert.equal((await native()).visible, true);
    assert.deepEqual((await native()).bounds, moved);
    await assert.rejects(
      pet.evaluate(() => window.adactive.chatSurface("settings")),
      /Access denied/,
    );
    await assert.rejects(
      page.evaluate(() => window.adactive.chatSurface({ width: 99999 })),
      /Invalid/,
    );
    await page.evaluate(() => window.adactive.chatSurface("conversation"));
    assert.deepEqual((await native()).bounds, moved);
    // Main-process MOCK transport; real IPC, ciphertext, send and rendering.
    await app.evaluate(
      (_e, root) => {
        const P = process.mainModule.require(
          root + "/src/provider.cjs",
        ).Provider;
        const discover = P.prototype.discover;
        P.prototype.discover = function (args) {
          this.fetch = async () => ({
            ok: true,
            json: async () => ({ data: [{ id: "gpt-4.1-mini" }] }),
          });
          return discover.call(this, args);
        };
        P.prototype.request = async (_key, _model, _messages, validation) =>
          validation
            ? "OK"
            : "MOCK ONLY — תשובת בדיקה, לא מודל חי\n" +
              "תוכן בדיקה. ".repeat(350);
      },
      path.join(__dirname, ".."),
    );
    await page.evaluate(async () => {
      const draft = await window.adactive.discoverModels({
        provider: "openai",
        region: "",
        key: "PUBLIC-DUMMY-chat-window",
      });
      await window.adactive.connect({
        token: draft.token,
        model: "gpt-4.1-mini",
        consent: true,
      });
    });
    await page.locator("#composer").fill("בדיקת Enter");
    await page.locator("#composer").press("Enter");
    await page.waitForFunction(() => document.querySelector("#history-badge").textContent === "1");
    assert.equal(await page.locator("#composer").inputValue(), "");
    assert.deepEqual((await native()).bounds, moved);
    await page.locator("#composer").fill("בדיקת שלח");
    await page.locator("#send").click();
    await page.waitForFunction(
      () => document.querySelector("#history-badge").textContent === "2",
    );
    for (const [width, height, name] of [
      [280, 64, "minimum"],
      [360, 300, "narrow"],
      [900, 600, "wide"],
    ]) {
      await resize(width, height);
      await page.waitForFunction(
        ({ width, height }) => innerWidth === width && innerHeight === height,
        { width, height },
      );
      assert.equal(
        await page.evaluate(() => {
          const composer = document
            .querySelector("#composer")
            .getBoundingClientRect();
          const send = document.querySelector("#send").getBoundingClientRect();
          return (
            composer.top >= 0 &&
            composer.bottom <= innerHeight &&
            send.right <= innerWidth &&
            send.bottom <= innerHeight &&
            document.documentElement.scrollWidth <= innerWidth
          );
        }),
        true,
        "composer/send within bounds: " + name,
      );
      await page.locator("#messages").evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.screenshot({
        path: `artifacts/chat-controls-${name}-MOCK.png`,
      });
    }
    assert.equal(
      await page
        .locator("#messages")
        .evaluate((e) => e.scrollHeight > e.clientHeight),
      false,
    );
    const saved = (await native()).bounds;
    await app.close();
    app = null;
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(dir, "chat-layout.json"), "utf8")),
      saved,
    );
    page = await launch();
    assert.deepEqual((await native()).bounds, saved);
    assert.deepEqual(errors, []);
    console.log(
      "PASS production chat: send + WP key mouse/keyboard; no setup triggers; native BrowserWindow move/resize; geometry retained on reply/show/restart; minimum/narrow/wide; Enter/ShiftEnter/Escape; labeled main-process MOCK sends; IPC security.",
    );
    console.log(
      "LIMIT: physical grip/edge OS-event automation unavailable (AXIsProcessTrusted=false / CGPreflightPostEventAccess=false); native APIs and CSS regions verified; manual physical drag/edge check required.",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
