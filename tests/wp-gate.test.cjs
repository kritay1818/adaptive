// All transports injected, no live network. Negative tests exercise the real gate.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Agent, argumentsFor } = require("../src/wp-agent.cjs");
function fixture() {
  const dir = fs.mkdtempSync(
    path.join(process.env.TMPDIR || require("node:os").tmpdir(), "wp-gate-"),
  );
  let writes = 0;
  let before = {
    id: 5,
    status: "publish",
    title: "Before",
    content: "<p>Before</p>",
    modified: "fixture",
  };
  const wp = {
    data: { p: "opaque-connection" },
    status: () => ({ connected: true, site: "https://public.example" }),
    page: async () => structuredClone(before),
    pages: async () => [structuredClone(before)],
    pageRequest: async (_id, _page, payload) => {
      writes++;
      before = { ...before, ...payload };
      return { id: 5 };
    },
  };
  // Same public test-only storage the newer tests use: the encrypted activity log needs it.
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: (buffer) => buffer.toString(),
  };
  const agent = new Agent(wp, dir, { storage });
  return {
    dir,
    wp,
    agent,
    get writes() {
      return writes;
    },
    set before(p) {
      before = p;
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
const proposal = (
  name = "wp_prepare_update_page",
  args = { id: 5, title: "After" },
) => ({ step: async () => ({ calls: [{ id: "x", name, args }] }) });
test("published edit requires explicit review with preserved status and baseline; exactly one POST after approval", async () => {
  const f = fixture();
  try {
    const r = await f.agent.run("p", [], proposal());
    assert.equal(f.writes, 0);
    assert.equal(r.review.status, "publish");
    assert.match(r.review.warning, /מפורסם/);
    assert.equal(r.review.before.title, "Before");
    r.review.payload.title = "Injected renderer mutation";
    await f.agent.decide("p", r.review.token, true);
    assert.equal(f.writes, 1);
    assert.equal((await f.wp.page()).title, "After");
  } finally {
    f.cleanup();
  }
});
test("update readback must preserve unrequested content, not just requested title", async () => {
  const f = fixture();
  try {
    const r = await f.agent.run("p", [], proposal());
    f.wp.pageRequest = async () => {
      f.before = {
        id: 5,
        status: "publish",
        title: "After",
        content: "<p>Unexpected change</p>",
        modified: "fixture",
      };
      return { id: 5 };
    };
    const result = await f.agent.decide("p", r.review.token, true);
    assert.equal(result.outcome, "unknown"); // an unverified write is reported as a result and still blocks the project
    assert.match(result.text, /לא אומתה/);
    assert.equal(f.agent.isBlocked("p"), true);
  } finally {
    f.cleanup();
  }
});
for (const reason of [
  "expired",
  "changed-site",
  "changed-project",
  "cancel",
  "resend",
  "restart",
])
  test("approval fails closed: " + reason, async () => {
    const f = fixture();
    try {
      const r = await f.agent.run("p", [], proposal());
      if (reason === "expired") f.agent.now = () => r.review.expires + 1;
      if (reason === "changed-site") f.wp.data.p = "different-connection";
      if (reason === "cancel") f.agent.cancel("p");
      if (reason === "resend")
        await f.agent.run("p", [], {
          step: async () => ({ text: "new request", calls: [] }),
        });
      const a = reason === "restart" ? new Agent(f.wp, f.dir) : f.agent;
      await assert.rejects(
        a.decide(
          reason === "changed-project" ? "other" : "p",
          r.review.token,
          true,
        ),
      );
      assert.equal(f.writes, 0);
    } finally {
      f.cleanup();
    }
  });
test("snapshot conflict prevents POST", async () => {
  const f = fixture();
  try {
    const r = await f.agent.run("p", [], proposal());
    f.before = {
      id: 5,
      status: "publish",
      title: "External edit",
      content: "<p>Before</p>",
      modified: "changed",
    };
    await assert.rejects(f.agent.decide("p", r.review.token, true), /השתנה/);
    assert.equal(f.writes, 0);
  } finally {
    f.cleanup();
  }
});
test("transport unknown outcome never retries and blocks duplicate/restarted writes", async () => {
  const f = fixture();
  try {
    const r = await f.agent.run("p", [], proposal());
    let requests = 0;
    f.wp.pageRequest = async () => {
      requests++;
      // The write may or may not have landed: the read-back finds a state that is neither the approved one nor the old one.
      f.before = {
        id: 5,
        status: "publish",
        title: "Someone else",
        content: "<p>Other</p>",
        modified: "fixture",
      };
      throw Error("PRIVATE AUTH HEADER NEVER REFLECT");
    };
    const first = await f.agent.decide("p", r.review.token, true);
    assert.equal(first.outcome, "unknown");
    assert.ok(
      !first.text.includes("PRIVATE") && /אין ניסיון חוזר/.test(first.text),
    );
    await assert.rejects(f.agent.decide("p", r.review.token, true));
    await assert.rejects(f.agent.run("p", [], proposal()));
    await assert.rejects(new Agent(f.wp, f.dir).run("p", [], proposal()));
    assert.equal(requests, 1);
    assert.ok(!fs.readFileSync(f.agent.file, "utf8").includes("PRIVATE"));
  } finally {
    f.cleanup();
  }
});
test("an ambiguous write whose read-back still shows the old state is 'not applied': one POST, project not blocked", async () => {
  const f = fixture();
  try {
    const r = await f.agent.run("p", [], proposal());
    let requests = 0;
    f.wp.pageRequest = async () => {
      requests++;
      throw Error("PRIVATE AUTH HEADER NEVER REFLECT");
    };
    const result = await f.agent.decide("p", r.review.token, true);
    assert.equal(result.outcome, "denied");
    assert.match(result.text, /לא הוחל/);
    assert.ok(!result.text.includes("PRIVATE"));
    assert.equal(requests, 1);
    assert.equal(f.agent.isBlocked("p"), false);
    assert.ok((await f.agent.run("p", [], proposal())).review);
  } finally {
    f.cleanup();
  }
});
for (const [name, args] of [
  [
    "wp_prepare_create_page",
    { title: "T", content: "<p>T</p>", status: "publish" },
  ],
  [
    "wp_prepare_create_page",
    { title: "T", content: "<script>alert(1)</script>" },
  ],
  ["wp_prepare_create_page", { title: "T", content: '<p onclick="x">T</p>' }],
  [
    "wp_prepare_create_page",
    { title: "T", content: '<a href="javascript:alert(1)">x</a>' },
  ],
  ["wp_read_page", { id: "5" }],
  ["wp_read_page", { id: 5, url: "https://private" }],
  ["wp_delete_page", { id: 5 }],
  ["wp_prepare_update_page", { id: 5 }],
  ["wp_read_page", JSON.parse('{"id":5,"__proto__":{"approved":true}}')],
])
  test(
    "tool argument injection rejected: " + JSON.stringify({ name, args }),
    () => assert.throws(() => argumentsFor(name, args)),
  );
test("model batch cannot prepare multiple writes, and model calls bounded by the 80-request safety net", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.agent.run("p", [], {
        step: async () => ({
          calls: [
            {
              id: "a",
              name: "wp_prepare_update_page",
              args: { id: 5, title: "A" },
            },
            {
              id: "b",
              name: "wp_prepare_update_page",
              args: { id: 5, title: "B" },
            },
          ],
        }),
      }),
      /שינוי אחד/,
    );
    let n = 0;
    await assert.rejects(
      f.agent.run("p", [], {
        step: async () => {
          n++;
          return {
            calls: [{ id: "a", name: "wp_read_page", args: { id: 5 } }],
          };
        },
      }),
      /מגבלת הביטחון של 80/,
    );
    assert.equal(n, 80);
    assert.equal(f.writes, 0);
  } finally {
    f.cleanup();
  }
});
test("disconnected site offers no tools and cannot execute model-forged tools", async () => {
  const f = fixture();
  try {
    f.wp.status = () => ({ connected: false });
    await assert.rejects(
      f.agent.run("p", [], {
        step: async (_m, tools) => {
          assert.deepEqual(tools, []);
          return {
            calls: [{ id: "a", name: "wp_read_page", args: { id: 5 } }],
          };
        },
      }),
      /ללא חיבור/,
    );
    assert.equal(f.writes, 0);
  } finally {
    f.cleanup();
  }
});
test("cancel while read in flight prevents subsequent provider/tool dispatch", async () => {
  const f = fixture();
  try {
    let release;
    f.wp.page = () => new Promise((r) => (release = r));
    let count = 0;
    const run = f.agent.run("p", [], {
      step: async () => {
        count++;
        return { calls: [{ id: "x", name: "wp_read_page", args: { id: 5 } }] };
      },
    });
    while (!release) await new Promise((r) => setImmediate(r));
    f.agent.cancel("p");
    release({ id: 5 });
    await assert.rejects(run);
    assert.equal(count, 1);
    assert.equal(f.writes, 0);
  } finally {
    f.cleanup();
  }
});
