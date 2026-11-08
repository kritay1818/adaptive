"use strict";
// A pasted Google Docs link always goes to the document tool: any docs.google.com/document/d/<ID>/... form (tab, heading,
// /edit, /view, usp=sharing, /u/0/), a tab link reads that tab. The import and design-reference tools refuse Google links with
// a message that points to the document tool, before any cost question. URL errors name their own context, and a tool input
// error goes back to the model as a tool result instead of ending the run.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Agent, argumentsFor } = require("../src/wp-agent.cjs");
const { WordPress } = require("../src/wordpress.cjs");
const {
  GoogleDocs,
  parseGoogleLink,
  googleDocLink,
} = require("../src/google-docs.cjs");

const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};
const DOC_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
// The link from the client bug report (tab and heading included).
const LINK = `https://docs.google.com/document/d/${DOC_ID}/edit?tab=t.0#heading=h.xxxxxxxx`;
const HTML =
  '<html><head><title>x</title></head><body class="c1"><h1 class="c2">כותרת ראשית</h1><p class="c3"><span>פסקה ראשונה</span></p></body></html>';

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-docs-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wp = new WordPress(dir, storage, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (url) => {
      const route = url.searchParams.get("rest_route") || "/";
      if (route === "/wp/v2/users/me")
        return {
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: 7 }),
        };
      throw Error(`Unexpected mock route ${route}`);
    },
  });
  await wp.connect("p", {
    site: "https://public.example",
    username: "fixture",
    password: "PUBLIC-DUMMY",
  });
  const agent = new Agent(wp, dir);
  const fetched = [];
  agent.docs = new GoogleDocs(wp, {
    get: async (url) => {
      fetched.push(url.href);
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: Buffer.from(HTML),
      };
    },
  });
  return { agent, wp, fetched };
}
async function run(agent, name, args) {
  let seen,
    n = 0;
  const result = await agent.run("p", [], {
    step: async (messages) => {
      if (n++ === 0) return { text: "", calls: [{ id: "r", name, args }] };
      seen = messages.filter((m) => m.role === "tool").at(-1).result;
      return { text: "סיימתי", calls: [] };
    },
  });
  return { seen, result };
}

test("every Google Docs link form is accepted; a tab link reads that tab", () => {
  const ok = (url, tab = null) => {
    const p = parseGoogleLink(url);
    assert.equal(p.kind, "document", url);
    assert.equal(p.id, DOC_ID, url);
    assert.equal(p.tab, tab, url);
    assert.ok(
      p.exportUrl.startsWith(
        `https://docs.google.com/document/d/${DOC_ID}/export?format=html`,
      ),
    );
    return p;
  };
  assert.equal(ok(LINK, "t.0").exportUrl.endsWith("&tab=t.0"), true);
  ok(`https://docs.google.com/document/d/${DOC_ID}/edit`);
  ok(`https://docs.google.com/document/d/${DOC_ID}/view`);
  ok(`https://docs.google.com/document/d/${DOC_ID}/preview`);
  ok(`https://docs.google.com/document/d/${DOC_ID}`);
  ok(`https://docs.google.com/document/d/${DOC_ID}/edit?usp=sharing`);
  ok(`https://docs.google.com/document/d/${DOC_ID}/edit#heading=h.abc123`);
  ok(`https://docs.google.com/document/u/0/d/${DOC_ID}/edit`);
  ok(
    `https://docs.google.com/document/u/1/d/${DOC_ID}/edit?tab=t.k7d2m9x1q&usp=sharing#heading=h.q`,
    "t.k7d2m9x1q",
  );
  // A bad tab value is ignored (the whole document is read), never put in the request.
  assert.equal(
    ok(`https://docs.google.com/document/d/${DOC_ID}/edit?tab=../x`).tab,
    null,
  );
  // Sheets keep working; Drive is explained.
  assert.equal(
    parseGoogleLink(
      `https://docs.google.com/spreadsheets/d/${DOC_ID}/edit#gid=5`,
    ).gid,
    "5",
  );
  assert.throws(
    () => parseGoogleLink(`https://drive.google.com/file/d/${DOC_ID}/view`),
    /Google Drive/,
  );
  assert.throws(
    () => parseGoogleLink("https://example.com/document/d/" + DOC_ID),
    /docs.google.com/,
  );
});

test("the exact link with tab and heading is read by wp_read_google_doc (tab in the export request)", async (t) => {
  const f = await fixture(t);
  const { seen, result } = await run(f.agent, "wp_read_google_doc", {
    url: LINK,
  });
  assert.ok(!seen.error, seen.error);
  assert.equal(seen.source, "google-docs");
  assert.equal(seen.tab, "t.0");
  assert.ok(seen.blocks.length >= 2);
  assert.equal(f.fetched.length, 1);
  assert.equal(
    f.fetched[0],
    `https://docs.google.com/document/d/${DOC_ID}/export?format=html&tab=t.0`,
  );
  assert.match(result.text, /^סיימתי/);
  // Without a tab the whole document is requested.
  const g = await fixture(t);
  await run(g.agent, "wp_read_google_doc", {
    url: `https://docs.google.com/document/d/${DOC_ID}/edit?usp=sharing`,
  });
  assert.equal(
    g.fetched[0],
    `https://docs.google.com/document/d/${DOC_ID}/export?format=html`,
  );
});

