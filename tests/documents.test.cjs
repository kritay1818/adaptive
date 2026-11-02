"use strict";
// Google Docs/Sheets links and attached document files. Injected transports, generated sample files, no network.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const {
  GoogleDocs,
  parseGoogleLink,
  htmlToBlocks,
  parseCsv,
  NOT_PUBLIC,
} = require("../src/google-docs.cjs");
const documents = require("../src/documents.cjs");
const { WordPress } = require("../src/wordpress.cjs");
const { Agent } = require("../src/wp-agent.cjs");

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const DOC = `https://docs.google.com/document/d/${ID}/edit?usp=sharing`;

// ---- links ---------------------------------------------------------------------------------------------------------------------
test("Google links: documents and sheets are parsed, everything else is refused", () => {
  assert.equal(
    parseGoogleLink(DOC).exportUrl,
    `https://docs.google.com/document/d/${ID}/export?format=html`,
  );
  assert.equal(
    parseGoogleLink(`https://docs.google.com/document/u/0/d/${ID}/edit`).id,
    ID,
  );
  const sheet = parseGoogleLink(
    `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123`,
  );
  assert.equal(sheet.kind, "spreadsheet");
  assert.equal(
    sheet.exportUrl,
    `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=123`,
  );
  assert.equal(
    parseGoogleLink(`https://docs.google.com/spreadsheets/d/${ID}/edit`)
      .exportUrl,
    `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`,
  );
  for (const bad of [
    "http://docs.google.com/document/d/" + ID,
    `https://evil.example/document/d/${ID}`,
    `https://docs.google.com.evil.example/document/d/${ID}`,
    `https://user:pw@docs.google.com/document/d/${ID}`,
    "https://docs.google.com/document/d/short",
    "https://docs.google.com/forms/d/" + ID,
    "https://drive.google.com/file/d/" + ID,
    "not a url",
    "",
    `https://docs.google.com:8443/document/d/${ID}`,
    `https://docs.google.com/document/d/${ID}%2F..%2F`,
  ])
    assert.throws(() => parseGoogleLink(bad), undefined, bad);
});

// ---- HTML export -> structure ----------------------------------------------------------------------------------------------------
const EXPORT_HTML = `<html><head><meta content="text/html; charset=UTF-8"><title>תפריט המסעדה</title><style>.c1{font-weight:700}.c2{font-style:italic}.c3{color:#000}</style></head>
<body class="c9 doc-content"><p class="c5 title"><span class="c3">תפריט המסעדה</span></p>
<h1 class="c7"><span class="c3">ראשונות</span></h1>
<p class="c4"><span class="c1">מרק היום</span><span class="c3"> — עגבניות &amp; בזיליקום, </span><span class="c2">חם</span></p>
<p class="c4"><span class="c3">הזמנות: </span><a class="c6" href="https://www.google.com/url?q=https://salon.example/book?x%3D1&amp;sa=D&amp;source=editors&amp;ust=1">להזמנה</a><span> או </span><a href="https://www.google.com/url?q=javascript:alert(1)&amp;sa=D">רע</a></p>
<ul class="lst-kix_a-0"><li class="c8"><p class="c4"><span>סלט יווני</span></p></li><li class="c8"><p class="c4"><span>חומוס</span></p><ul class="lst-kix_a-1"><li><p class="c4"><span>עם פול</span></p></li></ul></li></ul>
<ol class="lst-kix_b-0"><li><p class="c4"><span>שלב ראשון</span></p></li><li><p class="c4"><span>שלב שני</span></p></li></ol>
<table class="c10"><tr><td class="c11"><p class="c4"><span class="c1">מנה</span></p></td><td><p class="c4"><span class="c1">מחיר</span></p></td></tr><tr><td><p class="c4"><span>פיצה</span></p></td><td><p class="c4"><span>45 ₪</span></p></td></tr></table>
<p class="c4"><span style="overflow: hidden"><img alt="תמונת מנה" src="https://lh7-rt.googleusercontent.com/docsz/AD_4nX.abc?key=xyz" style="width: 300px"></span></p>
<p class="c4"><span><img alt="inline" src="data:image/png;base64,AAAA"></span></p>
</body></html>`;

