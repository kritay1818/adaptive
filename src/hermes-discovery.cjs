"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
// Metadata-only discovery: no shell, recursive scan, config/credential reads or execution.
// A discovered file is a suggestion, NEVER approval of its code or profile policy.
function discoverHermes({
  home = os.homedir(),
  pathValue = process.env.PATH || "",
  platform = process.platform,
  normalDirs,
} = {}) {
  const p = platform === "win32" ? path.win32 : path.posix;
  const dirs = normalDirs || [
    p.join(home, ".local", "bin"),
    p.join(
      home,
      ".hermes",
      "hermes-agent",
      platform === "win32" ? "venv/Scripts" : "venv/bin",
    ),
    ...(platform === "win32"
      ? []
      : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]),
  ];
  const name = platform === "win32" ? "hermes.exe" : "hermes";
  for (const dir of new Set([
    ...dirs,
    ...pathValue.split(p.delimiter).slice(0, 128),
  ])) {
    if (!p.isAbsolute(dir) || /[\x00-\x1f]/.test(dir)) continue;
    try {
      const file = fs.realpathSync(p.join(dir, name));
      if (!fs.statSync(file).isFile() || /\.(cmd|bat|ps1)$/i.test(file))
        continue;
      fs.accessSync(file, fs.constants.X_OK);
      // Ignore world-writable candidates/directories on POSIX. PATH is only a suggestion.
      if (
        platform !== "win32" &&
        (fs.statSync(file).mode | fs.statSync(dir).mode) & 0o002
      )
        continue;
      return file;
    } catch {
      /* Missing/unusable candidate: continue the finite lookup. */
    }
  }
  return null;
}
module.exports = { discoverHermes };
