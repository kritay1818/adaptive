const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Provider } = require("../src/provider.cjs");
function setup(t, fetcher) {
  const dir = fs.mkdtempSync(
    path.join(
      process.env.TMPDIR || require("node:os").tmpdir(),
      "multi-provider-",
    ),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // MOCK encryption/transport, never real credentials.
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from("MOCK:" + s),
    decryptString: (b) => b.toString().slice(5),
  };
  return { dir, storage, p: new Provider(dir, storage, fetcher) };
}
test("MOCK discovery stages credential in main, no inference until explicit consent, then persists", async (t) => {
  const calls = [];
  const { p, dir } = setup(t, async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      json: async () =>
        opts.method === "GET"
          ? { data: [{ id: "gpt-4.1-mini" }] }
          : { choices: [{ message: { content: "OK" } }] },
    };
  });
  const list = await p.discover({
    provider: "openai",
    key: "public-dummy-key",
  });
  assert.deepEqual(list.models, [
    { id: "gpt-4.1-mini", label: "gpt-4.1-mini" },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.method, "GET");
  assert.equal(fs.existsSync(path.join(dir, "connection.json")), false);
  assert.doesNotMatch(JSON.stringify(list), /public-dummy-key/);
  await assert.rejects(
    p.connect({ token: list.token, model: "gpt-4.1-mini" }),
    /אישור/,
  );
  await p.connect({ token: list.token, model: "gpt-4.1-mini", consent: true });
  assert.equal(p.status().providerId, "openai");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].opts.redirect, "error");
});
for (const [provider, region, model, list, response, host] of [
  [
    "anthropic",
    "",
    "claude-test",
    {
      data: [{ id: "claude-test", display_name: "Claude test" }],
      has_more: false,
    },
    {
      content: [
        { type: "thinking", thinking: "private" },
        { type: "text", text: "OK" },
      ],
    },
    "api.anthropic.com",
  ],
  [
    "gemini",
    "",
    "gemini-test",
    {
      models: [
        {
          name: "models/gemini-test",
          supportedGenerationMethods: ["generateContent"],
        },
        {
          name: "models/embed-test",
          supportedGenerationMethods: ["embedContent"],
        },
      ],
    },
    {
      candidates: [
        {
          content: {
            parts: [{ thought: true, text: "hidden" }, { text: "OK" }],
          },
        },
      ],
    },
    "generativelanguage.googleapis.com",
  ],
  [
    "moonshot",
    "",
    "kimi-test",
    { data: [{ id: "kimi-test" }] },
    { choices: [{ message: { content: "OK" } }] },
    "api.moonshot.ai",
  ],
  [
    "qwen",
    "singapore",
    "qwen-test",
    {
      success: true,
      output: {
        total: 1,
        page_no: 1,
        page_size: 20,
        models: [
          {
            model: "qwen-test",
            inference_metadata: {
              request_modality: ["Text"],
              response_modality: ["Text"],
            },
          },
        ],
      },
    },
    { choices: [{ message: { content: "OK" } }] },
    "dashscope-intl.aliyuncs.com",
  ],
])
  test(`MOCK ${provider}: documented discovery/auth/text request, no tools or credential in payload`, async (t) => {
    const calls = [];
    const { p } = setup(t, async (url, opts) => {
      calls.push({ url, opts });
      return {
        ok: true,
        json: async () => (opts.method === "GET" ? list : response),
      };
    });
    const d = await p.discover({
      provider,
      region,
      key: "public-dummy-" + provider,
    });
    assert.equal(d.models.length, 1);
    await p.connect({ token: d.token, model, consent: true });
    assert.equal(
      await p.reply([
        { role: "system", content: "system context" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "prior" },
        { role: "user", content: "now" },
      ]),
      "OK",
    );
    assert.equal(p.status().providerId, provider);
    assert.ok(
      calls.every(
        (c) => new URL(c.url).hostname === host && c.opts.redirect === "error",
      ),
    );
    const last = calls.at(-1),
      body = JSON.parse(last.opts.body);
    assert.doesNotMatch(last.opts.body, /public-dummy|tools|hidden/);
    if (provider === "anthropic") {
      assert.equal(last.opts.headers["x-api-key"], "public-dummy-anthropic");
      assert.equal(body.system, "system context");
      assert.equal(body.messages[0].role, "user");
      assert.equal(body.max_tokens, 4096);
    } else if (provider === "gemini") {
      assert.equal(last.opts.headers["x-goog-api-key"], "public-dummy-gemini");
      assert.equal(body.systemInstruction.parts[0].text, "system context");
      assert.equal(body.contents[1].role, "model");
      assert.match(last.url, /models\/gemini-test:generateContent$/);
    } else {
      assert.equal(
        last.opts.headers.Authorization,
        "Bearer public-dummy-" + provider,
      );
      assert.equal(body.max_tokens, 4096);
    }
  });
