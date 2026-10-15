const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (name) =>
  fs.readFileSync(path.join(__dirname, "../src/ui", name), "utf8");
test("mascot preserves official lowercase a contour and local SVGs have no active/remote content", () => {
  const original = read("brand-logo.svg");
  const firstA = [
    ...original.matchAll(/<path fill="#FFFFFF" d="([^"]+)"/g),
  ][0][1];
  assert.ok(read("pet.svg").includes(firstA));
  for (const name of ["pet.svg", "brand-logo.svg"]) {
    const svg = read(name);
    assert.doesNotMatch(
      svg,
      /<script|<foreignObject|<image|onload\s*=|onerror\s*=|(?:href|src)\s*=\s*["']https?:/i,
    );
  }
  assert.match(read("index.html"), /<title>ADActive — שיחה<\/title>/);
  assert.doesNotMatch(
    read("app.css") + read("pet.css") + read("pet.svg"),
    /#ff994d|#ffab6e|#ed8340/i,
  );
  assert.match(read("pet.css"), /prefers-reduced-motion/);
});
