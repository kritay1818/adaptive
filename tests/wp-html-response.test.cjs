"use strict";
// A WordPress route that answers with a web page instead of JSON: one specific Hebrew message, the "חיבור אתר מחדש" button,
// and status / content type / page title only under the technical details.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { networkFailure, htmlResponse } = require("../src/wordpress.cjs");
const { describeError } = require("../src/errors.cjs");

const MESSAGE =
  "האתר לא החזיר תשובה תקינה — ייתכן שהאתר נמחק, לא זמין או חוסם גישה. בדקו שהכתובת נפתחת בדפדפן";
const page = (title, status = 200) =>
  htmlResponse({
    status,
    contentType: "text/html; charset=UTF-8",
    body: `<html><head><title>${title}</title></head><body>x</body></html>`,
  });

test("an HTML answer gets the specific message, the reconnect button and the technical detail", () => {
  for (const write of [false, true]) {
    const e = networkFailure(page("האתר בתחזוקה"), { write, limit: 1 });
    assert.equal(e.kind, "html");
    assert.equal(e.message, MESSAGE);
    assert.match(e.detail, /סטטוס HTTP: 200/);
    assert.match(e.detail, /text\/html/);
    assert.match(e.detail, /האתר בתחזוקה/);
    const d = describeError(e);
    assert.equal(d.message, MESSAGE);
    assert.deepEqual(d.buttons, ["wordpress"]);
    assert.match(d.tech, /text\/html/);
    assert.match(d.tech, /האתר בתחזוקה/);
    assert.ok(
      !d.message.includes("text/html"),
      "details stay out of the message",
    );
  }
});

test("the page title is plain, short text; other pages and a missing title are handled", () => {
  const long = networkFailure(page(`<b>Login</b> ${"x".repeat(300)}`), {});
  assert.doesNotMatch(long.detail, /<|>/);
  assert.ok(long.detail.length < 400);
  assert.match(
    networkFailure(
      htmlResponse({ status: 503, contentType: "text/html", body: "no title" }),
      {},
    ).detail,
    /סטטוס HTTP: 503.*\(ללא\)/,
  );
  // With a resume hint the button list keeps both.
  assert.deepEqual(
    describeError(networkFailure(page("x"), {}), { hasResume: true }).buttons,
    ["resume", "wordpress"],
  );
});

test("the button is labelled 'חיבור אתר מחדש'", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/ui/renderer.js"),
    "utf8",
  );
  assert.match(src, /wordpress: "חיבור אתר מחדש"/);
});

// ---- the deleted-site case through wp_read_site_structure (and every other route) -------------------------------------------------
const os = require("node:os");
const { Agent } = require("../src/wp-agent.cjs");
const { WordPress } = require("../src/wordpress.cjs");
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};
async function deadSite(t, answer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-dead-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let dead = false;
  const wp = new WordPress(dir, storage, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (url) => {
      const route = url.searchParams.get("rest_route") || "/";
      if (!dead && route === "/wp/v2/users/me")
        return {
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: 7 }),
        };
      return { status: 200, ...answer };
    },
  });
  await wp.connect("p", {
    site: "https://public.example",
    username: "u",
    password: "PUBLIC-DUMMY",
  });
  dead = true; // the site is deleted after it was connected
  return { agent: new Agent(wp, dir), wp };
}
test("a deleted site (any content type, HTML or empty body) gets the friendly message and button on wp_read_site_structure", async (t) => {
  const answers = {
    "JSON content type with an HTML body": {
      contentType: "application/json",
      body: "<html><head><title>This site was deleted</title></head><body>gone</body></html>",
    },
    "JSON content type with an empty body": {
      contentType: "application/json",
      body: "",
    },
    "no content type, text body": { contentType: "", body: "Site not found" },
    "HTML content type": {
      contentType: "text/html",
      body: "<title>Expired</title>",
    },
  };
  for (const [name, answer] of Object.entries(answers)) {
    const f = await deadSite(t, answer);
    const direct = await f.agent.structure
      .describe("p", AbortSignal.timeout(5000))
      .then(
        () => null,
        (e) => e,
      );
    assert.ok(direct, name);
    assert.equal(direct.kind, "html", name);
    assert.equal(direct.message, MESSAGE, name);
    assert.doesNotMatch(direct.message, /קריאת מבנה האתר נכשלה/, name);
    assert.match(direct.detail, /סטטוס HTTP: 200/, name);
    // Through the agent run, as the user meets it: the error carries the message, and the chat shows the button.
    let n = 0;
    const err = await f.agent
      .run("p", [], {
        step: async () =>
          n++ === 0
            ? {
                text: "",
                calls: [{ id: "s", name: "wp_read_site_structure", args: {} }],
              }
            : { text: "x", calls: [] },
      })
      .then(
        () => null,
        (e) => e,
      );
    assert.ok(err, `${name}: the run reports the problem`);
    const d = describeError(err);
    assert.equal(d.message, MESSAGE, name);
    assert.deepEqual(d.buttons, ["wordpress"], name);
    assert.match(d.tech, /סטטוס HTTP: 200/, name);
    if (answer.contentType)
      assert.ok(d.tech.includes(answer.contentType), name);
  }
  // The page title is in the details for an HTML body.
  const t1 = await deadSite(t, answers["JSON content type with an HTML body"]);
  const e1 = await t1.agent.structure
    .describe("p", AbortSignal.timeout(5000))
    .then(
      () => null,
      (e) => e,
    );
  assert.match(e1.detail, /This site was deleted/);
});
