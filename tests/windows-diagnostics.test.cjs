"use strict";
// Diagnostics and Windows-related robustness: no network, injected transports.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const diag = require("../src/diag.cjs");
const {
  normalizeText,
  sameText,
  normSame,
  describeMismatch,
  mismatchDetail,
} = require("../src/diff.cjs");
const { WordPress, networkFailure } = require("../src/wordpress.cjs");
const { Agent } = require("../src/wp-agent.cjs");

// ---- diagnostic log ------------------------------------------------------------------------------------------------------
test("the diagnostic log keeps 200 events, redacts secrets and truncates long text", () => {
  diag.reset();
  for (let i = 0; i < 230; i++) diag.log("net", { n: i });
  assert.equal(diag.snapshot().length, 200);
  assert.equal(diag.snapshot()[0].n, 30);
  diag.reset();
  diag.log("net", {
    headers: {
      Authorization: "Basic dXNlcjpwYXNz",
      Cookie: "wordpress_logged_in=abc",
      "x-api-key": "sk-ant-api03-SECRET",
    },
    password: "hunter2",
    note: "pass: abcd efgh ijkl mnop qrst uvwx and Bearer abc.def.ghi and sk-proj-1234567890abcdef",
    big: "x".repeat(5000),
  });
  const text = diag.exportText({ site: "https://s.example", app: "0.1.0" });
  for (const secret of [
    "dXNlcjpwYXNz",
    "wordpress_logged_in",
    "SECRET",
    "hunter2",
    "abcd efgh ijkl mnop qrst uvwx",
    "abc.def.ghi",
    "sk-proj-1234567890abcdef",
  ])
    assert.ok(!text.includes(secret), secret);
  assert.ok(text.includes("[redacted]"));
  assert.ok(text.length < 1500, "long values are truncated");
  assert.match(text, /^ADActive diagnostic log \(1 events, redacted\)/);
  assert.match(text, /site: https:\/\/s\.example/);
});

