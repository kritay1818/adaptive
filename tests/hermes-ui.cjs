"use strict";
// UI integration against an explicitly labelled protocol mock, never a provider.
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
(async () => {
  const root = fs.mkdtempSync(
    path.join(process.env.TMPDIR || os.tmpdir(), "pet-hermes-ui-"),
  );
  const launcher = path.join(root, "hermes-protocol-mock");
  fs.copyFileSync(
    path.join(__dirname, "fixtures/hermes-protocol-mock.cjs"),
    launcher,
  );
  fs.chmodSync(launcher, 0o700);
  let app;
  try {
    app = await electron.launch({
      args: [".", `--adactive-data=${root}/data`],
      cwd: path.join(__dirname, ".."),
    });
    let page;
    for (let i = 0; i < 40; i++) {
      page = app.windows().find((w) => w.url().endsWith("index.html"));
      if (page) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await page.waitForFunction(() => document.querySelector("#projects").value);
    await page.locator("#connection").click();
    await page.locator("#backend").selectOption("hermes");
    assert.equal(await page.locator("#confirm-connect").isDisabled(), false);
    assert.equal(
      await page.locator("#confirm-connect").innerText(),
      "התחלת הגדרה",
    );
    await page.locator("#confirm-connect").click();
    assert.equal(await page.locator("#hermes-admin").getAttribute("open"), "");
    await app.evaluate(
      ({ dialog }, { launcher, root }) => {
        dialog.showOpenDialog = async (_window, options) => ({
          canceled: false,
          filePaths: [options.properties[0] === "openFile" ? launcher : root],
        });
      },
      { launcher, root },
    );
    await page.locator("#pick-hermes-executable").click();
    await page.waitForFunction(
      (value) => document.querySelector("#hermes-executable").value === value,
      launcher,
    );
    await page.locator("#hermes-profile").fill("mock-only");
    await page.locator("#pick-hermes-workspace").click();
    await page.waitForFunction(
      (value) => document.querySelector("#hermes-workspace").value === value,
      root,
    );
    assert.equal(await page.locator("#confirm-connect").isDisabled(), false);
    assert.equal(
      await page.locator("#confirm-connect").innerText(),
      "התחלת הגדרה",
    );
    // Complete fields without consent must only focus consent, never launch.
    await page.locator("#confirm-connect").click();
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "hermes-ack",
    );
    assert.equal(await page.locator("#hermes-ack").isChecked(), false);
    assert.equal(await page.locator("#connect-error").innerText(), "");
    assert.equal(
      (await page.evaluate(() => window.adactive.state())).connection.connected,
      false,
    );
    assert.equal(
      fs.existsSync(path.join(root, "data/hermes-state.json")),
      false,
    );
    await page.locator("#hermes-ack").check();
    assert.equal(await page.locator("#confirm-connect").innerText(), "חיבור");
    // Changing the administrator's selection invalidates the unsaved attestation.
    await page.locator("#hermes-profile").fill("another-profile");
    assert.equal(await page.locator("#hermes-ack").isChecked(), false);
    assert.equal(await page.locator("#confirm-connect").isDisabled(), false);
    assert.equal(
      await page.locator("#confirm-connect").innerText(),
      "התחלת הגדרה",
    );
    await page.locator("#hermes-profile").fill("mock-only");
    assert.equal(
      await page.locator("#hermes-executable").getAttribute("readonly"),
      "",
    );
    assert.equal(
      await page.locator("#hermes-workspace").getAttribute("readonly"),
      "",
    );
    // Cancel from the OS dialog leaves the draft untouched.
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await page.locator("#pick-hermes-workspace").click();
    assert.equal(await page.locator("#hermes-workspace").inputValue(), root);
    await page.locator("#hermes-ack").check();
    await page.screenshot({ path: "artifacts/onboarding-admin.png" });
    await page.locator("#confirm-connect").click();
    await page.locator("#connect-dialog").waitFor({ state: "hidden" });
    assert.match(
      await page.locator("#connection-status").innerText(),
      /Hermes/,
    );
    await page.locator("#composer").fill("PROTOCOL MOCK ONLY permission");
    await page.locator("#send").click();
    await page.locator("#permission-dialog").waitFor({ state: "visible" });
    assert.match(await page.locator("#permission-detail").innerText(), /MOCK/);
    assert.match(
      await page.locator(".bubble.assistant").innerText(),
      /זרם מדומה/,
    );
    await page.locator("#permission-allow").click();
    await page.waitForFunction(() => !document.querySelector("#send").disabled);
    assert.match(
      await page.locator(".bubble.assistant").innerText(),
      /allow_once/,
    );
    assert.doesNotMatch(
      await page.locator("#notice").innerText(),
      /rollback|מצב תור/,
    );
    assert.equal(await page.locator("#hermes-model option").count(), 1);
    await page.locator("#composer").fill("PROTOCOL MOCK ONLY deny");
    await page.locator("#send").click();
    await page.locator("#permission-dialog").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#send").disabled);
    assert.match(
      await page.locator(".bubble.assistant").last().innerText(),
      /cancelled/,
    );
    await page.locator("#composer").fill("PROTOCOL MOCK ONLY cancel");
    await page.locator("#send").click();
    await page.waitForFunction(() =>
      document.querySelector("#tool-activity").textContent.includes("MOCK"),
    );
    await page.locator("#stop-hermes").click();
    await page.waitForFunction(() => !document.querySelector("#send").disabled);
    assert.equal(
      (await page.evaluate(() => window.adactive.state())).project.turn,
      "cancelled",
    );
    const pet = app.windows().find((w) => w.url().endsWith("pet.html"));
    assert.match(
      await pet.evaluate(() =>
        window.adactive.permissionHermes({}).catch((e) => e.message),
      ),
      /Access denied/,
    );
    await page.screenshot({ path: "artifacts/hermes-protocol-mock.png" });
    assert.match(
      await pet.evaluate(() =>
        window.adactive.discoverHermes().catch((e) => e.message),
      ),
      /Access denied/,
    );
    assert.match(
      await pet.evaluate(() =>
        window.adactive.pickHermesPath("workspace").catch((e) => e.message),
      ),
      /Access denied/,
    );
    assert.match(
      await page.evaluate(() =>
        window.adactive.pickHermesPath("unvalidated").catch((e) => e.message),
      ),
      /Invalid picker/,
    );
    // Restart only this test's isolated app, never the user's running instance.
    await app.close();
    app = await electron.launch({
      args: [".", `--adactive-data=${root}/data`],
      cwd: path.join(__dirname, ".."),
    });
    page = await app.firstWindow();
    for (let i = 0; i < 40; i++) {
      page = app.windows().find((w) => w.url().endsWith("index.html"));
      if (page) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await page.waitForFunction(() => document.querySelector("#projects").value);
    await page.locator("#connection").click();
    assert.equal(
      await page.locator("#hermes-admin").getAttribute("open"),
      null,
    );
    assert.match(
      await page.locator("#hermes-status").innerText(),
      /ההגדרה מוכנה/,
    );
    assert.equal(await page.locator("#hermes-ack").isChecked(), false);
    assert.equal(await page.locator("#confirm-connect").isDisabled(), false);
    await page.screenshot({ path: "artifacts/onboarding-ready.png" });
    await page.locator("#confirm-connect").click();
    await page.locator("#connect-dialog").waitFor({ state: "hidden" });
    assert.equal(
      (await page.evaluate(() => window.adactive.state())).connection.connected,
      true,
    );
    // A changed draft cannot reuse the saved approval.
    await page.locator("#connection").click();
    await page.locator("#hermes-admin summary").click();
    await page.locator("#hermes-profile").fill("not-configured");
    assert.equal(await page.locator("#confirm-connect").isDisabled(), false);
    assert.equal(
      await page.locator("#confirm-connect").innerText(),
      "התחלת הגדרה",
    );
    await page.keyboard.press("Escape");
    await page.locator("#connect-dialog").waitFor({ state: "hidden" });
    // Missing installation: failed reconnect is plain-language, details stay collapsed.
    await page.evaluate(async () => render(await window.adactive.state()));
    await page.locator("#connection").click();
    await page.locator("#disconnect").click();
    await page.locator("#cancel-connect").click();
    fs.unlinkSync(launcher);
    await page.locator("#connection").click();
    await page.locator("#confirm-connect").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#connect-error")
        .textContent.includes("פנו לאיש המחשבים"),
    );
    assert.equal(
      await page.locator("#hermes-admin").getAttribute("open"),
      null,
    );
    assert.doesNotMatch(
      await page.locator("#connect-dialog").innerText(),
      /ENOENT|OAuth|inference|sandbox|allowlists/,
    );
    assert.equal(await page.locator("#confirm-connect").isDisabled(), false);
    assert.equal(
      await page.locator("#confirm-connect").innerText(),
      "התחלת הגדרה",
    );
    await page.screenshot({ path: "artifacts/onboarding-error.png" });
    await page.keyboard.press("Escape");
    await page.locator("#connect-dialog").waitFor({ state: "hidden" });
    console.log(
      "PASS Hermes Electron PROTOCOL MOCK ONLY: real child/IPC, explicit settings, partial text, once-only permission, Escape deny, cancel, advertised models, pet IPC denied. No real inference.",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
