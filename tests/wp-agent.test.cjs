// All WP/provider transports here are injected fixtures. No live requests.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { WordPress } = require("../src/wordpress.cjs");
const { Agent } = require("../src/wp-agent.cjs");
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
}; // public test-only sentinel
function fixture() {
  const dir = fs.mkdtempSync(
    path.join(process.env.TMPDIR || require("node:os").tmpdir(), "wp-agent-"),
  );
  const calls = [];
  const wp = new WordPress(dir, storage, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (url, options) => {
      calls.push({ url, options });
      return {
        status: 200,
        body: JSON.stringify(
          url.searchParams.get("rest_route").endsWith("users/me")
            ? { id: 1 }
            : [
                {
                  id: 4,
                  status: "draft",
                  title: { raw: "Example" },
                  content: { raw: "<p>Example</p>" },
                  modified: "2026-01-01",
                },
              ],
        ),
      };
    },
  });
  return { dir, wp, calls };
}
test("injected WP pages GET uses authenticated pinned query route and never exposes credentials", async () => {
  const { wp, calls, dir } = fixture();
  try {
    await wp.connect("project", {
      site: "https://public.example/blog",
      username: "fixture",
      password: "PUBLIC-DUMMY",
    });
    const pages = await wp.pages("project");
    assert.equal(pages[0].id, 4);
    assert.equal(calls[1].url.pathname, "/blog/index.php");
    assert.equal(calls[1].url.searchParams.get("rest_route"), "/wp/v2/pages");
    assert.equal(calls[1].options.method, "GET");
    assert.equal(calls[1].options.address, "93.184.216.34");
    assert.ok(!JSON.stringify(pages).includes("PUBLIC-DUMMY"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("injected approval gate binds exact payload, deny no write, approve once and GET verifies", async () => {
  const { wp, calls, dir } = fixture();
  try {
    await wp.connect("p", {
      site: "https://public.example",
      username: "fixture",
      password: "PUBLIC-DUMMY",
    });
    const agent = new Agent(wp, dir);
    const provider = {
      step: async () => ({
        text: "",
        calls: [
          {
            id: "call",
            name: "wp_prepare_create_page",
            args: { title: "Example", content: "<p>Example</p>" },
          },
        ],
      }),
    };
    const pending = await agent.run(
      "p",
      [{ role: "user", content: "Create draft" }],
      provider,
    );
    assert.equal(pending.review.payload.status, "draft");
    assert.equal(calls.filter((c) => c.options.method === "POST").length, 0);
    await agent.decide("p", pending.review.token, false);
    assert.equal(calls.filter((c) => c.options.method === "POST").length, 0);
    const next = await agent.run(
      "p",
      [{ role: "user", content: "Create draft" }],
      provider,
    );
    wp.request = async (url, options) => {
      calls.push({ url, options });
      return {
        status: options.method === "POST" ? 201 : 200,
        body: JSON.stringify({
          id: 9,
          status: "draft",
          title: { raw: "Example" },
          content: { raw: "<p>Example</p>" },
          modified: "now",
        }),
      };
    };
    const result = await agent.decide("p", next.review.token, true);
    assert.match(result.text, /אומת/);
    assert.equal(calls.filter((c) => c.options.method === "POST").length, 1);
    assert.equal(
      calls.at(-1).url.searchParams.get("rest_route"),
      "/wp/v2/pages/9",
    );
    await assert.rejects(agent.decide("p", next.review.token, true));
    assert.equal(calls.filter((c) => c.options.method === "POST").length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
