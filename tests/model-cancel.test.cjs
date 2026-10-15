const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Provider } = require("../src/provider.cjs");
test("closing candidate during validation prevents late commit and preserves existing connection", async (t) => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "model-cancel-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from("fixture:" + s),
    decryptString: (b) => b.toString().slice(8),
  };
  let release,
    delay = false;
  const p = new Provider(dir, storage, async (_url, options) => {
    if (options.method === "GET")
      return {
        ok: true,
        json: async () => ({ data: [{ id: "fixture-model" }] }),
      };
    if (delay)
      await new Promise((resolve) => {
        release = resolve;
      });
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "OK" } }] }),
    };
  });
  const first = await p.discover({ key: "public-original-fixture" });
  await p.connect({
    token: first.token,
    model: "fixture-model",
    consent: true,
  });
  const original = fs.readFileSync(p.file, "utf8");
  delay = true;
  const candidate = await p.discover({ key: "public-fixture-key" });
  const validation = p.connect({
    token: candidate.token,
    model: "fixture-model",
    consent: true,
  });
  p.cancelDiscovery();
  release();
  await assert.rejects(validation, /בוטל/);
  assert.equal(p.status().connected, true);
  assert.equal(fs.readFileSync(p.file, "utf8"), original);
});
