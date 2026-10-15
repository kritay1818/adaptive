const test = require("node:test");
const assert = require("node:assert/strict");
const {
  chatBounds,
  fitChatBounds,
  restoreChatBounds,
} = require("../src/chat-layout.cjs");
test("only legacy default dimensions migrate; custom geometry and position survive", () => {
  const area = { x: 0, y: 25, width: 1440, height: 900 };
  const legacy = { x: 123, y: 210, width: 680, height: 96 };
  assert.deepEqual(restoreChatBounds(legacy, area), { ...legacy, height: 64 });
  for (const bounds of [
    { ...legacy, width: 420 },
    { ...legacy, height: 180 },
    { ...legacy, height: 64 },
  ])
    assert.deepEqual(restoreChatBounds(bounds, area), bounds);
  assert.equal(fitChatBounds(legacy, area).height, 96);
  assert.equal(fitChatBounds({ ...legacy, height: 30 }, area).height, 64);
});
test("manual geometry is retained and safely clamped, invalid saved bounds fall back", () => {
  const area = { x: -1000, y: 30, width: 1000, height: 700 };
  const bounds = { x: -900, y: 90, width: 420, height: 260 };
  assert.deepEqual(fitChatBounds(bounds, area), bounds);
  assert.deepEqual(
    fitChatBounds({ x: -3000, y: 9999, width: 9000, height: 9000 }, area),
    { x: -1000, y: 30, width: 1000, height: 700 },
  );
  for (const value of [
    null,
    {},
    { ...bounds, width: -1 },
    { ...bounds, x: Infinity },
  ])
    assert.deepEqual(fitChatBounds(value, area), chatBounds("compact", area));
});
test("command surfaces center inside small, offset and negative-origin monitor work areas", () => {
  for (const area of [
    { x: 0, y: 25, width: 1440, height: 850 },
    { x: -1280, y: -800, width: 1280, height: 760 },
    { x: 1920, y: 40, width: 360, height: 300 },
  ]) {
    for (const mode of [
      "compact",
      "notice",
      "multiline",
      "conversation",
      "settings",
      "menu",
      "inspect",
    ]) {
      const b = chatBounds(mode, area);
      assert.ok(b.x >= area.x && b.y >= area.y);
      assert.ok(b.x + b.width <= area.x + area.width);
      assert.ok(b.y + b.height <= area.y + area.height);
      assert.ok(Math.abs(b.x + b.width / 2 - area.x - area.width / 2) <= 1);
      assert.ok(Math.abs(b.y + b.height / 2 - area.y - area.height / 2) <= 1);
    }
  }
  assert.equal(
    chatBounds("compact", { x: 0, y: 0, width: 1440, height: 900 }).height,
    64,
  );
});
test("renderer cannot supply dimensions or prototype keys", () => {
  for (const value of [
    null,
    {},
    { width: 9000 },
    "toString",
    "__proto__",
    "arbitrary",
    800,
  ]) {
    assert.throws(
      () => chatBounds(value, { x: 0, y: 0, width: 1000, height: 700 }),
      /Invalid chat surface/,
    );
  }
});
