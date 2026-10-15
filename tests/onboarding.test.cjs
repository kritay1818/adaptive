"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { discoverHermes } = require("../src/hermes-discovery.cjs");
test("discovery does not scan child folders, select profiles or use shell launchers", () => {
  const root = fs.mkdtempSync(
    path.join(process.env.TMPDIR || os.tmpdir(), "no-hermes-"),
  );
  try {
    const nested = path.join(root, "nested");
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, "hermes"), "public fixture", {
      mode: 0o700,
    });
    fs.writeFileSync(path.join(root, "hermes.cmd"), "public fixture", {
      mode: 0o700,
    });
    const options = {
      home: root,
      pathValue: `.:relative:${root}`,
      platform: "darwin",
      normalDirs: [],
    };
    assert.equal(discoverHermes(options), null);
    fs.symlinkSync(path.join(root, "hermes.cmd"), path.join(root, "hermes"));
    assert.equal(discoverHermes(options), null);
    fs.unlinkSync(path.join(root, "hermes"));
    fs.writeFileSync(path.join(root, "hermes"), "public fixture", {
      mode: 0o777,
    });
    fs.chmodSync(path.join(root, "hermes"), 0o777);
    assert.equal(discoverHermes(options), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("discovery checks exact executable names only, skips relative PATH and never runs candidates", () => {
  const root = fs.mkdtempSync(
    path.join(process.env.TMPDIR || os.tmpdir(), "discovery-"),
  );
  try {
    const bin = path.join(root, "bin with spaces;$(noop)");
    fs.mkdirSync(bin);
    const file = path.join(bin, "hermes");
    fs.writeFileSync(file, "#!/bin/sh\nexit 99\n", { mode: 0o700 });
    assert.equal(
      discoverHermes({
        home: root,
        pathValue: `.:relative:${bin}`,
        platform: "darwin",
        normalDirs: [],
      }),
      fs.realpathSync(file),
    );
    fs.chmodSync(file, 0o600);
    assert.equal(
      discoverHermes({
        home: root,
        pathValue: bin,
        platform: "darwin",
        normalDirs: [],
      }),
      null,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
