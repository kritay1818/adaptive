const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const modulePath = path.join(__dirname, "../src/pet-layout.cjs");
test("pet layout clamps size and keeps bounds on the selected work area", () => {
  assert.ok(fs.existsSync(modulePath), "pet geometry module exists");
  const { fitPet } = require(modulePath);
  const area = { x: -1200, y: 20, width: 1200, height: 800 };
  assert.deepEqual(fitPet({ x: -9999, y: 9999, width: 9999 }, area), {
    x: -1200,
    y: 512,
    width: 260,
    height: 308,
  });
  assert.deepEqual(fitPet({ x: -200, y: 40, width: 1 }, area), {
    x: -200,
    y: 40,
    width: 110,
    height: 158,
  });
  const fallback = fitPet({ x: NaN, y: Infinity, width: "bad" }, area);
  assert.deepEqual(fallback, { x: -150, y: 622, width: 130, height: 178 });
});
