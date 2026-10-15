"use strict";
// REAL non-inference probe. No user profile, auth, session/new or prompt.
// Usage: node scripts/check-hermes-handshake.cjs /absolute/path/to/hermes
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFileSync } = require("node:child_process");
const { ACPTransport, validateSettings } = require("../src/hermes.cjs");
(async () => {
  if (!process.argv[2])
    throw new Error("Provide an explicit Hermes executable");
  const root = fs.mkdtempSync(
    path.join(process.env.TMPDIR || os.tmpdir(), "pet-real-handshake-"),
  );
  let rpc;
  try {
    const home = path.join(root, ".hermes");
    fs.mkdirSync(home, { recursive: true });
    const settings = validateSettings({
      executable: process.argv[2],
      profile: "default",
      workspace: root,
      acknowledged: true,
    });
    const env = {
      HOME: root,
      USERPROFILE: root,
      HERMES_HOME: home,
      PATH: process.env.PATH,
      TMPDIR: root,
      LANG: "en_US.UTF-8",
      HERMES_YOLO_MODE: "0",
      HERMES_ACP_SKIP_CONFIGURED_MCP: "1",
    };
    execFileSync(settings.executable, ["-p", "default", "acp", "--check"], {
      shell: false,
      cwd: root,
      env,
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("REAL isolated acp --check: exit 0");
    rpc = new ACPTransport(
      spawn(settings.executable, ["-p", "default", "acp"], {
        shell: false,
        cwd: root,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    const result = await rpc.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: {
        name: "adactive-pet-non-inference-probe",
        version: "0.1.0",
      },
    });
    if (result?.protocolVersion !== 1) throw new Error("Unsupported protocol");
    console.log(
      JSON.stringify(
        {
          probe: "REAL initialize only; isolated empty HOME",
          protocolVersion: result.protocolVersion,
          agentInfo: result.agentInfo,
          agentCapabilities: result.agentCapabilities,
          authMethods: result.authMethods?.map((m) => ({
            id: m.id,
            type: m.type,
          })),
          inference: "NOT RUN",
          userProfile: "NOT USED",
        },
        null,
        2,
      ),
    );
  } finally {
    if (rpc) {
      const child = rpc.child;
      const exited = new Promise((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once("exit", resolve);
      });
      rpc.close();
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      await exited;
      clearTimeout(timer);
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(() => {
  console.error(
    "REAL isolated handshake failed; no inference was attempted. Raw logs omitted for privacy.",
  );
  process.exitCode = 1;
});