test("the public export becomes headings, paragraphs, lists, tables, links and image URLs", () => {
  const out = htmlToBlocks(EXPORT_HTML);
  assert.equal(out.title, "תפריט המסעדה");
  const types = out.blocks.map((b) => b.t);
  assert.deepEqual(types, ["h", "h", "p", "p", "list", "list", "table", "img"]);
  assert.deepEqual(out.blocks[0], { t: "h", level: 1, text: "תפריט המסעדה" });
  assert.deepEqual(out.blocks[1], { t: "h", level: 1, text: "ראשונות" });
  assert.equal(out.blocks[2].text, "**מרק היום** — עגבניות & בזיליקום, *חם*");
  assert.equal(
    out.blocks[3].text,
    "הזמנות: [להזמנה](https://salon.example/book?x=1) או רע",
    "Google redirect links are unwrapped, javascript: links are dropped",
  );
  assert.deepEqual(out.blocks[4], {
    t: "list",
    ordered: false,
    items: [
      { text: "סלט יווני", level: 0 },
      { text: "חומוס", level: 0 },
      { text: "עם פול", level: 1 },
    ],
  });
  assert.deepEqual(out.blocks[5], {
    t: "list",
    ordered: true,
    items: [
      { text: "שלב ראשון", level: 0 },
      { text: "שלב שני", level: 0 },
    ],
  });
  assert.deepEqual(out.blocks[6], {
    t: "table",
    rows: [
      ["**מנה**", "**מחיר**"],
      ["פיצה", "45 ₪"],
    ],
  });
  assert.deepEqual(out.images, [
    {
      url: "https://lh7-rt.googleusercontent.com/docsz/AD_4nX.abc?key=xyz",
      alt: "תמונת מנה",
    },
  ]);
  assert.equal(out.skippedInlineImages, 1, "data: images are not passed on");
  assert.deepEqual(out.links, ["https://salon.example/book?x=1"]);
  assert.ok(!JSON.stringify(out).includes("javascript:"));
  const md = documents.blocksToMarkdown(out.blocks);
  assert.match(md, /^# תפריט המסעדה/);
  assert.match(md, /\| \*\*מנה\*\* \| \*\*מחיר\*\* \|/);
  assert.match(md, /!\[תמונת מנה\]\(https:\/\/lh7-rt/);
});

test("Sheets CSV: quotes, commas, newlines and limits", () => {
  const { rows, truncated } = parseCsv(
    '﻿שם,מחיר\r\n"פיצה, גדולה","45 ""₪"""\r\n"שורה\nכפולה",3\r\n',
  );
  assert.deepEqual(rows, [
    ["שם", "מחיר"],
    ["פיצה, גדולה", '45 "₪"'],
    ["שורה\nכפולה", "3"],
  ]);
  assert.equal(truncated, false);
  assert.equal(parseCsv("a\n".repeat(600)).truncated, true);
});

// ---- fetching: public / not public / redirects -------------------------------------------------------------------------------------
const publicWp = {
  publicTarget: async () => ({ address: "142.250.1.1", family: 4 }),
};
const reply = (status, headers = {}, body = "") => ({
  status,
  headers,
  body: Buffer.from(body),
});
const html = (body) =>
  reply(200, { "content-type": "text/html; charset=utf-8" }, body);
function docsWith(script) {
  const seen = [];
  const get = async (url, opts) => {
    seen.push(url.href);
    return script(url, seen.length - 1, opts);
  };
  return { docs: new GoogleDocs(publicWp, { get }), seen };
}
const signal = () => new AbortController().signal;

test("a public doc is fetched through the export redirect and parsed", async () => {
  const { docs, seen } = docsWith((url, hop) =>
    hop === 0
      ? reply(307, {
          location:
            "https://doc-0c-6s-docs.googleusercontent.com/export/abc?x=1",
        })
      : html(EXPORT_HTML),
  );
  const doc = await docs.read(DOC, signal());
  assert.equal(doc.source, "google-docs");
  assert.equal(doc.blocks[0].text, "תפריט המסעדה");
  assert.deepEqual(seen, [
    `https://docs.google.com/document/d/${ID}/export?format=html`,
    "https://doc-0c-6s-docs.googleusercontent.com/export/abc?x=1",
  ]);
});

test("a sheet is returned as a table", async () => {
  const { docs, seen } = docsWith((url, hop) =>
    hop === 0
      ? reply(307, {
          location: "https://doc-1-sheets.googleusercontent.com/export/x",
        })
      : reply(200, { "content-type": "text/csv" }, "a,b\n1,2\n"),
  );
  const out = await docs.read(
    `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=5`,
    signal(),
  );
  assert.equal(out.source, "google-sheets");
  assert.deepEqual(out.blocks[0].rows, [
    ["a", "b"],
    ["1", "2"],
  ]);
  assert.ok(seen[0].endsWith("export?format=csv&gid=5"));
});

test("a document that is not public gives the clear Hebrew message", async () => {
  const cases = [
    () =>
      reply(302, {
        location: "https://accounts.google.com/ServiceLogin?continue=x",
      }),
    () => reply(401),
    () => reply(403),
    () =>
      html(
        "<html><head><title>Sign in - Google Accounts</title></head><body><a href='https://accounts.google.com/signin/v2'>Sign in</a></body></html>",
      ),
  ];
  for (const respond of cases) {
    const { docs } = docsWith(respond);
    await assert.rejects(
      docs.read(DOC, signal()),
      (e) => e.message === NOT_PUBLIC && e.docs === true,
    );
  }
  assert.equal(
    NOT_PUBLIC,
    "המסמך לא פתוח לצפייה. בגוגל דוקס: שיתוף ← כל מי שיש לו את הקישור ← צופה",
  );
  const { docs: missing } = docsWith(() => reply(404));
  await assert.rejects(missing.read(DOC, signal()), /לא נמצא/);
});

test("the export redirect may only go to https *.googleusercontent.com", async () => {
  for (const location of [
    "https://evil.example/doc",
    "http://doc-1.googleusercontent.com/x",
    "https://googleusercontent.com/x",
    "https://doc-1.googleusercontent.com.evil.example/x",
    "https://user:pw@doc-1.googleusercontent.com/x",
    "https://doc-1.googleusercontent.com:8443/x",
    "https://docs.google.com/other",
    "https://drive.google.com/x",
    "ftp://doc-1.googleusercontent.com/x",
    "//evil.example/x",
  ]) {
    const { docs, seen } = docsWith(() => reply(307, { location }));
    await assert.rejects(
      docs.read(DOC, signal()),
      /ההפניה לכתובת לא מורשית נחסמה/,
      location,
    );
    assert.equal(
      seen.length,
      1,
      "the blocked target is never requested: " + location,
    );
  }
  // Allowed target, then a second redirect to a bad host is blocked too; and the hop count is bounded.
  const { docs: chained, seen } = docsWith((url, hop) =>
    reply(307, {
      location:
        hop === 0
          ? "https://doc-1.googleusercontent.com/a"
          : "https://evil.example/b",
    }),
  );
  await assert.rejects(chained.read(DOC, signal()), /נחסמה/);
  assert.equal(seen.length, 2);
  const { docs: loop } = docsWith((url, hop) =>
    reply(307, { location: `https://doc-${hop}.googleusercontent.com/x` }),
  );
  await assert.rejects(loop.read(DOC, signal()), /נחסמה|הפניות/);
});

test("every hop passes the public-address check, and oversized documents are refused", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-"));
  try {
    const storage = {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    };
    const wp = new WordPress(dir, storage, {
      lookup: async () => [{ address: "10.0.0.7", family: 4 }],
      request: async () => {
        throw Error("no network");
      },
    });
    let called = false;
    const docs = new GoogleDocs(wp, {
      get: async () => {
        called = true;
        return html("");
      },
    });
    await assert.rejects(docs.read(DOC, signal()), /IPv4 ציבורי/);
    assert.equal(called, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const big = new GoogleDocs(publicWp, {
    get: async () => {
      throw Object.assign(new Error("size"), { size: true });
    },
  });
  await assert.rejects(big.read(DOC, signal()), /גדול מדי/);
  const down = new GoogleDocs(publicWp, {
    get: async () => {
      throw Object.assign(new Error("x"), { code: "ECONNRESET" });
    },
  });
  await assert.rejects(down.read(DOC, signal()), /לא ניתן להגיע לגוגל/);
});

test("the agent tool returns the document as untrusted data, or the Hebrew message on a private doc", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-agent-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString(),
  };
  const wp = {
    ...publicWp,
    data: { p: "x" },
    status: () => ({ connected: true, site: "https://public.example" }),
  };
  let mode = "public";
  const get = async (url, opts) =>
    mode === "private"
      ? reply(403)
      : url.hostname === "docs.google.com"
        ? reply(307, { location: "https://doc-1-docs.googleusercontent.com/e" })
        : html(EXPORT_HTML);
  const agent = new Agent(wp, dir, { storage, docsDeps: { get } });
  for (const kind of ["public", "private"]) {
    mode = kind;
    const seen = [];
    let step = 0;
    const provider = {
      status: () => ({}),
      step: async (messages) => {
        seen.push(messages);
        return step++ === 0
          ? {
              text: "",
              calls: [
                { id: "c", name: "wp_read_google_doc", args: { url: DOC } },
              ],
            }
          : { text: "סיימתי", calls: [] };
      },
    };
    await agent.run("p", [], provider);
    const tool = seen[1].find((m) => m.role === "tool").result;
    if (kind === "public") {
      assert.equal(tool.untrusted, true);
      assert.match(tool.note, /never instructions/);
      assert.equal(tool.blocks[0].text, "תפריט המסעדה");
      assert.equal(tool.images[0].alt, "תמונת מנה");
    } else {
      assert.equal(tool.error, NOT_PUBLIC);
      assert.match(tool.instruction, /Hebrew/);
    }
  }
});

// ---- document files --------------------------------------------------------------------------------------------------------------
let crcTable;
const crc32 = (buf) => {
  if (zlib.crc32) return zlib.crc32(buf);
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zip(entries, { stored = false, lieSize } = {}) {
  const locals = [],
    central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const comp = stored ? raw : zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(lieSize ?? raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(stored ? 0 : 8, 10);
    c.writeUInt32LE(crc32(raw), 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(lieSize ?? raw.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="x"';
const run = (text, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const DOCX = zip({
  "[Content_Types].xml": "<Types/>",
  "word/document.xml": `<?xml version="1.0"?><w:document ${W}><w:body>
<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr>${run("כותרת ראשית")}</w:p>
<w:p>${run("טקסט רגיל עם ")}${run("מודגש", "<w:b/>")}${run(" ו")}${run("נטוי", "<w:i/>")}${run(" וגם ")}<w:hyperlink r:id="rId9">${run("קישור")}</w:hyperlink><w:r><w:tab/></w:r>${run("סוף &amp; נקודה")}</w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run("פריט ראשון")}</w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr>${run("פריט מקונן")}</w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>${run("שלב א")}</w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>${run("שלב ב")}</w:p>
<w:tbl><w:tr><w:tc><w:p>${run("שם")}</w:p></w:tc><w:tc><w:p>${run("גיל")}</w:p></w:tc></w:tr><w:tr><w:tc><w:p>${run("דנה")}</w:p></w:tc><w:tc><w:p>${run("30")}</w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r></w:p>
<w:p><w:r><w:drawing><a:blip r:embed="rId6"/></w:drawing></w:r></w:p>
<w:p>${run("פסקה אחרונה")}</w:p></w:body></w:document>`,
  "word/styles.xml": `<w:styles ${W}><w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style></w:styles>`,
  "word/numbering.xml": `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
  "word/_rels/document.xml.rels": `<Relationships><Relationship Id="rId9" Type="x/hyperlink" Target="https://example.com/page?a=1&amp;b=2" TargetMode="External"/><Relationship Id="rId5" Type="x/image" Target="media/image1.png"/><Relationship Id="rId6" Type="x/image" Target="media/image2.emf"/></Relationships>`,
  "word/media/image1.png": png,
  "word/media/image2.emf": Buffer.from("EMF-not-a-raster-image-file"),
});

test(".docx: headings, formatting, links, lists, tables and images are extracted", () => {
  const out = documents.extractDocx(DOCX);
  assert.deepEqual(
    out.blocks.map((b) => b.t),
    ["h", "p", "list", "list", "table", "img", "p"],
  );
  assert.deepEqual(out.blocks[0], { t: "h", level: 1, text: "כותרת ראשית" });
  assert.equal(
    out.blocks[1].text,
    "טקסט רגיל עם **מודגש** ו*נטוי* וגם [קישור](https://example.com/page?a=1&b=2) סוף & נקודה",
  );
  assert.deepEqual(out.blocks[2], {
    t: "list",
    ordered: false,
    items: [
      { text: "פריט ראשון", level: 0 },
      { text: "פריט מקונן", level: 1 },
    ],
  });
  assert.deepEqual(out.blocks[3], {
    t: "list",
    ordered: true,
    items: [
      { text: "שלב א", level: 0 },
      { text: "שלב ב", level: 0 },
    ],
  });
  assert.deepEqual(out.blocks[4].rows, [
    ["שם", "גיל"],
    ["דנה", "30"],
  ]);
  assert.equal(out.blocks[5].file, "word/media/image1.png");
  assert.equal(out.blocks[6].text, "פסקה אחרונה");
  assert.equal(
    out.images.length,
    1,
    "unsupported image formats (emf) are dropped",
  );
  assert.equal(out.images[0].mime, "image/png");
  assert.ok(out.images[0].bytes.equals(png));
  assert.match(
    documents.blocksToMarkdown(out.blocks),
    /^# כותרת ראשית\n\nטקסט רגיל/,
  );
});

test("zip bombs and corrupt archives are refused", () => {
  assert.throws(
    () => documents.readZip(Buffer.from("not a zip at all, just bytes")),
    /ZIP/,
  );
  assert.throws(
    () =>
      documents.readZip(
        zip({ "word/document.xml": "x" }, { lieSize: 400 * 1024 * 1024 }),
      ),
    /יותר מדי נתונים|גדול מדי/,
  );
  const bomb = zip(
    { "word/document.xml": Buffer.alloc(70 * 1024 * 1024, 0) },
    { lieSize: 20 },
  );
  assert.throws(
    () => documents.readZip(bomb).read("word/document.xml"),
    /פגום|חשוד|גדול/,
  );
  const truncated = DOCX.subarray(0, DOCX.length - 40);
  assert.throws(() => documents.readZip(truncated));
});

test("file types come from magic bytes and must agree with the extension", async () => {
  const pdfBytes = makePdf("Hello");
  assert.equal(documents.detectDocument(DOCX, "a.docx"), "docx");
  assert.equal(documents.detectDocument(pdfBytes, "a.pdf"), "pdf");
  assert.equal(
    documents.detectDocument(Buffer.from("# כותרת\nטקסט"), "a.md"),
    "md",
  );
  assert.equal(
    documents.detectDocument(Buffer.from("שלום\n\nעולם"), "a.txt"),
    "txt",
  );
  assert.equal(
    documents.detectDocument(DOCX, "a.pdf"),
    null,
    "docx content named .pdf",
  );
  assert.equal(
    documents.detectDocument(pdfBytes, "a.docx"),
    null,
    "pdf content named .docx",
  );
  assert.equal(documents.detectDocument(DOCX, "a.txt"), null, "zip named .txt");
  assert.equal(
    documents.detectDocument(pdfBytes, "a.md"),
    null,
    "pdf named .md",
  );
  assert.equal(
    documents.detectDocument(zip({ "other.xml": "x" }), "a.docx"),
    null,
    "a zip without word/document.xml",
  );
  assert.equal(
    documents.detectDocument(Buffer.from("ab\x00cd"), "a.txt"),
    null,
    "binary data in a .txt",
  );
  assert.equal(
    documents.detectDocument(
      Buffer.from([0x80, 0x81, 0xff, 0xfe, 0x41]),
      "a.txt",
    ),
    null,
  );
  assert.equal(
    documents.detectDocument(Buffer.from("MZ" + "x".repeat(50)), "a.exe"),
    null,
  );
  assert.equal(
    documents.detectDocument(
      Buffer.alloc(documents.DOC_LIMIT + 1, 65),
      "a.txt",
    ),
    null,
    "over 20 MB",
  );
  await assert.rejects(
    documents.extractDocument(DOCX, "a.pdf"),
    /אינו נתמך|תואם/,
  );
});

function makePdf(text) {
  const objs = [];
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  objs.push(
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  );
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

test(".pdf text is extracted; broken or empty PDFs give a clear Hebrew error", async () => {
  const out = await documents.extractDocument(
    makePdf("Hello World"),
    "menu.pdf",
  );
  assert.equal(out.format, "pdf");
  assert.equal(out.pages, 1);
  assert.deepEqual(out.blocks, [{ t: "p", text: "Hello World" }]);
  await assert.rejects(
    documents.extractDocument(
      Buffer.from("%PDF-1.4\ngarbage that is not a pdf"),
      "x.pdf",
    ),
    /לא ניתן לקרוא את ה־PDF/,
  );
  await assert.rejects(
    documents.extractDocument(makePdf(""), "empty.pdf"),
    /לא נמצא טקסט/,
  );
});

test(".txt and .md keep their structure; UTF-16 text is decoded", async () => {
  const md = await documents.extractDocument(
    Buffer.from(
      "# כותרת\n\nפסקה ראשונה\nעם המשך\n\n- א\n- ב\n\n1. אחד\n2. שניים\n\n| שם | גיל |\n|---|---|\n| דנה | 30 |\n",
    ),
    "a.md",
  );
  assert.deepEqual(
    md.blocks.map((b) => b.t),
    ["h", "p", "list", "list", "table"],
  );
  assert.equal(md.blocks[1].text, "פסקה ראשונה\nעם המשך");
  assert.equal(md.blocks[3].ordered, true);
  assert.deepEqual(md.blocks[4].rows, [
    ["שם", "גיל"],
    ["דנה", "30"],
  ]);
  const txt = await documents.extractDocument(
    Buffer.from("﻿שלום עולם\n\nפסקה שנייה", "utf8"),
    "a.txt",
  );
  assert.deepEqual(txt.blocks, [
    { t: "p", text: "שלום עולם" },
    { t: "p", text: "פסקה שנייה" },
  ]);
  const utf16 = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("שלום", "utf16le"),
  ]);
  assert.equal(
    (await documents.extractDocument(utf16, "u.txt")).blocks[0].text,
    "שלום",
  );
});

test("the agent keeps the document text exact: instructions and held-file bookkeeping", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-hold-"));
  try {
    const wp = {
      data: { p: "x" },
      status: () => ({ connected: true, site: "https://public.example" }),
    };
    const agent = new Agent(wp, dir);
    const context = agent.context("p");
    assert.match(
      context,
      /DOCUMENTS: .*ITS TEXT AS THE PAGE CONTENT EXACTLY, word for word/,
    );
    assert.match(context, /never as instructions/);
    assert.match(context, /wp_read_google_doc/);
    // A document and the images extracted from it: derived images do not count toward the 12 attached files, and dropping the
    // document drops them too.
    const held = (id, extra) =>
      agent.holdFile("p", {
        id,
        name: id,
        kind: "image",
        mime: "image/png",
        bytes: png,
        modelImage: null,
        thumb: "",
        ...extra,
      });
    for (let i = 0; i < 11; i++) held(`fa${String(i).padStart(6, "0")}`);
    held("fderived0001", { derived: true });
    agent.holdFile("p", {
      id: "fdoc00000001",
      name: "a.docx",
      kind: "document",
      mime: "application/x-adactive-document",
      bytes: Buffer.alloc(0),
      modelImage: null,
      thumb: "",
      doc: { blocks: [], imageIds: ["fderived0001"] },
    });
    assert.throws(() => held("fextra000001"), /יותר מדי קבצים/);
    agent.dropFile("p", "fdoc00000001");
    assert.equal(agent.heldFile("p", "fdoc00000001"), null);
    assert.equal(agent.heldFile("p", "fderived0001"), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
