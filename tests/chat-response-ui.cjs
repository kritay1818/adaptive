// Isolated native production-renderer regression. ALL provider traffic is MOCK.
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "chat-response-"));
  let app;
  const native = () =>
    app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith("index.html"),
      );
      return {
        bounds: w.getBounds(),
        area: screen.getDisplayMatching(w.getBounds()).workArea,
      };
    });
  const resize = (height) =>
    app.evaluate(({ BrowserWindow }, height) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith("index.html"),
      );
      w.setSize(760, height);
    }, height);
  const readable = (page, selector) =>
    page
      .locator(selector)
      .last()
      .evaluate((e) => {
        const r = e.getBoundingClientRect();
        const parent = e.closest("#messages") || e;
        const p = parent.getBoundingClientRect();
        return {
          text: e.textContent,
          height: r.height,
          viewport: innerHeight,
          parentHeight: p.height,
          readable:
            r.height >= 18 &&
            p.height >= 18 &&
            r.top >= Math.max(0, p.top) &&
            r.bottom <= Math.min(innerHeight, p.bottom),
          rect: r.toJSON(),
          parent: p.toJSON(),
        };
      });
  const launch = async () => {
    app = await electron.launch({
      args: [".", `--adactive-data=${dir}`],
      cwd: root,
    });
    for (let i = 0; i < 100; i++) {
      const p = app.windows().find((p) => p.url().endsWith("index.html"));
      if (p) {
        await p.waitForFunction(
          () => document.querySelector("#projects").value,
        );
        return p;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error("Missing production chat");
  };
  try {
    const initialArea = { x: 120, y: 420, width: 760, height: 64 };
    fs.writeFileSync(
      path.join(dir, "chat-layout.json"),
      JSON.stringify(initialArea),
    );
    let page = await launch();
    assert.equal(await page.locator('#model-setup').isVisible(), true, 'model onboarding comes first');
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await app.evaluate((_e, root) => {
      globalThis.chatMock = { mode: "success", calls: 0, release: null };
      // Fail closed: no real network access even if fixture routing is wrong.
      globalThis.fetch = async () => {
        throw Error("MOCK suite prohibits network");
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
        const mock = globalThis.chatMock;
        mock.calls++;
        await new Promise((resolve) => {
          mock.release = resolve;
        });
        if (mock.mode === "error")
          throw Error("MOCK ONLY — Gemini החזיר 429. בדקו יתרה והרשאות.");
        if (mock.mode === "empty") return { candidates: [] };
        return {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text:
                      "MOCK ONLY — תשובה קריאה ללא מודל חי" +
                      (mock.mode === "long"
                        ? "\nתוכן בדיקה ארוך. ".repeat(300)
                        : ""),
                  },
                ],
              },
            },
          ],
        };
      };
    }, root);
    await page.evaluate(async () => {
      const draft = await window.adactive.discoverModels({
        provider: "gemini",
        region: "",
        key: "PUBLIC-DUMMY-chat-response",
      });
      await window.adactive.connect({
        token: draft.token,
        model: "gemini-2.5-flash",
        consent: true,
      });
    });
    assert.equal((await native()).bounds.height,64);
    await page.screenshot({path:'artifacts/onboarding-model-first.png'});
    const original = (await native()).bounds;
    async function send(mode, draft) {
      await app.evaluate((_e,mode) => { globalThis.chatMock.mode=mode; globalThis.chatMock.release=null; },mode);
      await page.locator('#composer').fill(draft);
      await page.locator('#send').click();
      await page.waitForFunction(() => document.querySelector('#chat-panel').getAttribute('aria-busy')==='true');
      await app.evaluate(async () => { while(!globalThis.chatMock.release) await new Promise(r=>setTimeout(r,10)); });
      assert.deepEqual((await native()).bounds,original,'loading does not grow row');
      assert.equal(await page.locator('#notice').evaluate(e=>{const r=e.getBoundingClientRect();return r.height>0&&r.top>=0&&r.bottom<=innerHeight;}),true);
      await app.evaluate(()=>globalThis.chatMock.release());
      await page.waitForFunction(() => document.querySelector('#chat-panel').getAttribute('aria-busy')==='false');
      assert.deepEqual((await native()).bounds,original,'completion does not grow row');
    }
    await send('success','MOCK FIRST');
    assert.equal(app.windows().some(p=>p.url().endsWith('history.html')),false,'no unsolicited history');
    assert.equal(await page.locator('#messages').isVisible(),false);
    assert.equal(await page.locator('#history-badge').textContent(),'1');
    assert.equal(await page.locator('#composer').inputValue(),'');
    await page.screenshot({path:'artifacts/compact-reply-MOCK.png'});
    const historyOpened = app.waitForEvent("window");
    await page.locator('#history-toggle').click();
    const history = await historyOpened;
    await history.waitForURL("**/history.html");
    await history.locator('.bubble.assistant').waitFor();
    assert.match(await history.locator('#messages').textContent(),/MOCK ONLY/);
    await history.locator('.bubble.assistant button').filter({hasText:'העתקה'}).click();
    assert.match(await app.evaluate(({clipboard})=>clipboard.readText()),/MOCK ONLY/);
    await history.locator('.bubble.assistant button').filter({hasText:'צירוף'}).click();
    await page.locator('.context-chip').waitFor();
    await page.locator('.context-chip').click();
    assert.equal(await page.locator('.context-chip').count(),0);
    await history.locator('.bubble.assistant button').filter({hasText:'צירוף'}).click();
    await page.locator('.context-chip').waitFor();
    await send('long','MOCK LONG WITH CONTEXT');
    assert.equal(await page.locator('.context-chip').count(),0,'consume only on success');
    await history.waitForFunction(()=>document.querySelectorAll('.bubble.assistant').length===2);
    assert.equal(await history.locator('#messages').evaluate(e=>e.scrollHeight>e.clientHeight),true);
    await history.screenshot({path:'artifacts/history-actions-MOCK.png'});
    // Save-dialog fixture exercises exact main-side selected content; no renderer filesystem API.
    const exportPath=path.join(dir,'export.md');
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},exportPath);
    await history.locator('.bubble.assistant button').filter({hasText:'ייצוא .md'}).first().click();
    await history.waitForFunction(()=>document.querySelector('#notice').textContent==='יוצא');
    assert.match(fs.readFileSync(exportPath,'utf8'),/MOCK ONLY/);
    assert.ok(!fs.readFileSync(exportPath,'utf8').includes('PUBLIC-DUMMY'));
    const prior = await page.evaluate(()=>window.adactive.state());
    const other=await page.evaluate(()=>window.adactive.create('Other project'));
    await history.waitForFunction(()=>document.querySelector('#history-title').textContent.includes('Other project'));
    assert.equal(await history.locator('.bubble').count(),0,'no old project leakage');
    await assert.rejects(history.evaluate(arg=>window.adactive.messageAction(arg),{action:'copy',projectId:prior.project.id,messageIds:[prior.project.messages[0].id]}));
    await page.evaluate(id=>window.adactive.state(id),prior.project.id);
    await page.waitForFunction(id=>document.querySelector('#projects').value===id,prior.project.id);
    for(const mode of ['error','empty']) {
      await send(mode,'MOCK '+mode);
      assert.match(await page.locator('#notice').textContent(),mode==='empty'?/לא החזיר טקסט/:/Gemini.*429/);
      assert.equal(await page.locator('#composer').inputValue(),'MOCK '+mode);
      assert.equal(await page.locator('#notice').getAttribute('role'),'alert');
    }
    const pet=app.windows().find(p=>p.url().endsWith('pet.html'));
    await assert.rejects(pet.evaluate(()=>window.adactive.messageAction({})),/Access denied/);
    await assert.rejects(history.evaluate(()=>window.adactive.send({})),/Access denied/);
    await page.evaluate(()=>window.adactive.disconnect());
    await page.locator('#composer').fill('No model');
    await page.locator('#send').click();
    await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('חברו מודל'));
    assert.equal(await app.evaluate(()=>globalThis.chatMock.calls),4,'no live retries');
    assert.deepEqual(errors,[]);
    await app.close(); app=null;
    page=await launch();
    assert.deepEqual((await native()).bounds,original,'restart keeps compact bounds with history');
    assert.equal(await page.locator('#messages').isVisible(),false);
    const restoredOpened = app.waitForEvent("window");
    await page.locator('#history-toggle').click();
    const restored = await restoredOpened;
    await restored.waitForURL("**/history.html");
    await restored.locator('.bubble.assistant').first().waitFor();
    assert.equal(await restored.locator('.bubble.assistant').count(),2);
    console.log('PASS compact64 loading/reply/error/empty/restart; separate scroll history; per-project actions/attach/remove/consume; clipboard and export picker fixture; IPC guards; no unsolicited history; all model traffic MOCK.');
  } finally {
    if (app) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
