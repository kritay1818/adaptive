"use strict";
// Video block validation and the upload checks for files the user attaches in the chat. No network.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { safeHTML, assertSiteMedia } = require("../src/wp-content.cjs");
const {
  sniffMedia,
  sniffVideo,
  sniffImage,
  mediaType,
  mediaFields,
  VIDEO_LIMIT,
} = require("../src/wordpress.cjs");
const { argumentsFor } = require("../src/wp-agent.cjs");
const { validatePlan } = require("../src/wp-plans.cjs");

const SITE = "https://salon.example";
const VIDEO_URL = `${SITE}/wp-content/uploads/2026/10/intro.mp4`;
const video = `<!-- wp:video {"id":55,"src":"${VIDEO_URL}","poster":"${SITE}/wp-content/uploads/poster.jpg","controls":true,"muted":true,"loop":true,"playsInline":true,"autoplay":true,"preload":"metadata"} --><figure class="wp-block-video"><video controls autoplay muted loop playsinline preload="metadata" src="${VIDEO_URL}" poster="${SITE}/wp-content/uploads/poster.jpg"></video><figcaption class="wp-element-caption">מאחורי הקלעים</figcaption></figure><!-- /wp:video -->`;

const mp4 = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypisom"),
  Buffer.from([0, 0, 2, 0]),
  Buffer.from("isomiso2"),
  Buffer.alloc(64),
]);
const webm = Buffer.concat([
  Buffer.from([
    0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84,
  ]),
  Buffer.from("webm"),
  Buffer.alloc(64),
]);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const avif = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypavif"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("avifmif1"),
  Buffer.alloc(32),
]);

test("a Gutenberg video block with an uploaded file passes the validator", () => {
  assert.equal(safeHTML(video), video);
  const bare = `<!-- wp:video --><figure class="wp-block-video"><video controls src="${VIDEO_URL}"></video></figure><!-- /wp:video -->`;
  assert.equal(safeHTML(bare), bare);
});

test("video blocks stay locked down: no embeds, no scripts, no extra attributes, https only", () => {
  const swap = (from, to) => video.replace(from, to);
  for (const bad of [
    swap('src="' + VIDEO_URL + '"', 'src="http://salon.example/a.mp4"'), // http
    swap('src="' + VIDEO_URL + '"', 'src="javascript:alert(1)"'),
    swap("controls autoplay", 'controls onplay="x()" autoplay'),
    swap("controls autoplay", "controls download autoplay"), // unknown bare attribute
    swap("controls autoplay", "controls controls autoplay"), // duplicate bare attribute
    swap('preload="metadata"', 'preload="eager"'),
    swap('"autoplay":true', '"autoplay":"yes"'),
    swap('"playsInline":true', '"playsInline":true,"onload":"x"'),
    swap("</video>", '<source src="' + VIDEO_URL + '"></video>'), // <source> is not allowed
    swap(
      "</video>",
      '</video><iframe src="https://www.youtube.com/embed/x"></iframe>',
    ),
    '<!-- wp:embed {"url":"https://www.youtube.com/watch?v=x"} /-->',
    swap(
      " --><figure",
      ' --><figure style="background-image:url(https://x.example/a.png)"',
    ),
    swap("</video>", ""), // unclosed
  ])
    assert.throws(() => safeHTML(bad), undefined, bad.slice(0, 120));
});

test("video src and poster must be files on the connected site", () => {
  assertSiteMedia(video, SITE);
  assert.throws(
    () => assertSiteMedia(video, "https://other.example"),
    /אתר המחובר/,
  );
  const external = video.replaceAll(SITE, "https://cdn.example");
  assert.equal(safeHTML(external), external); // the validator is site-agnostic...
  assert.throws(() => assertSiteMedia(external, SITE), /חיצונית|אסורות/); // ...the site rule is not
  const poster = video.replace(
    `${SITE}/wp-content/uploads/poster.jpg`,
    "https://evil.example/p.jpg",
  );
  assert.throws(() => assertSiteMedia(poster, SITE));
  // While a plan is only being prepared, references resolve to a mock host.
  const mock = video
    .replaceAll(
      SITE + "/wp-content/uploads/2026/10/intro.mp4",
      "https://plan-reference.invalid/vid.png",
    )
    .replaceAll(
      SITE + "/wp-content/uploads/poster.jpg",
      "https://plan-reference.invalid/vid.png",
    );
  assertSiteMedia(mock, SITE, { allowMock: true });
  assert.throws(() => assertSiteMedia(mock, SITE), /אתר המחובר/);
});

