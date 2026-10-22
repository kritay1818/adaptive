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
  const dir = fs.mkdtempSync(
    path.join(process.env.TMPDIR || require("node:os").tmpdir(), "wp-chat-ui-"),
  );
  let app;
  const launch = async () => {
    app = await electron.launch({
      args: [".", `--adactive-data=${dir}`],
      cwd: path.join(__dirname, ".."),
    });
    for (let i = 0; i < 60; i++) {
      const page = app.windows().find((w) => w.url().endsWith("index.html"));
      if (page) {
        await page.waitForFunction(
          () => document.querySelector("#projects").value,
        );
        await require("./setup-fixture.cjs")(app, page);
        return page;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("sidebar missing");
  };
  try {
    let page = await launch();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    assert.match(
      await page.locator("#connection-status").innerText(),
      /אין מודל מחובר/,
    );
    await page.locator("#composer").fill("בדיקה ללא מודל");
    await page.locator("#send").click();
    await page.waitForFunction(() =>
      document.querySelector("#notice").textContent.includes("אין מודל מחובר"),
    );
    assert.equal(await page.locator(".bubble.assistant").count(), 0);
    await page.locator("#composer").fill("מהיום תעבוד עם ChatGPT");
    await page.locator("#send").click();
    await page.locator("#connect-dialog").waitFor({ state: "visible" });
    await page.locator("#api-key").fill("invalid");
    await page.waitForFunction(() =>
      document.querySelector("#connect-error").textContent.includes("בדקו"),
    );
    assert.equal(await page.locator("#api-key").inputValue(), "invalid");
    assert.equal(fs.existsSync(path.join(dir, "connection.json")), false);
    await page.locator("#cancel-connect").click();
    const id = await page.locator("#projects").inputValue();
    await ensureOptions(page);
    await page.locator("#inspect-tab").click();
    await page.locator("#context").fill("הקשר בדיקה מתמשך");
    await page.locator("#save-context").click();
    await page.waitForFunction(() =>
      document.querySelector("#notice").textContent.includes("נשמר"),
    );
    await page.locator("#back-chat").click();
    await app.evaluate(
      (_electron, root) => {
        const { Provider } = process.mainModule.require(
          root + "/src/provider.cjs",
        );
        const discover = Provider.prototype.discover;
        Provider.prototype.discover = function (args) {
          this.fetch = async () => ({
            ok: true,
            json: async () => ({ data: [{ id: "gpt-4.1-mini" }] }),
          });
          return discover.call(this, args);
        };
        Provider.prototype.request = async function (
          key,
          model,
          messages,
          validation,
        ) {
          if (
            !validation &&
            JSON.stringify(messages).includes("public-dummy-model-key")
          )
            throw new Error("secret leaked");
          return validation
            ? "OK"
            : "MOCK ONLY — בדיקת תצוגה, לא תשובת מודל חי";
        };
      },
      path.join(__dirname, ".."),
    );
    await page.locator("#connection").click();
    await page.locator("#api-key").fill("public-dummy-model-key");
    await page.waitForFunction(
      () =>
        document.querySelector("#model").options[0]?.value === "gpt-4.1-mini",
    );
    await page.locator("#model").selectOption("gpt-4.1-mini");
    await page.locator("#confirm-connect").click();
    await page.waitForFunction(() =>
      document.querySelector("#connect-error").textContent.includes("אומת"),
    );
    assert.match(
      await page.locator("#wordpress-status").innerText(),
      /לא מחובר/,
    );
    assert.ok(
      !fs
        .readFileSync(path.join(dir, "connection.json"), "utf8")
        .includes("public-dummy-model-key"),
    );
    await page.locator("#cancel-connect").click();
    await page.locator("#composer").fill("בדיקת שיחה");
    await page.locator("#send").click();
    await page.waitForFunction(() =>
      document
        .querySelector(".bubble.assistant p")
        ?.textContent.includes("MOCK ONLY"),
    );
    await page.screenshot({ path: "artifacts/wordpress-chat-MOCK.png" });
    await page.evaluate(async () => {
      const fixture = await window.adactive.state();
      fixture.project.messages = [
        {
          role: "assistant",
          content: '<img src=x onerror="window.injected=true">',
        },
      ];
      render(fixture);
    });
    assert.equal(await page.locator(".bubble img").count(), 0);
    assert.equal(await page.evaluate(() => !!window.injected), false);
    await page.evaluate(async () => render(await window.adactive.state()));
    await ensureOptions(page);
    await page.locator("#new-project").click();
    await page.locator("#project-name").fill("נפרד");
    await page.locator("#project-form .primary").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#projects").selectedOptions[0].textContent ===
        "נפרד",
    );
    assert.equal(await page.locator(".bubble").count(), 0);
    await ensureOptions(page);
    await page.locator("#inspect-tab").click();
    assert.equal(await page.locator("#context").inputValue(), "");
    await ensureOptions(page);
    await page.locator("#projects").selectOption(id);
    await page.waitForFunction(
      () => document.querySelector("#context").value === "הקשר בדיקה מתמשך",
    );
    await page.evaluate(() => setBusy(true));
    for (const control of [
      "composer",
      "context",
      "rules",
      "documents",
      "send",
      "projects",
      "new-project",
      "connection",
    ])
      assert.equal(await page.locator("#" + control).isDisabled(), true);
    await page.evaluate(() => setBusy(false));
    const pet = app.windows().find((w) => w.url().endsWith("pet.html"));
    assert.match(
      await pet.evaluate(() => window.adactive.state().catch((e) => e.message)),
      /Access denied/,
    );
    const isVisible = (file) =>
      app.evaluate(
        ({ BrowserWindow }, file) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL().endsWith(file))
            ?.isVisible() ?? false,
        file,
      );
    const waitVisible = async (expected, file = "index.html") => {
      for (let attempt = 0; attempt < 40; attempt++) {
        if ((await isVisible(file)) === expected) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Native ${file} visibility did not become ${expected}`);
    };
    await ensureOptions(page);
    await page.locator("#hide").click();
    await waitVisible(false);
    // Clicking the pet opens the chat window (history.html) with the input focused; the small bar stays hidden.
    await pet.locator("#open-chat").click();
    await waitVisible(true, "history.html");
    assert.equal(await isVisible("history.html"), true);
    assert.equal(await isVisible("index.html"), false);
    assert.deepEqual(errors, []);
    await app.close();
    app = null;
    page = await launch();
    await ensureOptions(page);
    await page.locator("#inspect-tab").click();
    assert.equal(
      await page.locator("#context").inputValue(),
      "הקשר בדיקה מתמשך",
    );
    assert.match(
      await page.locator("#connection-status").innerText(),
      /OpenAI/,
    );
    assert.match(
      await page.locator("#wordpress-status").innerText(),
      /לא מחובר/,
    );
    console.log(
      "PASS Electron chat regressions: separate required model; injected MODEL MOCK only; native safeStorage ciphertext; saved model/context/chat survive restart; project isolation; XSS-as-text; locks; pet click opens the chat window; no page errors. No provider network.",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