test("MOCK expiry clears staged key without requiring another request", async (t) => {
  const { p } = setup(t, async () => ({
    ok: true,
    json: async () => ({ data: [{ id: "model" }] }),
  }));
  await p.discover({ provider: "openai", key: "public-dummy-key" });
  assert.ok(p.pendingTimer, "staged credential needs an expiry timer");
  p.cancelDiscovery();
  assert.equal(p.pending, null);
  assert.equal(p.pendingTimer, null);
});
test("MOCK independent ciphertext, restart, migration, replacement failure, explicit no-network selection", async (t) => {
  const { dir, storage, p } = setup(t, async (url, o) => ({
    ok: true,
    json: async () =>
      o.method === "GET"
        ? { data: [{ id: "model" }, { id: "other" }] }
        : { choices: [{ message: { content: "OK" } }] },
  }));
  const legacy = {
    model: "legacy-model",
    encrypted: storage.encryptString("public-legacy-key").toString("base64"),
  };
  fs.writeFileSync(p.file, JSON.stringify(legacy));
  const migrated = new Provider(dir, storage, p.fetch);
  assert.equal(migrated.status().model, "legacy-model");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(p.file)),
    legacy,
    "no startup rewrite",
  );
  const a = await migrated.discover({
    provider: "moonshot",
    key: "public-kimi-key",
  });
  await migrated.connect({ token: a.token, model: "model", consent: true });
  const saved = fs.readFileSync(p.file, "utf8");
  assert.doesNotMatch(saved, /public-/);
  assert.equal(JSON.parse(saved).records.openai.encrypted, legacy.encrypted);
  const restarted = new Provider(dir, storage, () => {
    throw Error("network must not run");
  });
  assert.equal(restarted.status().providerId, "moonshot");
  assert.throws(
    () => restarted.select({ slot: "openai", model: "legacy-model" }),
    /אישור/,
  );
  restarted.select({ slot: "openai", model: "legacy-model", consent: true });
  assert.equal(restarted.status().model, "legacy-model");
  assert.throws(
    () => restarted.select({ slot: "moonshot", model: "other", consent: true }),
    /לא אומת/,
  );
  const before = fs.readFileSync(p.file, "utf8");
  migrated.fetch = async (url, o) =>
    o.method === "GET"
      ? { ok: true, json: async () => ({ data: [{ id: "other" }] }) }
      : {
          ok: false,
          status: 401,
          json: async () => ({ secret: "public-bad-key" }),
        };
  const b = await migrated.discover({
    provider: "moonshot",
    key: "public-bad-key",
  });
  await assert.rejects(
    migrated.connect({ token: b.token, model: "other", consent: true }),
    /401/,
  );
  assert.equal(fs.readFileSync(p.file, "utf8"), before);
  assert.equal(migrated.status().model, "model");
  restarted.disconnect();
  assert.equal(restarted.status().saved.length, 1);
  assert.equal(restarted.status().saved[0].provider, "moonshot");
});
for (const provider of ["openai", "anthropic", "gemini", "moonshot", "qwen"])
  test(`MOCK ${provider} errors are redacted, no silent fallback or arbitrary region`, async (t) => {
    let calls = 0;
    const { p } = setup(t, async () => {
      calls++;
      return {
        ok: false,
        status: 429,
        json: async () => ({ message: "public-secret-key" }),
      };
    });
    const args = {
      provider,
      region: provider === "qwen" ? "singapore" : "",
      key: "public-secret-key",
    };
    await assert.rejects(
      p.discover(args),
      (e) => /429/.test(e.message) && !e.message.includes(args.key),
    );
    assert.equal(calls, 1);
    assert.equal(p.status().connected, false);
    await assert.rejects(
      p.discover({ ...args, region: "https://evil.test" }),
      /אזור/,
    );
    assert.equal(calls, 1);
    p.fetch = async () => {
      throw Error("public-secret-key");
    };
    await assert.rejects(
      p.discover(args),
      (e) => !e.message.includes(args.key),
    );
    p.fetch = async () => ({
      ok: true,
      json: async () => {
        throw Error("public-secret-key");
      },
    });
    await assert.rejects(p.discover(args), /לא תקינה/);
    p.fetch = async () => ({ ok: true, json: async () => ({}) });
    await assert.rejects(
      p.request(
        args.key,
        "model",
        [{ role: "user", content: "hi" }],
        false,
        provider,
        args.region,
      ),
      /לא החזיר טקסט/,
    );
  });
