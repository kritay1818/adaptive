// All transports injected, no live network. Negative tests exercise the real gate.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Agent, argumentsFor } = require("../src/wp-agent.cjs");
function fixture() {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "wp-gate-"));
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
  const agent = new Agent(wp, dir);
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
    await assert.rejects(f.agent.decide("p", r.review.token, true), /לא אומתה/);
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
      throw Error("PRIVATE AUTH HEADER NEVER REFLECT");
    };
    await assert.rejects(
      f.agent.decide("p", r.review.token, true),
      (e) =>
        !e.message.includes("PRIVATE") && /אין ניסיון חוזר/.test(e.message),
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
test("model batch cannot prepare multiple writes, and model calls bounded to 8", async () => {
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
      /מגבלת 8/,
    );
    assert.equal(n, 8);
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
