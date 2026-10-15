// Legacy setup UI is a TEST-ONLY fixture, not shipped in src or enabled by the app.
const fs = require("node:fs");
const path = require("node:path");
module.exports = async function setupFixture(app, page) {
  await page.waitForFunction(() => document.querySelector("#projects").value);
  const window = await app.browserWindow(page);
  await window.evaluate((w) => w.setSize(600, 640));
  const source = fs.readFileSync(
    path.join(__dirname, "fixtures/setup-renderer.js"),
    "utf8",
  );
  await window.evaluate(
    (w, source) =>
      w.webContents.executeJavaScript(`
    window.onkeydown = null;
    for (const el of document.querySelectorAll('[inert]')) el.inert = false;
    for (const el of document.querySelectorAll('button,input,select,textarea,form')) {
      el.disabled = false; el.removeAttribute('tabindex');
      el.onclick = el.onchange = el.oninput = el.onkeydown = el.onsubmit = null;
    }
    (function () { ${source}\nwindow.render = render; window.connection = connection; window.setBusy = setBusy; })();
  `),
    source,
  );
  console.log(
    "SETUP UI TEST FIXTURE injected; production setup controls stay disabled.",
  );
};
