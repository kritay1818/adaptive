"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { safeHTML, argumentsFor } = require("../src/wp-agent.cjs");

const designedPage = `<!-- wp:group {"align":"full","style":{"color":{"background":"#101828","text":"#ffffff"},"spacing":{"padding":{"top":"64px","bottom":"64px","left":"24px","right":"24px"}}},"layout":{"type":"constrained","contentSize":"1100px"}} -->
<div class="wp-block-group alignfull" style="background-color:#101828;color:#ffffff;padding-top:64px;padding-bottom:64px;padding-left:24px;padding-right:24px">
<!-- wp:heading {"level":1,"textAlign":"center","style":{"typography":{"fontSize":"48px"}}} --><h1 class="wp-block-heading has-text-align-center" style="font-size:48px">בית מעוצב</h1><!-- /wp:heading -->
<!-- wp:columns --><div class="wp-block-columns"><!-- wp:column {"width":"50%"} --><div class="wp-block-column" style="flex-basis:50%">
<!-- wp:image {"id":42,"url":"https://images.example/hero.png","alt":"נוף","sizeSlug":"full"} --><figure class="wp-block-image size-full"><img src="https://images.example/hero.png" alt="נוף" class="wp-image-42" /></figure><!-- /wp:image -->
</div><!-- /wp:column --><!-- wp:column --><div class="wp-block-column">
<!-- wp:paragraph --><p>עמוד עם תוכן ותמונה</p><!-- /wp:paragraph -->
<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} --><div class="wp-block-buttons"><!-- wp:button {"backgroundColor":"primary"} --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="https://public.example/contact">יצירת קשר</a></div><!-- /wp:button --></div><!-- /wp:buttons -->
</div><!-- /wp:column --></div><!-- /wp:columns -->
<!-- wp:spacer {"height":"40px"} --><div style="height:40px" aria-hidden="true" class="wp-block-spacer"></div><!-- /wp:spacer -->
<!-- wp:separator --><hr class="wp-block-separator" /><!-- /wp:separator -->
<!-- wp:quote --><blockquote class="wp-block-quote"><!-- wp:paragraph --><p>עיצוב שמדבר</p><!-- /wp:paragraph --><cite>הצוות</cite></blockquote><!-- /wp:quote -->
<!-- wp:list --><ul class="wp-block-list"><!-- wp:list-item --><li>יתרון</li><!-- /wp:list-item --></ul><!-- /wp:list -->
</div><!-- /wp:group -->`;

test("designed Gutenberg content preserves exact serialized markup", () => {
  assert.equal(safeHTML(designedPage), designedPage);
  assert.equal(
    argumentsFor("wp_prepare_create_page", {
      title: "עיצוב",
      content: designedPage,
    }).content,
    designedPage,
  );
  for (const content of [
    '<!-- wp:gallery {"columns":2,"imageCrop":true} --><figure class="wp-block-gallery has-nested-images columns-2"><!-- wp:image {"id":42} --><figure class="wp-block-image"><img src="https://images.example/a.png" alt="" /></figure><!-- /wp:image --></figure><!-- /wp:gallery -->',
    '<!-- wp:cover {"url":"https://images.example/a.png","id":42,"alt":"נוף","dimRatio":50,"minHeight":400,"minHeightUnit":"px"} --><div class="wp-block-cover" style="min-height:400px"><span aria-hidden="true" class="wp-block-cover__background has-background-dim"></span><img class="wp-block-cover__image-background" alt="נוף" src="https://images.example/a.png" style="object-fit:cover" /><div class="wp-block-cover__inner-container"><!-- wp:paragraph --><p>כותרת</p><!-- /wp:paragraph --></div></div><!-- /wp:cover -->',
    '<!-- wp:group {"style":{"spacing":{"padding":"var:preset|spacing|50"},"typography":{"fontSize":"2rem"}},"layout":{"type":"flex","flexWrap":"wrap"}} --><div style="padding:var(--wp--preset--spacing--50);font-size:2rem"><p>תוכן</p></div><!-- /wp:group -->',
  ])
    assert.equal(safeHTML(content), content);
});