test("the log is mirrored to a file in the data folder and survives a restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-"));
  try {
    diag.reset();
    diag.init(dir);
    diag.log("net", { ok: true, route: "/wp/v2/pages" });
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.ok(fs.existsSync(path.join(dir, "diagnostic-log.json")));
    diag.reset();
    diag.init(dir);
    assert.equal(diag.snapshot().at(-1).route, "/wp/v2/pages");
  } finally {
    diag.reset();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- read-back normalization -----------------------------------------------------------------------------------------------
test("CRLF, NFC/NFD and trailing whitespace are normalized; everything else is compared exactly", () => {
  const nfc = "<p>café — שלום</p>\n<p>שורה שנייה</p>";
  assert.ok(sameText(nfc, nfc.replace(/\n/g, "\r\n")), "CRLF");
  assert.ok(sameText(nfc, nfc.normalize("NFD")), "NFD");
  assert.ok(sameText(nfc, nfc + "\n\n"), "trailing newlines");
  assert.ok(
    sameText(nfc, nfc.replace("</p>\n", "</p>  \n")),
    "trailing spaces at line ends",
  );
  assert.ok(
    sameText(nfc, nfc.replace(/\n/g, "\r\n").normalize("NFD") + "\r\n"),
    "all together",
  );
  assert.ok(!sameText(nfc, nfc.replace("שנייה", "שלישית")), "different text");
  assert.ok(
    !sameText(nfc, nfc.replace("<p>caf", "<p> caf")),
    "leading whitespace inside text is exact",
  );
  assert.ok(!sameText("a b", "a  b"), "inner whitespace is exact");
  assert.ok(!sameText("<p>x</p>", "<p>X</p>"), "case");
  assert.ok(normSame({ css: "a{b:c}\r\n", n: 1 }, { css: "a{b:c}", n: 1 }));
  assert.ok(!normSame({ css: "a{b:c}", n: 1 }, { css: "a{b:c}", n: 2 }));
  assert.equal(normalizeText("x \t\r\ny  \r\n"), "x\ny");
});

test("a mismatch names the field, both lengths and the first difference with a short safe preview", () => {
  const text = describeMismatch(
    "content",
    "<p>אחד</p><p>שניים</p>",
    "<p>אחד</p><p>שלושה</p>",
  );
  assert.match(
    text,
    /^השדה content: אורך צפוי 22, התקבל 22; ההבדל הראשון במיקום 14/,
  );
  assert.match(text, /צפוי «/);
  assert.equal(
    mismatchDetail({ a: "x", b: "same" }, { a: "y", b: "same\r\n" }, [
      "a",
      "b",
    ]).includes("השדה b"),
    false,
  );
  assert.match(mismatchDetail({ a: "x" }, { a: "y" }, ["a"]), /השדה a/);
  assert.ok(
    describeMismatch("content", "x".repeat(500), "y".repeat(500)).length < 200,
    "previews are truncated",
  );
});

// ---- failure reasons -------------------------------------------------------------------------------------------------------
const netError = (props, message = "boom") =>
  Object.assign(new Error(message), props);
const expired = (ms) => {
  const c = new AbortController();
  c.abort();
  return { aborted: true, ms };
};
test("every failure type records a specific reason (seconds, phase, status, size, JSON, code, certificate)", () => {
  const write = {
    write: true,
    timeoutMs: 90000,
    signal: new AbortController().signal,
    limit: 4 * 1048576,
  };
  const deadline = { aborted: true };
  const timeouts = [
    ["connecting", "בזמן ההתחברות"],
    ["sending", "בזמן שליחת הבקשה"],
    ["waiting", "בזמן ההמתנה לתשובת האתר"],
    ["reading", "בזמן קריאת התשובה"],
  ];
  for (const [phase, hebrew] of timeouts) {
    const e = networkFailure(
      netError({ name: "AbortError", phase, ms: 90123 }),
      { ...write, deadline },
    );
    assert.match(e.detail, /חריגה ממגבלת הזמן \(90 שניות\)/, phase);
    assert.ok(e.detail.includes(hebrew), phase);
    assert.match(e.detail, /אחרי 90\.1 שניות/);
    assert.equal(e.kind, "timeout");
    // Only a timeout while CONNECTING means nothing was sent.
    assert.equal(!!e.notApplied, phase === "connecting", phase);
  }
  const r = (error, extra = {}) =>
    networkFailure(error, { ...write, deadline: { aborted: false }, ...extra });
  assert.match(r(new Error("status:413")).detail, /סטטוס HTTP 413/);
  assert.match(r(new Error("size")).detail, /גדולה מהמגבלה \(4 MB\)/);
  assert.match(r(new SyntaxError("Unexpected token")).detail, /אינה JSON תקין/);
  assert.match(r(new Error("html")).detail, /דף HTML במקום JSON/);
  assert.match(r(new Error("response")).detail, /אינה תקינה/);
  const reset = r(netError({ code: "ECONNRESET", phase: "reading", ms: 1500 }));
  assert.match(reset.detail, /ECONNRESET/);
  assert.match(reset.detail, /בזמן קריאת התשובה/);
  assert.equal(
    reset.notApplied,
    undefined,
    "a reset while reading the response is ambiguous",
  );
  const refused = r(netError({ code: "ECONNREFUSED", phase: "connecting" }));
  assert.equal(
    refused.notApplied,
    true,
    "refused before anything was sent: not applied",
  );
  assert.match(refused.message, /לפני שהבקשה נשלחה/);
  assert.equal(
    r(netError({ code: "ECONNREFUSED", phase: "connecting" }), { write: false })
      .notApplied,
    undefined,
    "reads are never 'not applied'",
  );
});

test("a certificate error is a clear Hebrew message, not 'unknown'", () => {
  for (const code of [
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
  ]) {
    const write = networkFailure(netError({ code, phase: "connecting" }), {
      write: true,
      timeoutMs: 90000,
      deadline: { aborted: false },
    });
    assert.match(write.message, /אימות תעודת האבטחה \(TLS\)/, code);
    assert.match(write.message, /אנטי־וירוס/);
    assert.ok(write.detail.includes(code));
    assert.equal(
      write.notApplied,
      true,
      "the TLS handshake failed before anything was sent",
    );
    const read = networkFailure(netError({ code }), {
      write: false,
      timeoutMs: 15000,
      deadline: { aborted: false },
    });
    assert.match(read.message, /אימות תעודת האבטחה/);
    assert.equal(read.kind, "cert");
  }
});

test("pageRequest reports the reason of each failure through the real code path", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-diag-"));
  try {
    const storage = {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    };
    let next;
    const wp = new WordPress(dir, storage, {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => {
        throw next;
      },
    });
    wp.data.p = Buffer.from(
      JSON.stringify({
        site: "https://salon.example",
        username: "u",
        password: "PRIVATE-PASSWORD",
      }),
    ).toString("base64");
    const attempt = async (error, write) => {
      next = error;
      try {
        await wp.pageRequest(
          "p",
          write ? 5 : null,
          write ? { title: "x" } : undefined,
          {},
          undefined,
          "pages",
        );
      } catch (e) {
        return e;
      }
    };
    const cases = [
      [
        netError({ code: "ETIMEDOUT", phase: "connecting" }),
        /ETIMEDOUT.*בזמן ההתחברות/,
        true,
      ],
      [
        netError({ name: "AbortError", phase: "waiting", ms: 91000 }),
        /בזמן ההמתנה לתשובת האתר/,
        false,
      ],
      [netError({ code: "ECONNRESET", phase: "reading" }), /ECONNRESET/, false],
      [
        netError({
          code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          phase: "connecting",
        }),
        /UNABLE_TO_VERIFY_LEAF_SIGNATURE/,
        true,
      ],
    ];
    for (const [error, pattern, notApplied] of cases) {
      const e = await attempt(error, true);
      assert.match(e.detail, pattern);
      assert.equal(!!e.notApplied, notApplied);
      assert.ok(
        !JSON.stringify(e).includes("PRIVATE-PASSWORD") &&
          !e.message.includes("PRIVATE-PASSWORD"),
      );
    }
    assert.match(
      (
        await attempt(
          netError({ code: "ENOTFOUND", phase: "connecting" }),
          false,
        )
      ).detail,
      /ENOTFOUND/,
    );
    const text = diag.exportText();
    assert.ok(!text.includes("PRIVATE-PASSWORD"));
    assert.match(text, /"type":"fail"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- agent-level outcomes -----------------------------------------------------------------------------------------------
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-diag-agent-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let before = {
    id: 5,
    status: "publish",
    title: "Before",
    content: "<p>Before</p>",
    modified: "fixture",
  };
  const wp = {
    data: { p: "opaque-connection" },
    status: () => ({ connected: true, site: "https://public.example" }),
    page: async () => structuredClone(before),
    pages: async () => [structuredClone(before)],
    pageRequest: async (_id, _page, payload) => {
      before = { ...before, ...payload };
      return { id: 5 };
    },
  };
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (v) => Buffer.from(v),
    decryptString: (b) => b.toString(),
  };
  const agent = new Agent(wp, dir, { storage });
  const set = (v) => {
    before = v;
  };
  return { agent, wp, set, get: () => before };
}
const proposal = (args) => ({
  step: async () => ({
    calls: [{ id: "x", name: "wp_prepare_update_page", args }],
  }),
});
const prepare = (agent, args) => agent.run("p", [], proposal(args));

test("read-back verifies content that WordPress returned with CRLF, NFD and a trailing newline", async (t) => {
  const f = fixture(t);
  const content = "<p>café — שלום</p>\n<p>שורה שנייה</p>";
  const r = await prepare(f.agent, { id: 5, title: "אחרי", content });
  f.wp.pageRequest = async (_i, _p, payload) => {
    f.set({
      id: 5,
      status: "publish",
      modified: "x",
      title: payload.title,
      content: payload.content.replace(/\n/g, "\r\n").normalize("NFD") + "\r\n",
    });
    return { id: 5 };
  };
  const done = await f.agent.decide("p", r.review.token, true);
  assert.equal(done.outcome, "verified");
  assert.equal(f.agent.isBlocked("p"), false);
});

test("a real content difference still fails read-back and the reason names the field and position", async (t) => {
  const f = fixture(t);
  const r = await prepare(f.agent, {
    id: 5,
    title: "אחרי",
    content: "<p>אחד</p><p>שניים</p>",
  });
  f.wp.pageRequest = async (_i, _p, payload) => {
    f.set({
      id: 5,
      status: "publish",
      modified: "x",
      title: payload.title,
      content: "<p>אחד</p><p>שלושה</p>",
    });
    return { id: 5 };
  };
  const done = await f.agent.decide("p", r.review.token, true);
  assert.equal(done.outcome, "unknown");
  assert.match(
    done.text,
    /סיבה טכנית: .*השדה content: אורך צפוי 22, התקבל 22; ההבדל הראשון במיקום 14/,
  );
  assert.equal(f.agent.isBlocked("p"), true);
});

test("failures that never left the machine are 'not applied' with a reason; ambiguous ones stay unknown with a reason", async (t) => {
  for (const [error, outcome, blocked, pattern] of [
    [
      networkFailure(
        netError({ code: "SELF_SIGNED_CERT_IN_CHAIN", phase: "connecting" }),
        { write: true, timeoutMs: 90000, deadline: { aborted: false } },
      ),
      "denied",
      false,
      /SELF_SIGNED_CERT_IN_CHAIN/,
    ],
    [
      networkFailure(netError({ code: "ECONNREFUSED", phase: "connecting" }), {
        write: true,
        timeoutMs: 90000,
        deadline: { aborted: false },
      }),
      "denied",
      false,
      /ECONNREFUSED/,
    ],
    [
      networkFailure(netError({ code: "ECONNRESET", phase: "reading" }), {
        write: true,
        timeoutMs: 90000,
        deadline: { aborted: false },
      }),
      "unknown",
      true,
      /ECONNRESET.*בזמן קריאת התשובה/,
    ],
  ]) {
    const f = fixture(t);
    const r = await prepare(f.agent, { id: 5, title: "אחרי" });
    f.wp.pageRequest = async (_i, _p, payload) => {
      // The reset happened after the server may have applied it; the read-back shows a third state => unknown.
      if (outcome === "unknown")
        f.set({
          id: 5,
          status: "publish",
          modified: "x",
          title: "Someone else",
          content: "<p>Other</p>",
        });
      throw error;
    };
    const done = await f.agent.decide("p", r.review.token, true);
    assert.equal(done.outcome, outcome);
    assert.equal(f.agent.isBlocked("p"), blocked);
    assert.match(done.text, pattern);
  }
});
