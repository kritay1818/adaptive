#!/usr/bin/env node
"use strict";
// PROTOCOL MOCK ONLY. No tools, providers, credentials or network.
if (process.argv.includes("--check")) {
  console.log("PROTOCOL MOCK check only");
  process.exit(0);
}
const readline = require("node:readline");
const send = (m) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const result = (id, value) => send({ id, result: value });
let pending,
  session = "mock-session";
const state = () => ({
  modes: {
    currentModeId: "default",
    availableModes: [{ id: "default", name: "ask mock" }],
  },
  models: {
    currentModelId: "mock:only",
    availableModels: [{ modelId: "mock:only", name: "MOCK ONLY" }],
  },
});
const update = (u) =>
  send({ method: "session/update", params: { sessionId: session, update: u } });
const text = (t) =>
  update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: t },
  });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize")
    result(m.id, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      authMethods: [{ id: "protocol-mock-only", type: "agent" }],
    });
  else if (m.method === "authenticate") result(m.id, {});
  else if (m.method === "session/new")
    result(m.id, { sessionId: session, ...state() });
  else if (m.method === "session/load") result(m.id, state());
  else if (["session/set_mode", "session/set_model"].includes(m.method))
    result(m.id, {});
  else if (m.method === "session/prompt") {
    pending = m.id;
    text("זרם מדומה — PROTOCOL MOCK ONLY\n");
    const prompt = m.params.prompt.at(-1).text;
    if (prompt.endsWith("cancel"))
      update({
        sessionUpdate: "tool_call",
        title: "MOCK pending cancel",
        status: "in_progress",
      });
    else
      send({
        id: "permission-mock",
        method: "session/request_permission",
        params: {
          sessionId: session,
          options: [
            { optionId: "allow_once", kind: "allow_once", name: "Allow once" },
            {
              optionId: "allow_always",
              kind: "allow_always",
              name: "Never offer this",
            },
          ],
          toolCall: {
            title: "MOCK harmless fixture, no operation",
            rawInput: { command: "MOCK ONLY" },
          },
        },
      });
  } else if (m.id === "permission-mock" && pending) {
    text(
      "MOCK permission outcome: " +
        (m.result.outcome.optionId || m.result.outcome.outcome),
    );
    result(pending, { stopReason: "end_turn" });
    pending = null;
  } else if (m.method === "session/cancel" && pending) {
    result(pending, { stopReason: "cancelled" });
    pending = null;
  }
});
