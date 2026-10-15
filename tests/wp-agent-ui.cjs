// Native E2E: real IPC/provider adapters/agent/WP connector. ALL network injected MOCK.
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const root = path.join(__dirname, ".."),
    dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "wp-execution-"));
  let app;
  try {
    app = await electron.launch({
      args: [".", `--adactive-data=${dir}`],
      cwd: root,
    });
    await app.firstWindow();
    let page;
    for (let i = 0; i < 200; i++) {
      page = app.windows().find((p) => p.url().endsWith("index.html"));
      if (page) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await page.waitForFunction(() => document.querySelector("#projects").value);
    await app.evaluate((_e, root) => {
      globalThis.fetch = async () => {
        throw Error("MOCK ONLY no live network");
      };
      globalThis.wpExecution = { writes: 0, reads: 0, model: 0 };
      const W = process.mainModule.require(
        root + "/src/wordpress.cjs",
      ).WordPress;
      W.prototype.lookup = async () => [
        { address: "93.184.216.34", family: 4 },
      ];
      // Instances own injected request fields; intercept native HTTPS via prototype pageRequest wrapper below,
      // preserving actual scoped URL construction by changing constructor-owned fields at connect.
      const connect = W.prototype.connect;
      W.prototype.connect = function (...args) {
        this.lookup = async () => [{ address: "93.184.216.34", family: 4 }];
        this.request = async (url, o) => {
          const m = globalThis.wpExecution,
            route = url.searchParams.get("rest_route");
          if (route.endsWith("/users/me"))
            return {
              status: 200,
              body: JSON.stringify({
                id: 1,
                capabilities: {
                  edit_pages: true,
                  publish_pages: true,
                  edit_posts: true,
                  manage_options: true,
                },
              }),
            };
          if (o.method === "POST") {
            m.writes++;
            m.payload = JSON.parse(o.body);
          } else m.reads++;
          const p = {
            id: 9,
            status: "draft",
            title: { raw: m.payload?.title || "MOCK Example" },
            content: { raw: m.payload?.content || "<p>MOCK Example</p>" },
            modified: "fixture",
          };
          return {
            status: o.method === "POST" ? 201 : 200,
            body: JSON.stringify(
              route.endsWith("/pages") && o.method === "GET" ? [p] : p,
            ),
          };
        };
        return connect.apply(this, args);
      };
      const P = process.mainModule.require(root + "/src/provider.cjs").Provider;
      P.prototype.transport = async function (_a, _key, _url, body) {
        if (!body)
          return {
            models: [
              {
                name: "models/gemini-2.5-flash",
                supportedGenerationMethods: ["generateContent"],
              },
            ],
          };
        if (body.contents?.[0]?.parts?.[0]?.text === "Reply with OK.")
          return { candidates: [{ content: { parts: [{ text: "OK" }] } }] };
        const m = globalThis.wpExecution;
        const n = m.model++ % 3;
        const call =
          n === 0
            ? { name: "wp_list_pages", args: { page: 1 } }
            : n === 1
              ? { name: "wp_read_page", args: { id: 9 } }
              : {
                  name: "wp_prepare_create_page",
                  args: {
                    title: "MOCK reviewed draft",
                    content:
                      "<!-- wp:paragraph --><p>MOCK ONLY — reviewed body</p><!-- /wp:paragraph -->",
                  },
                };
        if (n === 1 || n === 2) {
          const results = body.contents.filter((c) =>
            c.parts?.some((p) => p.functionResponse),
          );
          if (!results.length) throw Error("Missing Gemini functionResponse");
        }
        return {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  { functionCall: call, thoughtSignature: "fixture-signature" },
                ],
              },
            },
          ],
        };
      };
    }, root);
    await page.evaluate(async () => {
      const p = (await window.adactive.state()).project;
      await window.adactive.connectWordPress({
        id: p.id,
        site: "https://public.example",
        username: "fixture",
        password: "PUBLIC-DUMMY",
      });
      const d = await window.adactive.discoverModels({
        provider: "gemini",
        key: "PUBLIC-DUMMY-MODEL",
      });
      await window.adactive.connect({
        token: d.token,
        model: "gemini-2.5-flash",
        consent: true,
      });
    });
    let history;
    async function propose() {
      await page.locator("#composer").fill("MOCK ONLY create a draft");
      await page.locator("#send").click();
      for(let i=0;i<100;i++) { history=app.windows().find(p=>p.url().endsWith("history.html")); if(history) break; await new Promise(r=>setTimeout(r,50)); }
      await history.locator("#wp-review").waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector("#chat-panel").getAttribute("aria-busy") ===
          "false",
      );
    }
    await propose();
    assert.equal(await app.evaluate(() => globalThis.wpExecution.writes), 0);
    assert.match(
      await history.locator("#wp-review").textContent(),
      /MOCK reviewed draft/,
    );
    const approvalVisible = await history.locator("#wp-approve").evaluate((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && r.height > 15;
    });
    assert.equal(
      approvalVisible,
      true,
      "review approve button must be inside native viewport without being clipped",
    );
    await history.screenshot({ path: "artifacts/wp-agent-review-MOCK.png" });
    await history.locator("#wp-deny").click();
    await history.locator("#wp-review").waitFor({ state: "detached" });
    assert.equal(await app.evaluate(() => globalThis.wpExecution.writes), 0);
    await propose();
    await history.locator("#wp-approve").click();
    await history.locator("#wp-review").waitFor({ state: "detached" });
    assert.equal(await app.evaluate(() => globalThis.wpExecution.writes), 1);
    assert.match(await history.locator("#messages").textContent(), /אומתו/);
    await history.screenshot({ path: "artifacts/wp-agent-verified-MOCK.png" });
    const pet = app.windows().find((p) => p.url().endsWith("pet.html"));
    const denied = await pet.evaluate(async () => {
      try {
        await window.adactive.decideWordPress({ token: "x", approve: true });
        return false;
      } catch {
        return true;
      }
    });
    assert.equal(denied, true);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith("history.html"),
      );
      w.setSize(320, 560);
    });
    await propose();
    assert.equal(
      await history.locator("#wp-approve").evaluate((e) => {
        const r = e.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight;
      }),
      true,
      "narrow review buttons stay visible",
    );
    await history.screenshot({
      path: "artifacts/wp-agent-review-narrow-MOCK.png",
    });
    const staleToken = await history.locator("#wp-review").getAttribute("data-token");
    await page.evaluate(async () => window.adactive.create("changed project"));
    const stale = await history.evaluate(async (staleToken) => {
      const token = staleToken;
      try {
        await window.adactive.decideWordPress({ token, approve: true });
        return false;
      } catch {
        return true;
      }
    }, staleToken);
    assert.equal(stale, true);
    assert.equal(await app.evaluate(() => globalThis.wpExecution.writes), 1);
    console.log(
      "MOCK native E2E passed: chat -> list -> read -> review -> deny 0 POST / approve 1 POST + exact GET; project/sender guards.",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
