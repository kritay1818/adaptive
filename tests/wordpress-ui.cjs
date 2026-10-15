const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ensureOptions = async (page) => {
  if (await page.locator("#inspect-panel").isVisible())
    await page.locator("#back-chat").click();
  if (!(await page.locator("#options-panel").isVisible()))
    await page.locator("#options-toggle").click();
};

(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "wp-electron-"));
  // Legacy selection fixture: must not launch ACP or delete saved settings.
  fs.writeFileSync(
    path.join(dir, "backend.json"),
    JSON.stringify({ backend: "hermes" }),
  );
  fs.writeFileSync(
    path.join(dir, "hermes-state.json"),
    JSON.stringify({ publicLegacyFixture: true }),
  );
  let app;
  try {
    app = await electron.launch({
      args: [".", `--adactive-data=${dir}`],
      cwd: path.join(__dirname, ".."),
    });
    let page;
    for (let i = 0; i < 60; i++) {
      page = app.windows().find((w) => w.url().endsWith("index.html"));
      if (page) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForFunction(() => document.querySelector("#projects").value);
    await require("./setup-fixture.cjs")(app, page);
    assert.equal(await page.locator("#backend").count(), 0);
    assert.match(
      await page.locator("#wordpress-status").innerText(),
      /WordPress לא מחובר/,
    );
    await page.locator("#connection").click();
    assert.equal(
      await page.locator("#wp-password").getAttribute("type"),
      "password",
    );
    assert.doesNotMatch(
      await page.locator("#connect-dialog").innerText(),
      /workspace|פרופיל ייעודי|נתיב|CRM|Drive/,
    );
    await page.screenshot({ path: "artifacts/wordpress-empty.png" });
    await page.locator("#wp-site").fill("http://127.0.0.1");
    await page.locator("#wp-username").fill("public-fixture");
    await page.locator("#wp-password").fill("public-dummy");
    await page.locator("#wp-test").click();
    await page.waitForFunction(() =>
      document.querySelector("#wp-result").textContent.includes("HTTPS"),
    );
    assert.equal(await page.locator("#wp-password").inputValue(), "");
    await page.screenshot({ path: "artifacts/wordpress-error.png" });
    await page.locator("#cancel-connect").click();
    const id = await page.locator("#projects").inputValue();
    const error = await page.evaluate(
      (id) =>
        window.adactive.send({ id, message: "hello" }).catch((e) => e.message),
      id,
    );
    assert.match(error, /Hermes.*מושבת/);
    assert.equal(
      await page.evaluate(() => typeof window.adactive.discoverHermes),
      "undefined",
    );
    // Injected main-process transport fixture. No external or local WP network.
    await app.evaluate(
      ({ app }, root) => {
        const wp = process.mainModule.require(root + "/src/wordpress.cjs")
          .WordPress.prototype;
        const original = wp.connect;
        wp.connect = function (id, args) {
          this.lookup = async () => [{ address: "93.184.216.34", family: 4 }];
          this.request = async () => ({
            status: 200,
            body: JSON.stringify({ id: 7, name: "LABELED MOCK" }),
          });
          return original.call(this, id, args);
        };
      },
      path.join(__dirname, ".."),
    );
    await page.locator("#connection").click();
    await page.locator("#wp-site").fill("https://public.example");
    await page.locator("#wp-username").fill("public-fixture");
    await page
      .locator("#wp-password")
      .fill("public-dummy-application-password");
    await page.locator("#wp-test").click();
    await page.waitForFunction(() =>
      document.querySelector("#wp-result").textContent.includes("אומת"),
    );
    await page.evaluate(() => {
      const label = document.createElement("p");
      label.textContent = "בדיקת UI — MOCK מוזרק, לא חיבור לאתר אמיתי";
      label.style.color = "#b00020";
      document.querySelector("#connect-dialog").prepend(label);
    });
    await page.screenshot({ path: "artifacts/wordpress-success-MOCK.png" });
    assert.equal(await page.locator("#wp-password").inputValue(), "");
    assert.ok(
      !JSON.stringify(
        await page.evaluate(() => window.adactive.state()),
      ).includes("public-dummy"),
    );
    await page.locator("#cancel-connect").click();
    await ensureOptions(page);
    await page.locator("#new-project").click();
    await page.locator("#project-name").fill("פרויקט נפרד");
    await page.locator("#project-form .primary").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#projects").selectedOptions[0].textContent ===
        "פרויקט נפרד",
    );
    assert.match(
      await page.locator("#wordpress-status").innerText(),
      /לא מחובר/,
    );
    await page.locator("#projects").selectOption(id);
    await page.waitForFunction(
      () =>
        !document
          .querySelector("#wordpress-status")
          .textContent.includes("לא מחובר"),
    );
    await page.locator("#connection").click();
    await page.locator("#wp-disconnect").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#wordpress-status")
        .textContent.includes("לא מחובר"),
    );
    await page.locator("#api-key").fill("public-fixture");
    await page.locator("#wp-password").fill("public-fixture");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#api-key").inputValue(), "");
    assert.equal(await page.locator("#wp-password").inputValue(), "");
    for (const [width, height] of [
      [360, 540],
      [980, 760],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, bounds) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL().endsWith("index.html"))
            .setBounds(bounds),
        { x: 0, y: 40, width, height },
      );
      await page.waitForFunction((w) => innerWidth === w, width);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.locator("#connection").click();
      assert.equal(
        await page
          .locator("#connect-dialog")
          .evaluate((el) => el.scrollWidth > el.clientWidth),
        false,
      );
      await page.screenshot({ path: `artifacts/wordpress-${width}.png` });
      await page.locator("#cancel-connect").click();
    }
    assert.deepEqual(
      await page.evaluate(() => [localStorage.length, sessionStorage.length]),
      [0, 0],
    );
    assert.equal(
      fs.readFileSync(path.join(dir, "hermes-state.json"), "utf8"),
      JSON.stringify({ publicLegacyFixture: true }),
    );
    const prefs = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) =>
        w.webContents.getLastWebPreferences(),
      ),
    );
    assert.ok(
      prefs.every((p) => p.sandbox && p.contextIsolation && !p.nodeIntegration),
    );
    const pet = app.windows().find((w) => w.url().endsWith("pet.html"));
    assert.ok(pet);
    assert.match(
      await pet.evaluate(() =>
        window.adactive.connectWordPress({}).catch((e) => e.message),
      ),
      /Access denied/,
    );
    await pet.screenshot({ path: "artifacts/wordpress-pet.png" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS WP Electron: real isolated Electron; invalid URL; encrypted injected MOCK success; project isolation/disconnect; legacy ACP blocked and saved data preserved; masked fields cleared; sandbox; pet IPC denial; responsive screenshots; no page errors. No live WordPress or model requests.",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
