"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateSettings,
  ACPTransport,
  HermesBackend,
} = require("../src/hermes.cjs");
const { PassThrough } = require("node:stream");
const { EventEmitter } = require("node:events");
function mockChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.emit("exit", 0);
  };
  return child;
}
test("PROTOCOL MOCK: UTF-8 split frames, IDs, notifications and fail-closed unknown requests", async () => {
  const child = mockChild(),
    writes = [];
  child.stdin.on("data", (b) => writes.push(JSON.parse(b)));
  const rpc = new ACPTransport(child, { timeout: 1000 });
  const updates = [];
  rpc.on("notification", (m) => updates.push(m));
  const pending = rpc.request("initialize", {});
  const bytes = Buffer.from(
    JSON.stringify({
      jsonrpc: "2.0",
      id: writes[0].id,
      result: { text: "שלום" },
    }) + "\n",
  );
  for (const b of bytes) child.stdout.write(Buffer.from([b]));
  assert.equal((await pending).text, "שלום");
  child.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {} }) +
      "\n",
  );
  child.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "server1",
      method: "fs/read_text_file",
      params: {},
    }) + "\n",
  );
  assert.equal(updates.length, 1);
  assert.equal(writes.at(-1).error.code, -32601);
  const failed = rpc.request("session/new", {});
  child.emit("exit", 1);
  await assert.rejects(failed, /ACP/);
});
test("Hermes settings require explicit profile, absolute paths and reviewed policy", () => {
  const valid = {
    executable: process.execPath,
    profile: "pet-test",
    workspace: __dirname,
    acknowledged: true,
  };
  assert.equal(validateSettings(valid).profile, "pet-test");
  for (const patch of [
    { profile: "../default" },
    { executable: "hermes; touch /tmp/pwn" },
    { workspace: "relative" },
    { acknowledged: false },
  ])
    assert.throws(() => validateSettings({ ...valid, ...patch }));
});
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
function mockServer({ auth = true, holdPrompt = false } = {}) {
  const calls = [],
    children = [];
  const spawn = (_exe, args, options) => {
    assert.equal(options.shell, false);
    assert.deepEqual(args, ["-p", "pet-test", "acp"]);
    const c = mockChild();
    children.push(c);
    c.stdin.on("data", (b) => {
      const m = JSON.parse(b);
      calls.push(m);
      if (!m.method || m.id === undefined) return;
      let result = {};
      if (m.method === "initialize")
        result = {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true },
          authMethods: auth
            ? [{ id: "mock-provider", type: "agent" }]
            : [{ id: "hermes-setup", type: "terminal" }],
        };
      if (m.method === "session/new")
        result = {
          sessionId: "s" + calls.length,
          modes: {
            currentModeId: "default",
            availableModes: [{ id: "default" }],
          },
        };
      if (m.method === "session/load")
        result = {
          modes: {
            currentModeId: "default",
            availableModes: [{ id: "default" }],
          },
        };
      if (m.method === "session/prompt" && holdPrompt) return;
      if (m.method === "session/prompt") {
        c.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: m.params.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "תשובת mock בלבד" },
              },
            },
          }) + "\n",
        );
        result = { stopReason: "end_turn" };
      }
      queueMicrotask(() =>
        c.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\n",
        ),
      );
    });
    return c;
  };
  return { calls, children, spawn };
}
test("one-time approval: only successful explicit setup can reconnect from saved settings", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pet-approval-"));
  const server = mockServer();
  const options = { spawn: server.spawn, check: async () => {} };
  let backend = new HermesBackend(dir, options);
  t.after(() => {
    backend.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await assert.rejects(() => backend.connectSaved(), /נדרשת הגדרה/);
  assert.equal(server.calls.length, 0);
  await backend.connect({
    executable: process.execPath,
    profile: "pet-test",
    workspace: __dirname,
    acknowledged: true,
  });
  backend.disconnect();
  backend = new HermesBackend(dir, options);
  assert.equal(backend.status().setupApproved, true);
  await backend.connectSaved();
  assert.equal(backend.status().connected, true);
  backend.disconnect();
  backend.data.settings.acknowledged = false;
  backend.save();
  backend = new HermesBackend(dir, options);
  await assert.rejects(() => backend.connectSaved(), /נדרשת הגדרה/);
});
// Hold one real protocol response at a deterministic boundary (no timing sleeps).
function holdResponse(server, method) {
  const child = server.children.at(-1);
  const write = child.stdout.write.bind(child.stdout);
  let release, reached;
  const waiting = new Promise((resolve) => (reached = resolve));
  child.stdout.write = (chunk) => {
    const m = JSON.parse(chunk);
    if (
      m.id !== undefined &&
      server.calls.find((c) => c.id === m.id)?.method === method
    ) {
      child.stdout.write = write;
      release = () => write(chunk);
      reached();
      return true;
    }
    return write(chunk);
  };
  return { waiting, release: () => release() };
}
async function cancellationFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pet-acp-cancel-"));
  const server = mockServer();
  const backend = new HermesBackend(dir, {
    spawn: server.spawn,
    check: async () => {},
  });
  t.after(() => {
    backend.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await backend.connect({
    executable: process.execPath,
    profile: "pet-test",
    workspace: __dirname,
    acknowledged: true,
  });
  const permission = (id, sessionId) =>
    server.children.at(-1).stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "session/request_permission",
        params: {
          sessionId,
          options: [{ optionId: "allow_once", kind: "allow_once" }],
          toolCall: { title: "PUBLIC MOCK" },
        },
      }) + "\n",
    );
  return { backend, server, permission };
}
test("PROTOCOL MOCK: Stop denies late permissions and stale approvals until prompt settles", async (t) => {
  const { backend, server, permission } = await cancellationFixture(t);
  const events = [];
  backend.on("event", (e) => events.push(e));
  const gate = holdResponse(server, "session/prompt");
  const reply = backend.reply({ id: "one" }, "public fixture");
  reply.catch(() => {});
  await gate.waiting;
  const sessionId = backend.active.sessionId;
  permission("before-stop", sessionId);
  const token = events.at(-1).token;
  backend.cancel("one");
  assert.equal(backend.busy, true);
  backend.cancel("one");
  assert.equal(
    server.calls.filter((c) => c.method === "session/cancel").length,
    1,
  );
  assert.equal(backend.view("one").turn, "cancelling");
  assert.equal(
    new HermesBackend(path.dirname(backend.file)).view("one").turn,
    "unknown",
  );
  assert.throws(() =>
    backend.answerPermission({ token, projectId: "one", allow: true }),
  );
  permission("after-stop", sessionId);
  assert.deepEqual(
    server.calls.find((c) => c.id === "after-stop")?.result.outcome,
    { outcome: "cancelled" },
  );
  assert.equal(events.filter((e) => e.type === "permission").length, 1);
  assert.equal(backend.permissions.size, 0);
  gate.release();
  await reply;
  permission("after-settle", sessionId);
  assert.deepEqual(server.calls.at(-1).result.outcome, {
    outcome: "cancelled",
  });
  assert.equal(backend.busy, false);
  // The server may finish before cancellation takes effect; preserve its actual
  // stop reason instead of claiming Stop rolled back or cancelled completed work.
  assert.equal(backend.view("one").turn, "completed");
  const nextGate = holdResponse(server, "session/prompt");
  const nextReply = backend.reply({ id: "one" }, "explicit next turn");
  nextReply.catch(() => {});
  await nextGate.waiting;
  assert.throws(() =>
    backend.answerPermission({ token, projectId: "one", allow: true }),
  );
  permission("next-turn", sessionId);
  backend.answerPermission({
    token: events.at(-1).token,
    projectId: "one",
    allow: true,
  });
  assert.deepEqual(server.calls.at(-1).result.outcome, {
    outcome: "selected",
    optionId: "allow_once",
  });
  nextGate.release();
  await nextReply;
});
for (const method of ["session/new", "session/load", "session/set_mode"]) {
  test(`PROTOCOL MOCK: Stop during ${method} never sends a prompt after setup completes`, async (t) => {
    const { backend, server, permission } = await cancellationFixture(t);
    if (method === "session/load") {
      await backend.session("one");
      backend.loaded.clear();
    }
    const gate = holdResponse(server, method);
    const reply = backend.reply({ id: "one" }, "must never be sent");
    reply.catch(() => {}); // Teardown also settles a deliberately held request on assertion failure.
    await gate.waiting;
    assert.throws(() => backend.cancel("wrong"));
    assert.doesNotThrow(() => backend.cancel("one"));
    assert.doesNotThrow(() => backend.cancel("one"));
    assert.equal(backend.busy, true);
    await assert.rejects(backend.reply({ id: "two" }, "overlap"));
    permission(
      "during-setup-cancel",
      backend.view("one").sessionId || "future-session",
    );
    assert.deepEqual(server.calls.at(-1).result.outcome, {
      outcome: "cancelled",
    });
    gate.release();
    const result = await reply;
    assert.equal(result.turn, "cancelled");
    assert.equal(result.messages.length, 0);
    assert.equal(
      server.calls.filter((c) => c.method === "session/prompt").length,
      0,
    );
    assert.equal(
      server.calls.filter((c) => c.method === "session/cancel").length,
      0,
    );
    assert.equal(backend.busy, false);
    assert.equal(backend.active, null);
    const sessionId = result.sessionId;
    assert.ok(sessionId);
    await backend.reply({ id: "one" }, "explicit next turn");
    assert.equal(backend.view("one").sessionId, sessionId);
    assert.equal(backend.view("one").turn, "completed");
    assert.equal(
      server.calls.filter((c) => c.method === "session/new").length,
      1,
    );
    assert.equal(
      server.calls.filter((c) => c.method === "session/prompt").length,
      1,
    );
  });
}
test("PROTOCOL MOCK: immediate Stop on an already loaded session prevents prompt dispatch", async (t) => {
  const { backend, server } = await cancellationFixture(t);
  await backend.session("one");
  const reply = backend.reply({ id: "one" }, "never dispatch");
  backend.cancel("one");
  assert.equal((await reply).turn, "cancelled");
  assert.equal(
    server.calls.some((c) => c.method === "session/prompt"),
    false,
  );
  assert.equal(backend.operation, null);
});
test("PROTOCOL MOCK: setup transport failure after Stop cleans up without prompt or retry", async (t) => {
  const { backend, server } = await cancellationFixture(t);
  const gate = holdResponse(server, "session/new");
  const reply = backend.reply({ id: "one" }, "never dispatch");
  const rejected = assert.rejects(reply, /ACP/);
  await gate.waiting;
  backend.cancel("one");
  server.children.at(-1).emit("exit", 1);
  await rejected;
  gate.release(); // A stale setup response on the closed transport cannot revive the operation.
  assert.equal(
    server.calls.some((c) => c.method === "session/prompt"),
    false,
  );
  assert.equal(backend.busy, false);
  assert.equal(backend.active, null);
  assert.equal(backend.operation, null);
  assert.equal(backend.status().connected, false);
  assert.equal(backend.view("one").messages.length, 0);
});
test("PROTOCOL MOCK: authenticated session persists by project and exact connection; reconnect loads without replaying prompts", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pet-acp-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = mockServer();
  const settings = {
    executable: process.execPath,
    profile: "pet-test",
    workspace: __dirname,
    acknowledged: true,
  };
  const backend = new HermesBackend(dir, {
    spawn: server.spawn,
    check: async () => {},
  });
  t.after(() => backend.disconnect());
  assert.equal((await backend.connect(settings)).connected, true);
  const events = [];
  backend.on("event", (e) => events.push(e));
  const project = {
    id: "one",
    name: "One",
    context: "",
    rules: "",
    documents: "untrusted",
    messages: [],
  };
  await backend.reply(project, "hello");
  assert.equal(backend.view("one").messages.at(-1).content, "תשובת mock בלבד");
  assert.equal(backend.view("one").turn, "completed");
  assert.equal(backend.view("two").messages.length, 0);
  assert.ok(events.some((e) => e.type === "text"));
  backend.disconnect();
  await backend.connect(settings);
  await backend.reply(project, "again");
  assert.equal(
    server.calls.filter((c) => c.method === "session/load").length,
    1,
  );
  assert.equal(
    server.calls.filter((c) => c.method === "session/prompt").length,
    2,
  );
  assert.equal(
    server.calls
      .filter((c) => c.method === "session/prompt")
      .at(-1)
      .params.prompt.some((b) => b.text.includes("hello")),
    false,
  );
  const restored = new HermesBackend(dir);
  assert.equal(restored.view("one").messages.length, 4);
});
test("PROTOCOL MOCK: missing auth is setup-required and never creates a session", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pet-acp-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = mockServer({ auth: false });
  const backend = new HermesBackend(dir, {
    spawn: server.spawn,
    check: async () => {},
  });
  t.after(() => backend.disconnect());
  await assert.rejects(
    backend.connect({
      executable: process.execPath,
      profile: "pet-test",
      workspace: __dirname,
      acknowledged: true,
    }),
    /setup/,
  );
  assert.equal(backend.status().connected, false);
  assert.equal(backend.status().setupApproved, false);
  const restarted = new HermesBackend(dir, {
    spawn: server.spawn,
    check: async () => {},
  });
  await assert.rejects(() => restarted.connectSaved(), /נדרשת הגדרה/);
  assert.equal(
    server.calls.some((c) => c.method === "session/new"),
    false,
  );
});
test("PROTOCOL MOCK: permissions are explicit once-only, bound to project, timeout/cancel deny", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pet-acp-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = mockServer();
  const backend = new HermesBackend(dir, {
    spawn: server.spawn,
    check: async () => {},
    permissionTimeout: 15,
  });
  t.after(() => backend.disconnect());
  await backend.connect({
    executable: process.execPath,
    profile: "pet-test",
    workspace: __dirname,
    acknowledged: true,
  });
  const gate = holdResponse(server, "session/prompt");
  const reply = backend.reply({ id: "one" }, "permission fixture");
  reply.catch(() => {});
  await gate.waiting;
  const s = backend.active;
  const events = [];
  backend.on("event", (e) => events.push(e));
  const request = (
    id,
    options = [
      { optionId: "allow_once", kind: "allow_once" },
      { optionId: "allow_always", kind: "allow_always" },
    ],
  ) =>
    backend.requestPermission({
      id,
      params: {
        sessionId: s.sessionId,
        options,
        toolCall: {
          title: "MOCK ONLY",
          rawInput: { command: "public fixture" },
        },
      },
    });
  request(900);
  const p = events.at(-1);
  assert.throws(() =>
    backend.answerPermission({
      token: p.token,
      projectId: "wrong",
      allow: true,
    }),
  );
  backend.answerPermission({ token: p.token, projectId: "one", allow: true });
  assert.deepEqual(server.calls.at(-1).result.outcome, {
    outcome: "selected",
    optionId: "allow_once",
  });
  assert.throws(() =>
    backend.answerPermission({ token: p.token, projectId: "one", allow: true }),
  );
  request(901, [{ optionId: "allow_session", kind: "allow_always" }]);
  assert.equal(events.at(-1).canAllow, false);
  backend.answerPermission({
    token: events.at(-1).token,
    projectId: "one",
    allow: true,
  });
  assert.equal(server.calls.at(-1).result.outcome.outcome, "cancelled");
  request(902);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(server.calls.at(-1).result.outcome.outcome, "cancelled");
  request(903);
  backend.cancel("one");
  assert.equal(backend.permissions.size, 0);
  assert.equal(server.calls.at(-1).method, "session/cancel");
  assert.equal(server.calls.at(-1).id, undefined);
  gate.release();
  await reply;
  assert.throws(() =>
    validateSettings({
      executable: process.execPath,
      profile: "PET-test",
      workspace: __dirname,
      acknowledged: true,
    }),
  );
});
test("PROTOCOL MOCK: malformed frames, protocol mismatch, null auth and unsupported permission mode fail closed", async (t) => {
  const child = mockChild(),
    rpc = new ACPTransport(child);
  const request = rpc.request("initialize", {});
  child.stdout.write("not-json\n");
  await assert.rejects(request);
  assert.equal(rpc.closed, true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pet-acp-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const variant of ["protocol", "auth", "mode"]) {
    const server = mockServer();
    const spawn = (...args) => {
      const c = server.spawn(...args);
      const original = c.stdout.write.bind(c.stdout);
      c.stdout.write = (chunk) => {
        const m = JSON.parse(chunk);
        if (m.result?.protocolVersion && variant === "protocol")
          m.result.protocolVersion = 999;
        if (m.id === 2 && variant === "auth") m.result = null;
        if (m.result?.modes && variant === "mode") delete m.result.modes;
        return original(JSON.stringify(m) + "\n");
      };
      return c;
    };
    const backend = new HermesBackend(dir, { spawn, check: async () => {} });
    const connect = backend.connect({
      executable: process.execPath,
      profile: "pet-test",
      workspace: __dirname,
      acknowledged: true,
    });
    if (variant === "mode") {
      await connect;
      await assert.rejects(backend.reply({ id: "x" }, "hello"), /default/);
    } else await assert.rejects(connect);
    assert.equal(
      server.calls.some((c) => c.method === "session/prompt"),
      false,
    );
    backend.disconnect();
  }
});
test("PROTOCOL MOCK: transport crash retains partial turn as unknown and never retries", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pet-acp-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = mockServer({ holdPrompt: true }),
    backend = new HermesBackend(dir, {
      spawn: server.spawn,
      check: async () => {},
    });
  t.after(() => backend.disconnect());
  await backend.connect({
    executable: process.execPath,
    profile: "pet-test",
    workspace: __dirname,
    acknowledged: true,
  });
  const prompt = backend.reply({ id: "one" }, "hello");
  while (!server.calls.some((c) => c.method === "session/prompt"))
    await new Promise((r) => setImmediate(r));
  const c = server.children.at(-1),
    sessionId = backend.active.sessionId;
  c.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "partial mock" },
        },
      },
    }) + "\n",
  );
  c.emit("exit", 1);
  await assert.rejects(prompt);
  assert.equal(backend.view("one").turn, "unknown");
  assert.equal(
    new HermesBackend(dir).view("one").messages.at(-1).content,
    "partial mock",
  );
  assert.equal(
    server.calls.filter((c) => c.method === "session/prompt").length,
    1,
  );
});
test("PROTOCOL MOCK: advertised model IDs only, strict load before reply, replay before load response", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pet-acp-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = mockServer(),
    backend = new HermesBackend(dir, {
      spawn: server.spawn,
      check: async () => {},
    });
  t.after(() => backend.disconnect());
  const settings = {
    executable: process.execPath,
    profile: "pet-test",
    workspace: __dirname,
    acknowledged: true,
  };
  await backend.connect(settings);
  const s = await backend.session("one");
  await assert.rejects(backend.selectModel("one", "invented:paid-model"));
  s.models = [{ modelId: "mock:advertised/model", name: "Mock" }];
  await backend.selectModel("one", "mock:advertised/model");
  assert.equal(s.selectedModel, "mock:advertised/model");
  backend.loaded.clear();
  const c = server.children.at(-1),
    original = c.stdout.write.bind(c.stdout);
  c.stdout.write = (b) => {
    const m = JSON.parse(b);
    if (
      server.calls.find((call) => call.id === m.id)?.method === "session/load"
    ) {
      original(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: s.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "authoritative mock replay" },
            },
          },
        }) + "\n",
      );
    }
    return original(b);
  };
  await backend.session("one");
  assert.equal(s.messages[0].content, "authoritative mock replay");
  backend.loaded.clear();
  backend.capabilities.loadSession = false;
  await assert.rejects(backend.session("one"));
  assert.equal(
    server.calls.filter((c) => c.method === "session/new").length,
    1,
  );
});
