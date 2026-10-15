const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { Provider } = require("../src/provider.cjs");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
function setup(t, available = true) {
  const dir = fs.mkdtempSync(
    path.join(
      process.env.TMPDIR || path.join(__dirname, "../artifacts"),
      "adactive-provider-",
    ),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storage = {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from("encrypted:" + s),
    decryptString: (b) => b.toString().replace("encrypted:", ""),
  };
  return { dir, storage };
}
test("fail closed before any network or file write when encryption is unavailable", async (t) => {
  const { dir, storage } = setup(t, false);
  const p = new Provider(dir, storage, () => {
    throw Error("network forbidden");
  });
  await assert.rejects(
    p.connect({ key: "test-key-value", model: "gpt-4.1-mini" }),
    /הצפנה/,
  );
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(p.status().connected, false);
});
test("only persists validated model; failed replacement keeps old connection; requests never expose key", async (t) => {
  const { dir, storage } = setup(t);
  let fail = false,
    calls = [];
  const fetcher = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: !fail,
      status: fail ? 401 : 200,
      json: async () =>
        opts.method === "GET"
          ? { data: [{ id: "gpt-4.1-mini" }, { id: "other-model" }] }
          : {
              choices: [{ message: { content: "test provider response" } }],
            },
    };
  };
  const p = new Provider(dir, storage, fetcher);
  const first = await p.discover({ key: "test-key-value" });
  await p.connect({ token: first.token, model: "gpt-4.1-mini", consent: true });
  assert.equal(p.status().connected, true);
  assert.equal(JSON.stringify(p.status()).includes("test-key-value"), false);
  const second = await p.discover({ key: "bad-key-value" });
  fail = true;
  await assert.rejects(
    p.connect({ token: second.token, model: "other-model", consent: true }),
    /401/,
  );
  assert.equal(p.status().model, "gpt-4.1-mini");
  fail = false;
  assert.equal(
    await p.reply([{ role: "user", content: "hello" }]),
    "test provider response",
  );
  assert.match(calls[0].url, /api.openai.com/);
  assert.equal(JSON.parse(calls[1].opts.body).model, "gpt-4.1-mini");
  p.disconnect();
  assert.equal(p.status().connected, false);
});
