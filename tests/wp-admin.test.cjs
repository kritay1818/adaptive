// Explicit injected WP admin extension fixtures; never live credentials/network.
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
};
test("scoped posts draft approval, sanitized capabilities/media/settings reads; forbidden resources denied", async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "wp-admin-"));
  let writes = 0;
  const calls = [];
  let payload;
  try {
    const wp = new WordPress(dir, storage, {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async (url, o) => {
        const route = url.searchParams.get("rest_route");
        calls.push(route);
        let data;
        if (route.endsWith("users/me"))
          data = {
            id: 1,
            capabilities: {
              edit_pages: true,
              edit_posts: true,
              manage_options: true,
              upload_files: true,
              administrator: true,
            },
            email: "NOT-FOR-MODEL",
          };
        else if (route.endsWith("media"))
          data = [
            {
              id: 8,
              title: { rendered: "Media" },
              media_type: "image",
              source_url: "https://public.example/a.png",
            },
          ];
        else if (route.endsWith("settings"))
          data = {
            title: "Site",
            description: "Description",
            admin_email: "NOT-FOR-MODEL",
            timezone: "UTC",
          };
        else {
          if (o.method === "POST") {
            writes++;
            payload = JSON.parse(o.body);
          }
          data = {
            id: 11,
            status: "draft",
            title: { raw: payload?.title || "Post" },
            content: { raw: payload?.content || "<p>Post</p>" },
            modified: "fixture",
          };
        }
        return {
          status: o.method === "POST" ? 201 : 200,
          body: JSON.stringify(data),
        };
      },
    });
    await wp.connect("p", {
      site: "https://public.example",
      username: "fixture",
      password: "PUBLIC-DUMMY",
    });
    const caps = await wp.capabilities("p");
    assert.equal(caps.edit_posts, true);
    assert.ok(!JSON.stringify(caps).includes("NOT-FOR-MODEL"));
    const media = await wp.media("p");
    assert.equal(media[0].id, 8);
    const settings = await wp.settings("p");
    assert.equal(settings.title, "Site");
    assert.ok(!JSON.stringify(settings).includes("NOT-FOR-MODEL"));
    const agent = new Agent(wp, dir);
    const proposal = await agent.run("p", [{ role: "user", content: "Post" }], {
      step: async () => ({
        calls: [
          {
            id: "a",
            name: "wp_prepare_create_post",
            args: { title: "Post", content: "<p>Post</p>" },
          },
        ],
      }),
    });
    assert.equal(writes, 0);
    assert.equal(proposal.review.resource, "posts");
    await agent.decide("p", proposal.review.token, true);
    assert.equal(writes, 1);
    assert.equal(calls.at(-1), "/wp/v2/posts/11");
    await assert.rejects(
      wp.pageRequest(
        "p",
        null,
        { title: "Forbidden" },
        {},
        undefined,
        "plugins",
      ),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