test("executable, ambiguous and unapproved Gutenberg/HTML/CSS is rejected", () => {
  for (const content of [
    "<script>alert(1)</script>",
    '<iframe src="https://example.com"></iframe>',
    '<embed src="https://example.com">',
    "<form><p>x</p></form>",
    '<svg onload="alert(1)"></svg>',
    "<!-- wp:html --><p>x</p><!-- /wp:html -->",
    '<!-- wp:embed {"url":"https://example.com"} /-->',
    '<img src="https://images.example/a.png" onerror="alert(1)">',
    '<img src="https://images.example/a.png" ONLOAD="alert(1)">',
    '<a href="javascript:alert(1)">x</a>',
    '<a href="jav&#97;script:alert(1)">x</a>',
    '<a href="java&#x09;script:alert(1)">x</a>',
    '<img src="data:image/svg+xml,test">',
    '<img src="https://images.example/a.png" src="javascript:alert(1)">',
    '<p style="background-image:url(https://example.com/a.png)">x</p>',
    '<p style="color:expression(alert(1))">x</p>',
    '<p style="color:r/**/ed">x</p>',
    '<p style="color: red; position:fixed">x</p>',
    '<!-- wp:group {"style":{"color":{"background":"url(javascript:alert(1))"}}} --><div></div><!-- /wp:group -->',
    '<!-- wp:group {"metadata":{"bindings":{"content":{"source":"evil"}}}} /-->',
    '<!-- wp:group {"__proto__":{"onload":"evil"}} /-->',
    '<!-- wp:image {"url":"javascript:alert(1)"} /-->',
    '<!-- wp:image {"onload":"alert(1)"} /-->',
    '<!-- wp:group {"style":{"spacing":{"padding":{"top":"1px;position:fixed"}}}} /-->',
    "<!-- wp:paragraph --><p>x</p><!-- /wp:heading -->",
    "<p><strong>x</p></strong>",
    "<p title=unsafe>x</p>",
    "<p>[embed]https://example.com[/embed]</p>",
    '<p>[contact-form-7 id="1"]</p>',
  ])
    assert.throws(() => safeHTML(content), undefined, content);
});

test("upload tool rejects bad URLs, filenames, alt markup and renderer-like extra fields", () => {
  const fields = {
    url: "https://images.example/a.png?size=large",
    fileName: "hero.png",
    alt: "תמונה",
  };
  assert.deepEqual(argumentsFor("wp_prepare_upload_image", fields), fields);
  for (const patch of [
    { url: "http://images.example/a.png" },
    { url: "https://127.0.0.1/a.png" },
    { url: "https://name:secret@images.example/a.png" },
    { url: "https://images.example:444/a.png" },
    { fileName: "../hero.png" },
    { fileName: "hero.png\r\nx-header: yes" },
    { fileName: "hero.svg" },
    { alt: '<img src="x">' },
    { target: "https://other.example" },
  ])
    assert.throws(() =>
      argumentsFor("wp_prepare_upload_image", { ...fields, ...patch }),
    );
});

const { validatePlan, replaceRefs } = require("../src/wp-plans.cjs");
const coverWithRefs = (idJson = "{{hero.id}}") =>
  `<!-- wp:cover {"url":"{{hero.url}}","id":${idJson},"dimRatio":50,"overlayColor":"black","minHeight":480,"isDark":true,"align":"full"} --><div class="wp-block-cover alignfull is-dark" style="min-height:480px"><span aria-hidden="true" class="wp-block-cover__background has-black-background-color has-background-dim"></span><img class="wp-block-cover__image-background wp-image-{{hero.id}}" alt="נוף" src="{{hero.url}}" data-object-fit="cover"/><div class="wp-block-cover__inner-container"><!-- wp:heading {"level":1,"textAlign":"center"} --><h1 class="wp-block-heading has-text-align-center">כותרת</h1><!-- /wp:heading --><!-- wp:paragraph --><p>שורת משנה</p><!-- /wp:paragraph --><!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="https://example.com/contact">צרו קשר</a></div><!-- /wp:button --></div><!-- /wp:buttons --></div></div><!-- /wp:cover -->`;
const planWith = (content) => ({
  title: "בית",
  steps: [
    {
      key: "hero",
      tool: "wp_prepare_upload_image",
      args: {
        url: "https://images.example/hero.png",
        fileName: "hero.png",
        alt: "נוף",
      },
    },
    {
      key: "home",
      tool: "wp_prepare_create_page",
      args: { title: "בית", content },
    },
  ],
});

test("a Gutenberg cover that uses an uploaded-image reference passes plan validation", () => {
  for (const idJson of ["{{hero.id}}", '"{{hero.id}}"'])
    assert.ok(validatePlan(planWith(coverWithRefs(idJson)), argumentsFor));
  // The quoted form is normalized to a bare verified integer before it is checked and written.
  const out = replaceRefs(
    coverWithRefs('"{{hero.id}}"'),
    new Map([["hero", { id: 77, url: "https://images.example/hero.png" }]]),
  );
  assert.match(out, /"id":77,/);
  assert.equal(safeHTML(out), out);
});

