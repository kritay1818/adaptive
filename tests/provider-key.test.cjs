"use strict";
// The exact key must reach the provider header unchanged; pasted junk (RTL marks, spaces, newlines) is removed; logging and
// redaction never touch the outgoing request; the provider's own error text is surfaced.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Provider, normalizeKey } = require("../src/provider.cjs");
const diag = require("../src/diag.cjs");

const KEY = "sk-ant-api03-Ab_Cd-1234567890XYZabcdef";
const GKEY = "AIzaSyA-1234567890_abcdefghijklmnop";
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from("MOCK:" + s),
  decryptString: (b) => b.toString().slice(5),
};
function setup(t, fetcher) {
  const dir = fs.mkdtempSync(
    path.join(process.env.TMPDIR || os.tmpdir(), "provkey-"),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new Provider(dir, storage, fetcher);
}
const ok = (opts) => ({
  ok: true,
  json: async () =>
    opts.method === "GET"
      ? {
          data: [{ id: "m-1" }],
          output: {
            models: [
              {
                model: "m-1",
                name: "m-1",
                inference_metadata: {
                  response_modality: ["Text"],
                  request_modality: ["Text"],
                },
              },
            ],
            total: 1,
            page_no: 1,
            page_size: 100,
          },
          models: [
            {
              name: "models/m-1",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }
      : {
          choices: [{ message: { content: "OK" } }],
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "OK" }],
            },
          ],
          content: [{ type: "text", text: "OK" }],
          candidates: [{ content: { parts: [{ text: "OK" }] } }],
        },
});
const headerOf = (opts) =>
  opts.headers["x-api-key"] ??
  opts.headers["x-goog-api-key"] ??
  opts.headers.Authorization;

test("normalizeKey removes whitespace, newlines and invisible direction marks, nothing else", () => {
  assert.equal(normalizeKey(KEY), KEY);
  assert.equal(normalizeKey(`‏${KEY}‎`), KEY);
  assert.equal(normalizeKey(`  ${KEY}\r\n`), KEY);
  assert.equal(
    normalizeKey(`${KEY.slice(0, 10)}\u202B\u200B${KEY.slice(10)}\uFEFF\u00A0`),
    KEY,
  );
  assert.match(
    normalizeKey("ab cd\nef"),
    /\s/,
    "inner whitespace is kept so validation rejects it",
  );
  assert.equal(normalizeKey(`⁦${KEY}⁩`), KEY);
  assert.equal(normalizeKey(`"${KEY}"`), KEY);
  assert.equal(normalizeKey(`Bearer ${KEY}`), KEY);
  assert.equal(normalizeKey(null), "");
});

for (const [provider, region, key, header, expected] of [
  ["anthropic", "", KEY, "x-api-key", KEY],
  [
    "openai",
    "",
    "sk-proj-AbC_123-456789012345678",
    "Authorization",
    "Bearer sk-proj-AbC_123-456789012345678",
  ],
  ["gemini", "", GKEY, "x-goog-api-key", GKEY],
  [
    "moonshot",
    "",
    "sk-moon1234567890abcdef",
    "Authorization",
    "Bearer sk-moon1234567890abcdef",
  ],
  [
    "qwen",
    "singapore",
    "sk-qwen1234567890abcdef",
    "Authorization",
    "Bearer sk-qwen1234567890abcdef",
  ],
]) {
  test(`${provider}: the exact key reaches the header unchanged, also when pasted with junk, in discovery and in the connection test`, async (t) => {
    const calls = [];
    const p = setup(t, async (url, opts) => {
      calls.push({ url, opts, snapshot: JSON.stringify(opts) });
      return ok(opts);
    });
    const messy = `‏ ${key}\n‎`;
    const list = await p.discover({ provider, region, key: messy });
    await p.connect({
      token: list.token,
      model: list.models[0].id,
      consent: true,
    });
    assert.ok(calls.length >= 2);
    for (const c of calls) {
      assert.equal(headerOf(c.opts), expected);
      assert.equal(c.opts.headers[header], expected);
      assert.equal(
        c.snapshot,
        JSON.stringify(c.opts),
        "the request object is not changed after it is sent",
      );
    }
    const ping = JSON.parse(calls.at(-1).opts.body);
    assert.ok(
      Array.isArray(ping.tools) && ping.tools.length > 0,
      "the connection check carries the tools like a real chat request",
    );
    assert.ok(
      !JSON.stringify(ping).includes('"images"'),
      "no image fields in the validation ping",
    );
  });
}

test("logging and redaction work on copies: the outgoing request is identical with and without diagnostics", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "provkey-diag-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  diag.init(dir);
  const seen = [];
  const p = setup(t, async (url, opts) => {
    seen.push(JSON.stringify({ url, opts }));
    if (opts.method === "GET") return ok(opts);
    return {
      ok: false,
      status: 401,
      text: async () =>
        JSON.stringify({ error: { message: `invalid x-api-key ${KEY}` } }),
    };
  });
  const list = await p.discover({ provider: "anthropic", key: KEY });
  const header = { ...ok({ method: "GET" }) };
  assert.ok(header);
  const body = { headers: { "x-api-key": KEY }, note: `Bearer ${KEY}` };
  const before = JSON.stringify(body);
  diag.log("probe", body);
  assert.equal(
    JSON.stringify(body),
    before,
    "diag.log never mutates what it is given",
  );
  await assert.rejects(
    p.connect({ token: list.token, model: "m-1", consent: true }),
    (e) => {
      assert.equal(e.status, 401);
      assert.ok(
        !e.detail.includes(KEY),
        "the key is redacted from the provider's message",
      );
      assert.match(e.detail, /invalid x-api-key/);
      return true;
    },
  );
  assert.equal(JSON.parse(seen.at(-1)).opts.headers["x-api-key"], KEY);
});

test("keys that can never be valid are refused before any request", async (t) => {
  let called = false;
  const p = setup(t, async () => ((called = true), ok({ method: "GET" })));
  await assert.rejects(
    p.discover({ provider: "openai", key: "מפתח-שגוי-בעברית-1234" }),
    /מפתח/,
  );
  await assert.rejects(p.discover({ provider: "openai", key: " ‏ " }), /מפתח/);
  assert.equal(called, false);
});
