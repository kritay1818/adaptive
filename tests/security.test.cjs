const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { authorize } = require("../src/security.cjs");
test("IPC rejects unknown windows, wrong local page, and subframes", () => {
  const frame = { url: "file:///app/index.html" };
  const sender = { mainFrame: frame };
  const event = { sender, senderFrame: frame };
  const targets = [{ sender, role: "index", url: frame.url }];
  assert.doesNotThrow(() => authorize(event, ["index"], targets));
  assert.throws(() => authorize(event, ["pet"], targets), /Access denied/);
  assert.throws(
    () => authorize({ ...event, sender: {} }, ["index"], targets),
    /Access denied/,
  );
  assert.throws(
    () =>
      authorize(
        { ...event, senderFrame: { url: frame.url } },
        ["index"],
        targets,
      ),
    /Access denied/,
  );
  assert.throws(
    () =>
      authorize(
        event,
        ["index"],
        [{ ...targets[0], url: "file:///different.html" }],
      ),
    /Access denied/,
  );
});