test("cover rejections name the exact attribute or markup problem", () => {
  const plain = coverWithRefs()
    .replaceAll("{{hero.id}}", "42")
    .replaceAll("{{hero.url}}", "https://images.example/hero.png");
  assert.equal(safeHTML(plain), plain);
  assert.throws(
    () => safeHTML(plain.replace('data-object-fit="cover"', 'data-evil="x"')),
    /data-evil.*<img>/,
  );
  assert.throws(
    () =>
      safeHTML(
        plain.replace('"dimRatio":50', '"dimRatio":50,"useFeaturedImage":true'),
      ),
    /useFeaturedImage.*wp:cover/,
  );
  assert.throws(
    () => safeHTML(plain.replace('"dimRatio":50', '"dimRatio":500')),
    /dimRatio/,
  );
  assert.throws(
    () =>
      safeHTML(
        plain.replace(
          'class="wp-block-cover alignfull is-dark"',
          "class='x' onclick=\"1\"",
        ),
      ),
    /onclick|class|מאפיין/,
  );
  assert.throws(
    () =>
      safeHTML(
        plain.replace(
          'style="min-height:480px"',
          'style="background-image:url(https://example.com/a.png)"',
        ),
      ),
    /style/,
  );
  assert.throws(
    () => safeHTML(plain.replace("</span>", "")),
    /לא נסגר|לא תקין|לא תואם/,
  );
});

test("plan page steps reject notes and placeholders; real block HTML passes", () => {
  const plan = (content) => ({
    title: "בית",
    steps: [
      {
        key: "home",
        tool: "wp_prepare_create_page",
        args: { title: "בית", content },
      },
    ],
  });
  for (const bad of [
    "[שלב 3 נוסף: עמוד 'אודות' — התוכן המלא נשמר באפליקציה]",
    "תוכן העמוד כאן",
    "<p>[התוכן המלא נשמר באפליקציה]</p>",
    "<p>TODO</p>",
    "<p>placeholder</p>",
    "<p></p>",
  ])
    assert.throws(
      () => validatePlan(plan(bad), argumentsFor),
      /תוכן העמוד המלא כ־HTML של בלוקים/,
      bad,
    );
  assert.ok(
    validatePlan(
      plan(
        "<!-- wp:paragraph --><p>ברוכים הבאים למספרה</p><!-- /wp:paragraph -->",
      ),
      argumentsFor,
    ),
  );
});

test("root-relative and https links are allowed; other schemes and protocol-relative links are not", () => {
  const link = (href) => `<p><a href="${href}">x</a></p>`;
  for (const ok of [
    "/contact/",
    "/about/?x=1#top",
    "https://example.com/a",
    "#top",
  ])
    assert.equal(safeHTML(link(ok)), link(ok), ok);
  for (const bad of [
    "//evil.com/x",
    "javascript:alert(1)",
    "data:text/html,x",
    "mailto:a@b.c",
    "/\\evil.com",
    "http://example.com",
    "contact/",
  ])
    assert.throws(() => safeHTML(link(bad)), /href/, bad);
  const button =
    '<!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="/contact/">צרו קשר</a></div><!-- /wp:button -->';
  assert.equal(safeHTML(button), button);
});

test("tel: and mailto: links are allowed only in strict forms", () => {
  const link = (href) => `<p><a href="${href}">x</a></p>`;
  for (const ok of [
    "tel:+972-3-123-4567",
    "tel:(03) 123 4567",
    "tel:0501234567",
    "mailto:info@salon.co.il",
    "mailto:a.b+c@example.com?subject=Hello%20there",
    "mailto:info@salon.co.il?subject=שלום",
  ])
    assert.equal(safeHTML(link(ok)), link(ok), ok);
  for (const bad of [
    "tel:",
    "tel:12",
    "tel:+972abc",
    "tel:123;ext=1",
    "tel:1234567890123456789",
    "tel:+972%2D3123456",
    "mailto:",
    "mailto:not-an-email",
    "mailto:a@b",
    "mailto:a@b.com,c@d.com",
    "mailto:a@b.com;c@d.com",
    "mailto:a@b.com?cc=c@d.com",
    "mailto:a@b.com?subject=x&bcc=c@d.com",
    "mailto:a@b.com?body=hi",
    "mailto:a@b.com?subject=<x>",
    "mailto:a b@c.com",
    "MAILTO:a@b.com",
    "sms:+972501234567",
    "javascript:alert(1)",
    "data:text/html,x",
  ])
    assert.throws(() => safeHTML(link(bad)), undefined, bad);
  // Only <a href>; not the image block's href attribute.
  assert.throws(() =>
    safeHTML('<!-- wp:image {"href":"tel:+972501234567"} /-->'),
  );
});