test("a plan can upload a user file and place it in a video block by reference", () => {
  const content = video
    .replaceAll(VIDEO_URL, "{{vid.url}}")
    .replace('"id":55', '"id":{{vid.id}}')
    .replace(`"poster":"${SITE}/wp-content/uploads/poster.jpg",`, "")
    .replace(` poster="${SITE}/wp-content/uploads/poster.jpg"`, "");
  const steps = [
    {
      key: "vid",
      tool: "wp_prepare_upload_user_file",
      args: { fileId: "f3k9x2ab01", fileName: "intro", alt: "" },
    },
    {
      key: "home",
      tool: "wp_prepare_create_page",
      args: { title: "בית", content },
    },
  ];
  assert.ok(validatePlan({ title: "וידאו", steps }, argumentsFor));
  assert.throws(
    () =>
      argumentsFor("wp_prepare_upload_user_file", {
        fileId: "../x",
        fileName: "a",
        alt: "",
      }),
    /fileId/,
  );
  assert.throws(
    () =>
      argumentsFor("wp_prepare_upload_user_file", {
        fileId: "f3k9x2ab01",
        fileName: "a b.mp4",
        alt: "",
      }),
    /שם הקובץ/,
  );
  assert.throws(
    () =>
      argumentsFor("wp_prepare_upload_user_file", {
        fileId: "f3k9x2ab01",
        fileName: "a",
        alt: "<b>",
      }),
    /טקסט חלופי/,
  );
});

test("file types come from magic bytes; SVG and disguised files are blocked", () => {
  assert.equal(sniffMedia(mp4), "video/mp4");
  assert.equal(sniffMedia(webm), "video/webm");
  assert.equal(sniffMedia(png), "image/png");
  assert.equal(sniffImage(avif), "image/avif");
  assert.equal(sniffVideo(avif), null, "an AVIF image is not an MP4 video");
  for (const bad of [
    Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='x'/>      "),
    Buffer.from("MZ" + "\0".repeat(64)),
    Buffer.from("not a video at all, just text....."),
    Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypqt  "),
      Buffer.alloc(40),
    ]),
  ])
    assert.equal(sniffMedia(bad), null);
  mediaType(mp4, "video/mp4");
  mediaType(webm, "video/webm");
  assert.throws(() => mediaType(mp4, "video/webm"), /MP4|WebM/);
  assert.throws(() => mediaType(webm, "video/mp4"));
  assert.throws(() => mediaType(png, "video/mp4"));
  assert.throws(() => mediaType(mp4, "video/quicktime"));
});

test("size limits: images 10 MB, videos 200 MB", () => {
  const bigImage = Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)]);
  assert.throws(() => mediaType(bigImage, "image/png"), /10 MB/);
  mediaType(Buffer.concat([mp4, Buffer.alloc(11 * 1024 * 1024)]), "video/mp4"); // a video may exceed the image limit
  const huge = Buffer.concat([mp4, Buffer.alloc(VIDEO_LIMIT)]);
  assert.throws(() => mediaType(huge, "video/mp4"), /200 MB/);
});

test("media field rules: video names end in mp4/webm, alt may be empty for video but never HTML", () => {
  const ok = {
    url: "https://user-file.invalid/f1.mp4",
    fileName: "intro.mp4",
    alt: "",
  };
  mediaFields(ok, "video/mp4");
  assert.throws(
    () => mediaFields({ ...ok, fileName: "intro.exe" }, "video/mp4"),
    /mp4/,
  );
  assert.throws(() =>
    mediaFields({ ...ok, fileName: "intro.png" }, "video/mp4"),
  );
  assert.throws(() => mediaFields({ ...ok, alt: "<b>" }, "video/mp4"));
  assert.throws(() =>
    mediaFields({ ...ok, fileName: "../intro.mp4" }, "video/mp4"),
  );
  assert.throws(() =>
    mediaFields(
      { url: "http://x.example/a.png", fileName: "a.png", alt: "x" },
      "image/png",
    ),
  );
  mediaFields(
    { url: "https://x.example/a.png", fileName: "a.png", alt: "" },
    "image/png",
  ); // empty alt = decorative image, as before
});
