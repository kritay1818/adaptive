"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { WordPress } = require("../src/wordpress.cjs");

const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};
const make = (t, lookup) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-link-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new WordPress(dir, storage, {
    lookup,
    request: async () => {
      throw new Error("no network");
    },
  });
};
const pub = async () => [{ address: "93.184.216.34", family: 4 }];
const signal = () => new AbortController().signal;

test("the shortcut URL is built by main from a validated site URL", async (t) => {
  const wp = make(t, pub);
  assert.equal(
    await wp.adminPasswordsURL("https://salon.example", signal()),
    "https://salon.example/wp-admin/profile.php#application-passwords-section",
  );
  assert.equal(
    await wp.adminPasswordsURL("https://salon.example/blog/", signal()),
    "https://salon.example/blog/wp-admin/profile.php#application-passwords-section",
  );
});

test("the shortcut follows the connection rules: https only, public host, no credentials or parameters", async (t) => {
  const wp = make(t, pub);
  for (const bad of [
    "http://salon.example",
    "https://user:pw@salon.example",
    "https://salon.example/?x=1",
    "https://salon.example/#top",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.0.0.5",
    "ftp://salon.example",
    "javascript:alert(1)",
    "https://salon.example/wp-admin/../../x?y",
    "",
    "not a url",
  ])
    await assert.rejects(wp.adminPasswordsURL(bad, signal()), undefined, bad);
  // A hostname that resolves to a private address (DNS rebinding style) is refused too.
  await assert.rejects(
    make(t, async () => [{ address: "10.1.2.3", family: 4 }]).adminPasswordsURL(
      "https://salon.example",
      signal(),
    ),
  );
  await assert.rejects(
    make(t, async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.5", family: 4 },
    ]).adminPasswordsURL("https://salon.example", signal()),
  );
});

test("the connection window loads its guide screenshots locally (CSP-safe) and has the hints and shortcut", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../src/ui/wordpress.html"),
    "utf8",
  );
  assert.match(html, /img-src 'self'/);
  for (const id of [
    "wp-open-passwords",
    "wp-guide-open",
    "wp-guide",
    "guide-img",
    "guide-next",
    "guide-back",
    "guide-count",
    "wp-result-guide",
  ])
    assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /פתיחת עמוד הסיסמאות באתר שלי/);
  assert.match(html, /איך יוצרים סיסמת יישום\?/);
  assert.match(html, /לא<\/strong> סיסמת הכניסה הרגילה/);
  const js = fs.readFileSync(
    path.join(__dirname, "../src/ui/wordpress-ui.js"),
    "utf8",
  );
  for (let i = 1; i <= 4; i++)
    assert.ok(js.includes(`"help/step${i}.png"`), `step${i}`);
  assert.ok(!/https?:\/\/[^"']*\.(?:png|jpg)/.test(js), "no remote images");
});
