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
    path.join(
      process.env.TMPDIR || require("node:os").tmpdir(),
      "providers-ui-",
    ),
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
    await page.waitForFunction(() => document.querySelector("#projects").value);
    await require("./setup-fixture.cjs")(app, page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await ensureOptions(page);
    await page.locator("#chat-model-toggle").click();
    await page.locator("#manage-models").click();
    assert.equal(await page.locator("#provider option").count(), 5);
    assert.equal(await page.locator("#model-consent").count(), 0);
    assert.equal(
      await page.locator("#api-key").getAttribute("type"),
      "password",
    );
    await app.evaluate(
      (_e, root) => {
        const P = process.mainModule.require(
          root + "/src/provider.cjs",
        ).Provider;
        const transport = P.prototype.transport;
        globalThis.providerMockCalls = [];
        P.prototype.transport = function (...args) {
          this.fetch = async (url, opts) => {
            globalThis.providerMockCalls.push({ url, method: opts.method });
            if (globalThis.providerMockFail && opts.method === "POST")
              return { ok: false, status: 401 };
            const a = args[0],
              model = a.kind + "-MOCK";
            const data =
              opts.method === "GET"
                ? a.kind === "gemini"
                  ? {
                      models: [
                        {
                          name: "models/" + model,
                          supportedGenerationMethods: ["generateContent"],
                        },
                      ],
                    }
                  : a.kind === "qwen"
                    ? {
                        success: true,
                        output: {
                          total: 1,
                          page_no: 1,
                          page_size: 100,
                          models: [
                            {
                              model,
                              inference_metadata: {
                                response_modality: ["Text"],
                                request_modality: ["Text"],
                              },
                            },
                          ],
                        },
                      }
                    : { data: [{ id: model }], has_more: false }
                : a.kind === "anthropic"
                  ? { content: [{ type: "text", text: "MOCK ONLY OK" }] }
                  : a.kind === "gemini"
                    ? {
                        candidates: [
                          { content: { parts: [{ text: "MOCK ONLY OK" }] } },
                        ],
                      }
                    : { choices: [{ message: { content: "MOCK ONLY OK" } }] };
            return { ok: true, json: async () => data };
          };
          return transport.apply(this, args);
        };
      },
      path.join(__dirname, ".."),
    );
    // A cancelled slow request must settle before its replacement reaches main's busy guard.
    await app.evaluate(
      (_e, root) => {
        const P = process.mainModule.require(
          root + "/src/provider.cjs",
        ).Provider;
        const transport = P.prototype.transport;
        globalThis.holdDiscovery = true;
        P.prototype.transport = async function (...args) {
          if (globalThis.holdDiscovery) {
            globalThis.holdDiscovery = false;
            globalThis.discoveryHeld = true;
            await new Promise((resolve) => {
              globalThis.releaseDiscovery = resolve;
            });
          }
          return transport.apply(this, args);
        };
      },
      path.join(__dirname, ".."),
    );
    await page.locator("#api-key").fill("PUBLIC-DUMMY-old");
    for (
      let i = 0;
      i < 40 && !(await app.evaluate(() => globalThis.discoveryHeld));
      i++
    )
      await page.waitForTimeout(50);
    assert.equal(await app.evaluate(() => globalThis.discoveryHeld), true);
    await page.locator("#provider").selectOption("anthropic");
    await page.locator("#api-key").fill("PUBLIC-DUMMY-new");
    await page.waitForTimeout(1000);
    await app.evaluate(() => globalThis.releaseDiscovery());
    await page.waitForFunction(
      () =>
        document.querySelector("#model").options[0]?.value === "anthropic-MOCK",
      null,
      { timeout: 5000 },
    );
    assert.equal(await page.locator("#load-models").isVisible(), false);
    for (const provider of [
      "openai",
      "anthropic",
      "gemini",
      "moonshot",
      "qwen",
    ]) {
      await page.locator("#provider").selectOption(provider);
      await page.locator("#api-key").fill("PUBLIC-DUMMY-" + provider);
      await page.waitForFunction(
        () =>
          document.querySelector("#model").options.length === 1 &&
          document.querySelector("#model").options[0].value.endsWith("-MOCK"),
      );
      assert.equal(await page.locator("#api-key").inputValue(), "");
      assert.equal(
        await app.evaluate(
          () =>
            globalThis.providerMockCalls.filter((c) => c.method === "POST")
              .length,
        ),
        ["openai", "anthropic", "gemini", "moonshot", "qwen"].indexOf(provider),
        "discovery never performs inference",
      );
      if (provider === "qwen") {
        await page.evaluate(() => {
          document.querySelector("#model-title").textContent =
            "מודל השיחה · MOCK ONLY";
        });
        await page.locator("#model-title").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: "artifacts/providers-discovery-MOCK.png",
        });
        await page.locator("#model-search").fill("missing");
        assert.equal(await page.locator("#model option").count(), 0);
        await page.locator("#model-search").fill("qwen");
        assert.equal(await page.locator("#model option").count(), 1);
      }
      await page.locator("#model").selectOption(provider + "-MOCK");
      await page.locator("#confirm-connect").click();
      await page.waitForFunction(() =>
        document.querySelector("#connect-error").textContent.includes("אומת"),
      );
      assert.match(
        await page.locator("#connection-status").innerText(),
        new RegExp(
          provider === "anthropic"
            ? "Claude"
            : provider === "gemini"
              ? "Gemini"
              : provider === "moonshot"
                ? "Kimi"
                : provider === "qwen"
                  ? "Qwen"
                  : "OpenAI",
        ),
      );
    }
    await page.evaluate(() => {
      const p = document.createElement("p");
      p.textContent = "MOCK ONLY — ספקים מדומים, לא אימות חי";
      document.querySelector("#connect-dialog").prepend(p);
    });
    await page.locator("#model-title").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/providers-settings-MOCK.png" });
    const raw = fs.readFileSync(path.join(dir, "connection.json"), "utf8");
    assert.doesNotMatch(raw, /PUBLIC-DUMMY/);
    assert.equal(Object.keys(JSON.parse(raw).records).length, 5);
    await page.locator("#provider").selectOption("anthropic");
    await page.waitForFunction(
      () =>
        document.querySelector("#model").options[0]?.value === "anthropic-MOCK",
    );
    await app.evaluate(() => {
      globalThis.providerMockFail = true;
    });
    await page.locator("#model").selectOption("anthropic-MOCK");
    await page.locator("#confirm-connect").click();
    await page.waitForFunction(() =>
      document.querySelector("#connect-error").textContent.includes("401"),
    );
    assert.match(await page.locator("#connection-status").innerText(), /Qwen/);
    await page.locator("#cancel-connect").click();
    await ensureOptions(page);
    await page.locator("#chat-model-toggle").click();
    await page.locator("#chat-model-search").fill("Claude");
    assert.equal(await page.locator("#saved-models button").count(), 1);
    const count = await app.evaluate(() => globalThis.providerMockCalls.length);
    await page.locator("#saved-models button").click();
    await page.locator("#apply-model").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#connection-status")
        .textContent.includes("Claude"),
    );
    assert.equal(
      await app.evaluate(() => globalThis.providerMockCalls.length),
      count,
      "switch validated model has no network",
    );
    await ensureOptions(page);
    await page.locator("#chat-model-toggle").click();
    await page.locator("#chat-model-search").fill("");
    await page.screenshot({ path: "artifacts/providers-dropdown-MOCK.png" });
    assert.doesNotMatch(
      JSON.stringify(await page.evaluate(() => window.adactive.state())),
      /PUBLIC-DUMMY/,
    );
    const pet = app.windows().find((w) => w.url().endsWith("pet.html"));
    assert.match(
      await pet.evaluate(() =>
        window.adactive.discoverModels({}).catch((e) => e.message),
      ),
      /Access denied/,
    );
    assert.deepEqual(errors, []);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith("index.html"))
        .setBounds({ width: 360, height: 600 }),
    );
    await page.waitForFunction(() => innerWidth === 360);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: "artifacts/providers-dropdown-360-MOCK.png",
    });
    await page.locator("#chat-model-search").focus();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#chat-model-menu").isVisible(), false);
    await app.close();
    app = null;
    app = await electron.launch({
      args: [".", `--adactive-data=${dir}`],
      cwd: path.join(__dirname, ".."),
    });
    let restarted;
    for (let i = 0; i < 60; i++) {
      restarted = app.windows().find((w) => w.url().endsWith("index.html"));
      if (restarted) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await restarted.waitForFunction(
      () => document.querySelector("#projects").value,
    );
    const state = await restarted.evaluate(() => window.adactive.state());
    assert.equal(state.connection.providerId, "anthropic");
    assert.equal(state.connection.model, "anthropic-MOCK");
    assert.equal(state.connection.saved.length, 5);
    assert.doesNotMatch(JSON.stringify(state), /PUBLIC-DUMMY/);
    console.log(
      "PASS providers Electron: 5 actual adapters with MOCK transport; discovery no inference; explicit consent; safeStorage ciphertext; failed replacement preserved; searchable validated-model picker; no-network explicit switch; no secret state; pet denied; screenshots. No live provider requests.",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
