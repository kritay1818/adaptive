const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "pet-ui-"));
  let app;
  const launch = async () => {
    app = await electron.launch({
      args: [".", `--adactive-data=${dir}`],
      cwd: path.join(__dirname, ".."),
    });
    for (let i = 0; i < 80; i++) {
      const pet = app.windows().find((w) => w.url().endsWith("pet.html"));
      if (pet) {
        await pet.waitForLoadState();
        return pet;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("No pet window");
  };
  const bounds = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith("pet.html"))
        .getBounds(),
    );
  try {
    let pet = await launch();
    assert.equal(
      await pet.locator("#pet-larger").count(),
      1,
      "visible size controls exist",
    );
    const before = await bounds();
    await pet.locator("#pet-larger").click();
    await pet.waitForFunction(() => window.innerWidth === 150);
    assert.equal((await bounds()).width, before.width + 20);
    await pet.evaluate(() => window.adactive.resizePet(9999));
    assert.equal((await bounds()).width, 260);
    await pet.evaluate(() => window.adactive.resizePet(-9999));
    assert.equal((await bounds()).width, 110);
    await pet.locator("#pet-reset").click();
    await pet.waitForFunction(() => window.innerWidth === 130);
    await pet.locator("#pet-larger").click();
    await pet.waitForFunction(() => window.innerWidth === 150);
    const sidebar = app.windows().find((w) => w.url().endsWith("index.html"));
    await assert.rejects(
      sidebar.evaluate(() => window.adactive.resizePet(200)),
      /Access denied/,
    );
    await assert.rejects(
      pet.evaluate(() => window.adactive.resizePet("large")),
      /Invalid pet size/,
    );
    await assert.rejects(
      pet.evaluate(() => window.adactive.movePet({ x: null, y: 0 })),
      /Invalid pet position/,
    );
    await sidebar.evaluate(() => window.adactive.hide());
    const visible = (suffix) =>
      app.evaluate(
        ({ BrowserWindow }, suffix) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL().endsWith(suffix))
            .isVisible(),
        suffix,
      );
    const dragStart = await bounds();
    await pet.locator("#open-chat").hover();
    await pet.mouse.down();
    await pet.mouse.move(20, 40);
    await pet.mouse.up();
    await pet.waitForTimeout(300);
    assert.notDeepEqual(
      await bounds(),
      dragStart,
      "dragging mascot moves native window",
    );
    assert.equal(await visible("index.html"), false, "drag does not open chat");
    await pet.locator("#open-chat").click();
    await pet.waitForTimeout(100);
    assert.equal(await visible("index.html"), true, "click still opens chat");
    await pet.locator("#hide-pet").click();
    await pet.waitForTimeout(100);
    assert.equal(await visible("pet.html"), false, "hide action preserved");
    const saved = await bounds();
    await app.close();
    app = null;
    pet = await launch();
    assert.deepEqual(await bounds(), saved, "layout restored after restart");
    await pet.screenshot({ path: "artifacts/pet-resizable.png" });
    console.log(
      "PASS pet UI: size controls, safe limits, reset, real pointer drag, no accidental chat, open/hide, IPC denial, invalid inputs, position/size restart persistence",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