test("MOCK credential isolation, invalid inputs, redirect rejection and unavailable storage", async (t) => {
  let calls = [];
  const { p, storage } = setup(t, async (u, o) => {
    calls.push({ u, o });
    return {
      ok: true,
      json: async () =>
        o.method === "GET"
          ? { data: [{ id: "model" }] }
          : { choices: [{ message: { content: "OK" } }] },
    };
  });
  await assert.rejects(
    p.discover({ provider: "evil", key: "public-dummy-key" }),
    /ספק/,
  );
  await assert.rejects(p.discover({ provider: "anthropic" }), /מפתח/);
  await assert.rejects(p.discover({ key: "key\nInjected:yes" }), /מפתח/);
  assert.equal(calls.length, 0);
  storage.isEncryptionAvailable = () => false;
  await assert.rejects(p.discover({ key: "public-dummy-key" }), /הצפנה/);
  storage.isEncryptionAvailable = () => true;
  storage.getSelectedStorageBackend = () => "basic_text";
  await assert.rejects(p.discover({ key: "public-dummy-key" }), /הצפנה/);
  assert.equal(calls.length, 0);
  storage.getSelectedStorageBackend = () => "keychain";
  const d = await p.discover({ key: "public-openai-key" });
  await p.connect({ token: d.token, model: "model", consent: true });
  await assert.rejects(p.discover({ provider: "moonshot" }), /מפתח/);
  assert.equal(calls.length, 2);
  p.fetch = async (u, o) => {
    assert.equal(o.redirect, "error");
    return { ok: false, status: 302 };
  };
  await assert.rejects(p.discover({}), /302/);
  assert.equal(p.status().model, "model");
});
test("MOCK pagination reads all Anthropic, Gemini and Qwen pages and rejects cycles", async (t) => {
  for (const provider of ["anthropic", "gemini", "qwen"]) {
    let n = 0,
      urls = [];
    const { p } = setup(t, async (u) => {
      urls.push(u);
      n++;
      return {
        ok: true,
        json: async () =>
          provider === "anthropic"
            ? {
                data: [{ id: "model-" + n }],
                has_more: n === 1,
                last_id: "model-" + n,
              }
            : provider === "gemini"
              ? {
                  models: [
                    {
                      name: "models/model-" + n,
                      supportedGenerationMethods: ["generateContent"],
                    },
                  ],
                  nextPageToken: n === 1 ? "opaque &token" : undefined,
                }
              : {
                  success: true,
                  output: {
                    total: 2,
                    page_no: n,
                    page_size: 1,
                    models: [
                      {
                        model: "model-" + n,
                        inference_metadata: {
                          request_modality: ["Text"],
                          response_modality: ["Text"],
                        },
                      },
                    ],
                  },
                },
      };
    });
    const d = await p.discover({
      provider,
      region: provider === "qwen" ? "singapore" : "",
      key: "public-dummy-key",
    });
    assert.equal(d.models.length, 2);
    assert.equal(urls.length, 2);
    assert.ok(
      urls[1].includes(
        provider === "anthropic"
          ? "after_id=model-1"
          : provider === "gemini"
            ? "pageToken=opaque+%26token"
            : "page_no=2",
      ),
    );
  }
  const { p } = setup(t, async () => ({
    ok: true,
    json: async () => ({
      data: [{ id: "model" }],
      has_more: true,
      last_id: "model",
    }),
  }));
  await assert.rejects(
    p.discover({ provider: "anthropic", key: "public-dummy-key" }),
    /לא הושלמה/,
  );
  assert.equal(p.pending, null);
});
test("MOCK cancelling discovery in flight cannot resurrect a staged credential", async (t) => {
  let release;
  const { p } = setup(
    t,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const discovery = p.discover({ key: "public-dummy-key" });
  p.cancelDiscovery();
  release({ ok: true, json: async () => ({ data: [{ id: "model" }] }) });
  await assert.rejects(discovery, /בוטלה/);
  assert.equal(p.pending, null);
});
test("MOCK encryption/storage failure preserves old selection and never exposes crypto errors", async (t) => {
  const { p, storage } = setup(t, async (u, o) => ({
    ok: true,
    json: async () =>
      o.method === "GET"
        ? { data: [{ id: "one" }, { id: "two" }] }
        : { choices: [{ message: { content: "OK" } }] },
  }));
  let d = await p.discover({ key: "public-first-key" });
  await p.connect({ token: d.token, model: "one", consent: true });
  const original = fs.readFileSync(p.file, "utf8");
  d = await p.discover({ key: "public-replacement-key" });
  storage.encryptString = () => {
    throw Error("public-replacement-key");
  };
  await assert.rejects(
    p.connect({ token: d.token, model: "two", consent: true }),
    (e) => !e.message.includes("public-replacement-key"),
  );
  assert.equal(fs.readFileSync(p.file, "utf8"), original);
  assert.equal(p.status().model, "one");
});
module.exports = { setup };
