"use strict";
// A rejected model key (401): one clear card with "חיבור מודל מחדש", and NO further requests with that key until a new key is
// connected (no repeated failing requests, no repeated errors).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Provider } = require("../src/provider.cjs");
const { describeError } = require("../src/errors.cjs");
const { tools } = require("../src/wp-agent.cjs");

const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from("MOCK:" + s),
  decryptString: (b) => b.toString().slice(5),
};
const OLD = "sk-ant-api03-OLDKEY1234567890abcdef";
const NEW = "sk-ant-api03-NEWKEY1234567890abcdef";
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keyrej-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = { mode: "ok", calls: [], chat: 0 };
  const fetcher = async (url, opts) => {
    const key = opts.headers["x-api-key"];
    state.calls.push({ method: opts.method, key });
    if (opts.method === "GET")
      return {
        ok: true,
        json: async () => ({ data: [{ id: "claude-sonnet-4-5" }] }),
      };
    state.chat++;
    if (state.mode === "reject" && key === OLD)
      return {
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({ error: { message: "invalid x-api-key" } }),
      };
    if (state.mode === "forbidden")
      return {
        ok: false,
        status: 403,
        text: async () =>
          JSON.stringify({
            error: { message: "request not allowed in your region" },
          }),
      };
    return {
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "שלום" }] }),
    };
  };
  return { provider: new Provider(dir, storage, fetcher), state };
}
const connect = async (provider, key) => {
  const list = await provider.discover({ provider: "anthropic", key });
  return provider.connect({
    token: list.token,
    model: list.models[0].id,
    consent: true,
  });
};
const messages = [
  { role: "system", content: "s" },
  { role: "user", content: "היי" },
];

test("401: one clear error with the reconnect button, then no more requests with that key", async (t) => {
  const { provider, state } = setup(t);
  await connect(provider, OLD);
  assert.equal(provider.status().keyRejected, false);
  state.mode = "reject";
  const before = state.chat;
  const first = await provider
    .step(messages, tools.slice(0, 2))
    .catch((e) => e);
  assert.equal(first.status, 401);
  assert.equal(state.chat, before + 1);
  assert.equal(provider.status().keyRejected, true);
  const d = describeError(first);
  assert.match(d.message, /מפתח ה-API לא תקף/);
  assert.deepEqual(d.buttons, ["model"]);
  // Every later attempt (chat, step, repeated clicks, any loop) fails immediately WITHOUT touching the network.
  for (let i = 0; i < 5; i++) {
    const again = await provider
      .step(messages, tools.slice(0, 2))
      .catch((e) => e);
    assert.equal(again.status, 401);
    assert.equal(again.rejectedBefore, true);
    assert.deepEqual(describeError(again).buttons, ["model"]);
    const reply = await provider.reply(messages).catch((e) => e);
    assert.equal(reply.rejectedBefore, true);
  }
  assert.equal(
    state.chat,
    before + 1,
    "no further request was sent with the rejected key",
  );
});
test("a new key ends the block; the old key stays blocked", async (t) => {
  const { provider, state } = setup(t);
  await connect(provider, OLD);
  state.mode = "reject";
  await provider.step(messages, tools.slice(0, 2)).catch(() => {});
  assert.equal(provider.status().keyRejected, true);
  await connect(provider, NEW);
  assert.equal(provider.status().keyRejected, false);
  const ok = await provider.step(messages, tools.slice(0, 2));
  assert.equal(ok.text, "שלום");
  assert.equal(state.calls.at(-1).key, NEW);
});
test("a 403 that is not about the key (region, quota) does not mark the key as rejected", async (t) => {
  const { provider, state } = setup(t);
  await connect(provider, OLD);
  state.mode = "forbidden";
  await provider.step(messages, tools.slice(0, 2)).catch(() => {});
  assert.equal(provider.status().keyRejected, false);
  state.mode = "ok";
  assert.equal((await provider.step(messages, tools.slice(0, 2))).text, "שלום");
});
