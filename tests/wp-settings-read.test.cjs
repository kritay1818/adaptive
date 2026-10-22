"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SiteStructure } = require("../src/wp-structure.cjs");

// Shape of a real WordPress 6.x GET /wp/v2/settings?context=edit response (many unrelated fields).
const wp6 = (patch = {}) => ({
  title: "המספרה של דנה",
  description: "תספורות בתל אביב",
  url: "https://salon.example",
  email: "admin@salon.example",
  timezone: "Asia/Jerusalem",
  date_format: "j בF Y",
  time_format: "H:i",
  start_of_week: 0,
  language: "he_IL",
  use_smilies: true,
  default_category: 1,
  default_post_format: "0",
  posts_per_page: 10,
  show_on_front: "page",
  page_on_front: 12,
  page_for_posts: 0,
  default_ping_status: "open",
  default_comment_status: "open",
  site_logo: 345,
  site_icon: 0,
  some_plugin_option: { nested: [1, 2] },
  ...patch,
});
const structure = (data) => {
  const s = new SiteStructure({});
  s.request = async () => data;
  return s;
};
const ALL = [
  "title",
  "description",
  "show_on_front",
  "page_on_front",
  "site_logo",
];

test("a realistic WordPress 6.x settings response is read; unknown fields and site_icon 0 are ignored", async () => {
  const result = await structure(wp6()).settings("p", ALL, undefined, [
    "site_logo",
  ]);
  assert.deepEqual(result, {
    title: "המספרה של דנה",
    description: "תספורות בתל אביב",
    show_on_front: "page",
    page_on_front: 12,
    site_logo: 345,
  });
  assert.deepEqual(
    await structure(wp6({ site_icon: null })).settings("p", ["title"]),
    { title: "המספרה של דנה" },
  );
});

test("site_logo null/false means unset, and a missing site_logo does not break the read", async () => {
  assert.equal(
    (
      await structure(wp6({ site_logo: null })).settings("p", ALL, undefined, [
        "site_logo",
      ])
    ).site_logo,
    0,
  );
  assert.equal(
    (await structure(wp6({ site_logo: false })).settings("p", ["site_logo"]))
      .site_logo,
    0,
  );
  const { site_logo, ...withoutLogo } = wp6();
  assert.deepEqual(
    Object.keys(
      await structure(withoutLogo).settings("p", ALL, undefined, ["site_logo"]),
    ),
    ["title", "description", "show_on_front", "page_on_front"],
  );
  // ...but a logo write needs it: required when not optional, with the key in the technical detail.
  await assert.rejects(
    structure(withoutLogo).settings("p", ["site_logo"]),
    (e) => /לוגו/.test(e.message) && /site_logo/.test(e.detail),
  );
});

test("keys we write stay strict, and the failing key and value type are reported", async () => {
  await assert.rejects(
    structure(wp6({ page_on_front: "12" })).settings("p", ALL),
    (e) =>
      /אינן תקינות/.test(e.message) && /page_on_front.*string/.test(e.detail),
  );
  await assert.rejects(
    structure(wp6({ show_on_front: "latest" })).settings("p", ALL),
    (e) => /show_on_front/.test(e.detail),
  );
  await assert.rejects(
    structure(wp6({ title: null })).settings("p", ALL),
    (e) => /title.*null/.test(e.detail),
  );
  await assert.rejects(
    structure(wp6({ site_logo: "abc" })).settings("p", ALL),
    (e) => /site_logo/.test(e.detail),
  );
  await assert.rejects(
    structure(wp6({ site_logo: -1 })).settings("p", ALL),
    (e) => /site_logo/.test(e.detail),
  );
  await assert.rejects(structure([]).settings("p", ALL), (e) =>
    /לא החזיר מצב תקין/.test(e.message),
  );
});
