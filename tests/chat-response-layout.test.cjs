const test = require("node:test");
const assert = require("node:assert/strict");
const { expandChatBounds } = require("../src/chat-layout.cjs");
test("notice/reply grow upward from persisted64 retaining width/x and bottom, never recenter", () => {
  const area = { x: -1200, y: -800, width: 1200, height: 760 };
  const bounds = { x: -1100, y: -300, width: 760, height: 64 };
  const notice = expandChatBounds("notice", bounds, area);
  assert.deepEqual(notice, { ...bounds, y: -380, height: 144 });
  assert.deepEqual(expandChatBounds("conversation", notice, area), {
    ...bounds,
    y: -516,
    height: 280,
  });
  for (const surface of ["compact", "menu", "settings", "inspect", "multiline"])
    assert.deepEqual(expandChatBounds(surface, bounds, area), bounds);
});
test("manual taller geometry stays exact; top-edge expansion is clamped rather than teleported", () => {
  const area = { x: 100, y: 40, width: 1000, height: 700 };
  const tall = { x: 120, y: 80, width: 420, height: 600 };
  for (const surface of ["notice", "conversation", "compact"])
    assert.deepEqual(expandChatBounds(surface, tall, area), tall);
  const top = { ...tall, y: 45, height: 64 };
  assert.deepEqual(expandChatBounds("conversation", top, area), {
    ...top,
    y: 40,
    height: 280,
  });
  const small = { x: -300, y: 0, width: 300, height: 180 };
  assert.deepEqual(
    expandChatBounds(
      "conversation",
      { x: -290, y: 100, width: 280, height: 64 },
      small,
    ),
    { x: -290, y: 0, width: 280, height: 180 },
  );
});
test("invalid semantic surfaces cannot change geometry", () => {
  for (const surface of [
    { height: 1000 },
    "__proto__",
    "toString",
    "arbitrary",
    null,
  ])
    assert.throws(
      () =>
        expandChatBounds(
          surface,
          { x: 0, y: 50, width: 760, height: 64 },
          { x: 0, y: 0, width: 1000, height: 700 },
        ),
      /Invalid chat surface/,
    );
});