test("wp_read_import_site refuses Google links: a tool result that names the document tool, no cost question, the run goes on", async (t) => {
  const f = await fixture(t);
  const { seen, result } = await run(f.agent, "wp_read_import_site", {
    url: LINK,
  });
  assert.match(seen.error, /זה מסמך Google Docs — השתמשו ב-wp_read_google_doc/);
  assert.doesNotMatch(JSON.stringify(seen), /נדרשת כתובת תמונה/);
  // The model continued (second step ran); there was no "continue?" question and no pause.
  assert.match(result.text, /^סיימתי/);
  assert.doesNotMatch(result.text, /להמשיך\?|BTN/);
  assert.equal(f.agent.pendingConfirm.has("p"), false);
  assert.equal(f.fetched.length, 0, "nothing was fetched");
  // Sheets, Drive and the design-reference tool too.
  const sheet = await run(f.agent, "wp_read_import_site", {
    url: `https://docs.google.com/spreadsheets/d/${DOC_ID}/edit#gid=0`,
  });
  assert.match(sheet.seen.error, /Google Sheets — השתמשו ב-wp_read_google_doc/);
  const drive = await run(f.agent, "wp_read_import_site", {
    url: `https://drive.google.com/file/d/${DOC_ID}/view`,
  });
  assert.match(drive.seen.error, /Google Drive/);
  assert.match(drive.seen.error, /wp_read_google_doc/);
  const ref = await run(f.agent, "wp_read_design_reference", { url: LINK });
  assert.match(ref.seen.error, /השתמשו ב-wp_read_google_doc/);
  // continue:true with a Google url is refused as well, and ordinary sites still pass validation (a #fragment is dropped).
  assert.throws(
    () => argumentsFor("wp_read_import_site", { url: LINK, continue: true }),
    /wp_read_google_doc/,
  );
  assert.doesNotThrow(() =>
    argumentsFor("wp_read_import_site", {
      url: "https://example.com/page#section",
    }),
  );
  assert.equal(googleDocLink("https://example.com/"), null);
  assert.equal(googleDocLink("not a url"), null);
});

test("URL errors say what is wrong in their own context; the image message appears only for image uploads", async (t) => {
  const f = await fixture(t);
  const pageErrors = [
    ["http://example.com/", /https/],
    ["https://user:pw@example.com/", /שם משתמש/],
    ["not a url", /כתובת תקינה/],
    ["https://example.com/a b", /תווים אסורים|כתובת תקינה/],
    ["https://127.0.0.1/", /./],
  ];
  for (const [url, re] of pageErrors) {
    const { seen, result } = await run(f.agent, "wp_read_import_site", { url });
    assert.match(seen.error, re, url);
    assert.match(seen.error, /כתובת האתר לייבוא|כתובת/, url);
    assert.doesNotMatch(
      seen.error,
      /תמונה/,
      `${url}: no image wording for a site address`,
    );
    assert.match(result.text, /^סיימתי/, "the run went on");
  }
  const ref = await run(f.agent, "wp_read_design_reference", {
    url: "http://example.com/",
  });
  assert.match(ref.seen.error, /אתר ההשראה|https/);
  assert.doesNotMatch(ref.seen.error, /תמונה/);
  // An image upload with a bad address keeps the image wording (and is also a tool result, not the end of the run).
  const img = await run(f.agent, "wp_prepare_upload_image", {
    url: "https://example.com/a.png#frag",
    fileName: "a.png",
    alt: "x",
  });
  assert.match(img.seen.error, /תמונה/);
  assert.match(img.result.text, /^סיימתי/);
});

test("a tool input error never ends the run with 'המשימה נעצרה באמצע'", async (t) => {
  const f = await fixture(t);
  // The model keeps trying a bad import address, then switches tools: every step is a result, the run completes.
  let n = 0;
  const seen = [];
  const result = await f.agent.run("p", [], {
    step: async (messages) => {
      const last = messages.filter((m) => m.role === "tool").at(-1)?.result;
      if (last) seen.push(last);
      n++;
      if (n === 1)
        return {
          text: "",
          calls: [
            { id: "a", name: "wp_read_import_site", args: { url: LINK } },
          ],
        };
      if (n === 2)
        return {
          text: "",
          calls: [{ id: "b", name: "wp_read_google_doc", args: { url: LINK } }],
        };
      return { text: "בניתי מהמסמך", calls: [] };
    },
  });
  assert.match(result.text, /^בניתי מהמסמך/);
  assert.match(seen[0].error, /wp_read_google_doc/);
  assert.equal(seen[1].source, "google-docs");
});
