const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "discovery-ui-"));
  const app = await electron.launch({
    args: [".", `--adactive-data=${dir}`],
    cwd: path.join(__dirname, ".."),
  });
  try {
    const newWindow = app.waitForEvent("window");
    await app.evaluate(({ BrowserWindow }) => {
      const w = new BrowserWindow({
        width: 480,
        height: 860,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      w.loadURL("about:blank");
    });
    const page = await newWindow;
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const providers = ["openai", "anthropic", "gemini"].map((id) => ({
        id,
        label: id,
        regions: [],
      }));
      const connection = {
        connected: false,
        providers,
        saved: [
          {
            provider: "gemini",
            region: "",
            models: ["saved"],
            label: "Gemini",
            slot: "gemini",
          },
        ],
      };
      window.calls = [];
      window.pending = [];
      window.connects = [];
      window.cancellations = 0;
      window.adactive = {
        state: async () => ({
          project: {
            id: "test",
            name: "MOCK ONLY",
            context: "",
            rules: "",
            documents: "",
            messages: [],
          },
          projects: [{ id: "test", name: "MOCK ONLY" }],
          wordpress: {},
          connection,
        }),
        cancelModels: async () => {
          window.cancellations++;
        },
        discoverModels: (args) => {
          window.calls.push({ ...args });
          return new Promise((resolve, reject) =>
            window.pending.push({ resolve, reject }),
          );
        },
        connect: async (args) => {
          window.connects.push(args);
          return connection;
        },
      };
      window.resolveModels = (index, model) =>
        window.pending[index].resolve({
          token: "token-" + index,
          models: [{ id: model, label: model }],
          note: "MOCK ONLY · ללא בקשת יצירה",
        });
    });
    await page.goto(
      pathToFileURL(path.join(__dirname, "../src/ui/index.html")).href,
    );
    await require("./setup-fixture.cjs")(app, page);
    await page.locator("#connection").click();
    assert.equal(await page.locator("#model-consent").count(), 0);
    await page.locator("#confirm-connect").click();
    assert.equal(await page.evaluate(() => connects.length), 0);
    // Simulate the input event browsers emit after a paste; dummy, arbitrary-format key.
    const paste = (value) =>
      page.locator("#api-key").evaluate((el, value) => {
        el.value = value;
        el.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertFromPaste",
            data: value,
          }),
        );
      }, value);
    await paste("dummy-A");
    await page.waitForTimeout(400);
    assert.equal(
      await page.evaluate(() => calls.length),
      0,
      "debounce avoids immediate request",
    );
    await page.waitForFunction(() => calls.length === 1);
    assert.deepEqual(await page.evaluate(() => calls[0]), {
      provider: "openai",
      region: "",
      key: "dummy-A",
    });
    assert.match(await page.locator("#models-note").innerText(), /טוען/);
    await page.evaluate(() => resolveModels(0, "model-A"));
    await page.waitForFunction(
      () => document.querySelector("#model").options.length === 1,
    );
    await page.locator("#confirm-connect").click();
    assert.equal(
      await page.evaluate(() => connects.length),
      0,
      "explicit model selection required",
    );
    await page.locator("#model").selectOption("model-A");
    await page.locator("#api-key").press("Enter");
    assert.equal(
      await page.evaluate(() => connects.length),
      0,
      "Enter in credential field is not billable authorization",
    );
    await page.locator("#confirm-connect").click();
    assert.deepEqual(await page.evaluate(() => connects), [
      { token: "token-0", model: "model-A", consent: true },
    ]);
    await paste("never-send-A-to-B");
    await page.locator("#provider").selectOption("anthropic");
    await page.waitForTimeout(950);
    assert.equal(
      await page.evaluate(() => calls.length),
      1,
      "switch cancels debounce and clears unsaved key",
    );
    assert.equal(await page.locator("#api-key").inputValue(), "");
    await paste("dummy-B");
    await page.waitForFunction(() => calls.length === 2);
    await page.locator("#provider").selectOption("gemini");
    await page.waitForFunction(() => calls.length === 3);
    assert.deepEqual(
      await page.evaluate(() => calls[2]),
      { provider: "gemini", region: "", key: "" },
      "saved key stays main-only and provider-scoped",
    );
    await page.evaluate(() => resolveModels(2, "model-G"));
    await page.waitForFunction(
      () => document.querySelector("#model").options[0]?.value === "model-G",
    );
    await page.evaluate(() => resolveModels(1, "STALE-B"));
    await page.waitForTimeout(50);
    assert.equal(
      await page.locator("#model option").first().getAttribute("value"),
      "model-G",
      "late success cannot replace latest provider",
    );
    await paste("pending-G");
    await page.waitForFunction(() => calls.length === 4);
    await paste("new-G");
    await page.waitForFunction(() => calls.length === 5);
    await page.evaluate(() => pending[3].reject(new Error("STALE ERROR")));
    await page.waitForTimeout(50);
    assert.doesNotMatch(
      await page.locator("#connect-error").innerText(),
      /STALE/,
    );
    assert.equal(
      await page.locator("#model-picker").getAttribute("aria-busy"),
      "true",
      "stale finally cannot clear new loading state",
    );
    await page.evaluate(() =>
      pending[4].reject(new Error("MOCK transient error")),
    );
    await page.locator("#load-models").waitFor({ state: "visible" });
    await page.locator("#load-models").click();
    await page.waitForFunction(() => calls.length === 6);
    assert.equal(
      await page.evaluate(() => calls[5].key),
      "new-G",
      "retry retains only current provider credential",
    );
    await page.locator("#cancel-connect").click();
    await page.evaluate(() => resolveModels(5, "CLOSED"));
    await page.waitForTimeout(50);
    assert.equal(
      await page.locator("#model option").count(),
      0,
      "closed dialog discards late response",
    );
    assert.equal(await page.locator("#api-key").inputValue(), "");
    await page.locator("#connection").click();
    await page.locator("#provider").selectOption("openai");
    await paste("cancel-before-timer");
    await page.locator("#cancel-connect").click();
    await page.waitForTimeout(950);
    assert.equal(
      await page.evaluate(() => calls.length),
      6,
      "closing cancels scheduled discovery",
    );
    await page.locator("#connection").click();
    await paste("screenshot-dummy");
    await page.waitForFunction(() => calls.length === 7);
    await page.evaluate(() => resolveModels(6, "MOCK-model"));
    await page.locator("#model option").waitFor();
    await page.locator("#confirm-connect").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/auto-discovery-MOCK.png" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS renderer MOCK: paste debounce; no checkbox; explicit selection/click; provider isolation; saved-key scope; stale success/error/loading; retry; close/reset. No network.",
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
