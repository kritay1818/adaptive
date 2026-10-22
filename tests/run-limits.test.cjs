"use strict";
// Injected provider and WordPress stand-ins: no network, nothing written.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Agent } = require("../src/wp-agent.cjs");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-limits-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wp = {
    data: { p: "opaque-connection" },
    status: () => ({ connected: true, site: "https://public.example" }),
    page: async () => ({ id: 5 }),
    pages: async () => [],
    pageRequest: async () => {
      throw Error("no writes");
    },
  };
  return new Agent(wp, dir);
}
const provider = (steps, extra = {}) => {
  let i = 0;
  return {
    status: () => ({ providerId: "anthropic", model: "claude-sonnet-5-5" }),
    step: async () => steps[Math.min(i++, steps.length - 1)](),
    ...extra,
  };
};
const usage = (input, output) => ({
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
});
const call = (name, args, id = Math.random().toString(36).slice(2)) => ({
  id,
  name,
  args,
});

test("every result lists the run trail: call number, tool, outcome, tokens and cost", async (t) => {
  const agent = fixture(t);
  const steps = [
    async () => ({
      text: "",
      calls: [call("wp_plan_start", { title: "בית" })],
      usage: usage(1200, 300),
    }),
    async () => ({
      text: "",
      calls: [
        call("wp_plan_add_step", {
          step: {
            key: "home",
            tool: "wp_prepare_create_page",
            args: { title: "בית", content: "[התוכן המלא]" },
          },
        }),
      ],
      usage: usage(2000, 900),
    }),
    async () => ({ text: "סיום", calls: [], usage: usage(2500, 50) }),
  ];
  const result = await agent.run("p", [], provider(steps));
  const tech = result.text.split("\n--TECH--\n")[1];
  assert.match(tech, /מסלול הריצה:/);
  assert.match(tech, /#1 wp_plan_start ✓ — קלט 1,200 · פלט 300 · ≈\$/);
  assert.match(tech, /#2 wp_plan_add_step ✗ .*תוכן העמוד המלא/);
  assert.match(tech, /#3 \(תשובת טקסט\)/);
});

test("the trail is attached to thrown errors too", async (t) => {
  const agent = fixture(t);
  const steps = [
    async () => ({
      text: "",
      calls: [call("wp_list_pages", {})],
      usage: usage(10, 5),
    }),
    async () => {
      throw Object.assign(new Error("provider down"), {
        status: 529,
        kind: "http",
      });
    },
  ];
  await assert.rejects(agent.run("p", [], provider(steps)), (e) =>
    /#1 wp_list_pages/.test(e.trail),
  );
});

test("the same rejection three times stops the task and names the step and reason", async (t) => {
  const agent = fixture(t);
  let n = 0;
  const bad = async () => {
    n++;
    return {
      text: "",
      calls: [
        call("wp_plan_add_step", {
          step: {
            key: "home",
            tool: "wp_prepare_create_page",
            args: { title: "בית", content: "תוכן העמוד כאן" },
          },
        }),
      ],
      usage: usage(100, 50),
    };
  };
  const result = await agent.run(
    "p",
    [],
    provider([
      async () => ({
        text: "",
        calls: [call("wp_plan_start", { title: "בית" })],
        usage: usage(50, 10),
      }),
      bad,
    ]),
  );
  assert.equal(n, 3);
  assert.match(
    result.text,
    /המשימה נתקעה: wp_plan_add_step \(שלב "home"\) נדחה 3 פעמים/,
  );
  assert.match(result.text, /תוכן העמוד המלא/);
  assert.match(result.text, /מסלול הריצה:/);
});

test("a task that exceeds its cost cap pauses with המשך / עצירה before anything more runs", async (t) => {
  const agent = fixture(t);
  agent.capBase.set("p", 0.01);
  let executed = 0;
  const wp = agent.wp;
  wp.page = async () => {
    executed++;
    return { id: 5 };
  };
  const steps = [
    async () => ({
      text: "",
      calls: [call("wp_read_page", { id: 5 })],
      usage: usage(100000, 20000),
    }),
  ];
  const result = await agent.run("p", [], provider(steps), { resume: true }); // resume keeps the preset cap
  assert.match(
    result.text,
    /המשימה עלתה עד עכשיו \$\d+\.\d\d, יותר מהצפוי — להמשיך\?/,
  );
  assert.match(result.text, /--BTN--\n\["resume","stop"\]/);
  assert.equal(executed, 0);
  assert.ok(agent.spent.get("p") > 0);
});

test("up to 12 tool calls per response are accepted", async (t) => {
  const agent = fixture(t);
  const many = Array.from({ length: 12 }, (_, i) =>
    call("wp_list_pages", {}, `c${i}`),
  );
  const steps = [
    async () => ({ text: "", calls: many, usage: usage(10, 5) }),
    async () => ({ text: "ok", calls: [], usage: usage(10, 5) }),
  ];
  const result = await agent.run("p", [], provider(steps, {}));
  assert.match(result.text, /^ok/);
});
