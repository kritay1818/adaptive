# WordPress agent execution (implemented, not prompt-only)

## Supported capabilities

`wp_list_pages`, `wp_read_page`, `wp_prepare_create_page`, `wp_prepare_update_page`; the equivalent `*_posts` / `*_post` tools; `wp_get_capabilities`, `wp_list_media`, `wp_read_settings`.

- Lists are paginated (20 items; explicitly request subsequent pages). Reads expose title/raw content/status, not credentials. Page/post contents and media/settings text are **untrusted reference data**, never instructions.
- New pages/posts are **drafts only**. Updates replace only explicit title/content and preserve draft/publish status. No transition to publish, deletion, trash, status change, plugin/theme/user/payment/DNS operation or arbitrary HTTP/shell tool exists.
- Basic inert HTML/Gutenberg subset only: paragraphs, headings, lists, group/section/div, inline emphasis, HTTPS links; limited class/href attributes and simple WordPress block comments. No scripts, inline CSS, embeds, forms, arbitrary attributes, images/uploads or external execution. Unsupported markup fails rather than being silently rewritten. This is **not Elementor visual editing, whole-site migration, theme styling, or full WordPress administration**.
- Authenticated `/users/me?context=edit` supplies a sanitized boolean capability map at connection; `wp_get_capabilities` refreshes it on explicit model tool request. Capabilities are reported permissions, not proof every action works. WordPress enforces object-specific permissions; site settings require `manage_options`. Existing connections without stored capabilities report unknown until explicit discovery. Admin authentication is not a claim of full control.
- Themes/plugin installation, server files and advanced Elementor integration require a separately trusted, scoped connector or SSH integration and a new security/review design. None is invented here.

## Model tool protocol matrix

| Provider | Implemented wire protocol | Result continuation | Verification |
|---|---|---|---|
| Gemini | `generateContent`, `tools[].functionDeclarations`, OpenAPI schema subset | Full native model turn (including `thoughtSignature`), `functionResponse` name/id/response | Official Google REST/function-calling documentation inspected; injected native Electron end-to-end |
| OpenAI | Chat Completions `tools[].type=function`, `function` schema | Native assistant `tool_calls`; tool message `tool_call_id` | Injected contract tests |
| Anthropic | Messages `tools[].input_schema` | Native `tool_use` blocks; grouped user `tool_result` with `tool_use_id` | Injected contract tests |
| Moonshot international | Documented Chat Completions function tools | `tool_calls` / `tool_call_id`, preserving `reasoning_content` | Injected contract tests |
| Qwen Singapore | Documented OpenAI-compatible function tools | `tool_calls` / `tool_call_id` | Injected contract tests |

All five adapters are implemented; **no live model/WP request was made in this implementation task**. Tool support depends on the selected model, not merely its presence in discovery or prior text-chat validation. An incompatible model fails visibly; there is no silent fallback, tool-free simulated execution or paid retry. Disconnected WordPress keeps the existing text-chat path with no tool schema.

The bounded loop makes at most 8 model requests (4096 output tokens each), 20 tools, 4 read calls per response (executed sequentially), 240000 characters of serialized loop context, and a 90-second shared deadline. This bounds request/token exposure, not an exact dollar charge: provider pricing varies. Each WP request shares 15 seconds across DNS + HTTPS, 256 KiB body cap, public IPv4 DNS validation and pinned TLS socket, rejecting **all redirects**. Fixed standard REST resources use installation-relative `index.php?rest_route=/wp/v2/...`, not hardcoded pretty-permalink routes.

## Review and exactly-once local dispatch

1. Chat may read pages/posts and prepare a single exact change. Preparation performs **no POST** and pauses the model loop. The app—not model text—opens the separate native history window with a review card containing project/site/resource/page, existing snapshot, exact payload, preserved status and published-site warning. Ordinary text replies do not open this window automatically or expand the compact command bar.
2. **אישור וביצוע** explicitly authorizes that exact immutable payload; **דחייה — ללא כתיבה** consumes it without a write. New Send supersedes an outstanding review. Confirming does not rerun model generation: the deterministic main-process executor supplies the outcome, avoiding extra cost or a second proposed write.
3. Main binds a random once-only token to project, encrypted connection fingerprint, resource, page, payload, snapshot and five-minute expiry. Renderer cannot submit a replacement payload or target. Exact index/history window, local URL and main frame are required; pet/model/connection windows cannot execute it.
4. Changing project/connection, cancellation, expiry, app restart or repeat approval cannot execute the old review. Cancellation aborts in-flight model/WP reads; after dispatch a cancelled write is conservatively unknown, not rolled back or retried.
5. Updates GET the exact old snapshot again before POST; changes require a new review. This is optimistic conflict detection, **not an atomic server-side compare-and-swap**: standard WP REST provides no application-wide editing lock, so do not edit the same page concurrently from another client.
6. One sequential POST, then GET the **exact returned ID**. Both full raw title/content (including unchanged fields) and status must match the approved expectation. Only this exact read-back produces an app-generated verified-success summary. WordPress sanitization/filtering differences fail verification, not silently pass.
7. Transport failure, invalid write response, read-back failure/mismatch or process exit during execution are **unknown** outcomes. Tokens are consumed, no automatic retry occurs, and further writes for that project are blocked across restarts. Inspect the site and persisted operation record manually before recovery. There is intentionally no automatic unblock/retry button in this slice; a supported recovery UI is still needed.

`wordpress-operations.json` persists only operation ID/project/site/resource/page/status/time summaries, never credentials or raw page content. Pending payloads live in main memory and are invalid after restart. Chat summaries persist through the existing project store (plain JSON, as before). Model credentials and WP application passwords remain separate encrypted records; neither enters model/renderer output or logs. Review content uses `textContent`, not executable HTML.

## Evidence and limitations

`npm test`; `npm run test:ui`; `npm run check`. The isolated Electron scenario uses **injected MOCK transports** but runs the real provider schema, function-response continuation, main IPC, encrypted connector, agent loop, review renderer, approval executor and read-back. It exercises chat → list → read → draft proposal; denial = 0 POST; approval = exactly 1 POST + exact ID GET; sender/project guards; narrow review viewport. Unit tests additionally exercise published edits, conflict, expiry/cancel/resend/restart, token replay, injection, limits and unknown outcomes.

Screenshots: `artifacts/wp-agent-review-MOCK.png`, `wp-agent-review-narrow-MOCK.png`, `wp-agent-verified-MOCK.png`. These prove injected behavior, **not live Gemini or staging-site write permissions**. The existing user app is not restarted by the implementation task; no Windows build is produced. The user can test their explicitly authorized staging site in the app after the parent reloads it.

Official protocol references:
- https://ai.google.dev/gemini-api/docs/generate-content/function-calling?hl=en (REST function declarations/results and thought signatures; Google now labels generateContent legacy, still the connected adapter protocol)
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
- https://platform.kimi.ai/docs/api/chat
- https://www.alibabacloud.com/help/en/model-studio/qwen-function-calling
- https://developer.wordpress.org/rest-api/reference/pages/
- https://developer.wordpress.org/rest-api/reference/posts/
- https://developer.wordpress.org/rest-api/reference/media/
- https://developer.wordpress.org/rest-api/reference/settings/
- https://developer.wordpress.org/rest-api/reference/users/

## Elementor pages (`src/wp-elementor.cjs`)

Real, Elementor-editable pages written through core REST with the Application Password: `meta._elementor_data` (JSON string),
`_elementor_edit_mode: "builder"`, `_elementor_template_type: "wp-page"`. No plugin and no MCP (the spike showed core REST
exposes these meta keys in Elementor 4.3.6; the MCP server exposed no Elementor abilities).

- **Detection:** `wp_read_site_structure` also returns `elementor` (active, version, Pro, global colors/fonts). The agent context
  shows it and says to build with Elementor by default when it is active. Needs Elementor 3.18+ (Flexbox containers).
- **Tools:** `wp_read_elementor_page` (returns the simple structure) and `wp_prepare_elementor_page` (create a draft, or replace an
  existing Elementor page). The model sends containers with widgets (heading, text-editor, image, button, spacer, divider,
  icon-list, video); the app builds the Elementor JSON with deterministic element ids. The model never writes raw Elementor JSON.
- **Validation (Elementor validates nothing):** allowlists for container/widget types and keys; no HTML/code/shortcode/embed
  widgets, no scripts, no `on*` attributes; text-editor HTML goes through the page sanitizer and is limited to simple text tags;
  links are https, root-relative, `tel:` or `mailto:`; images/videos only by `mediaId` of this site's media library; colors are
  `#hex` or `global:<id>` (checked against the site's globals); max 150 elements, depth container > container > widget, 300 KB.
  The built JSON is checked again against setting-key allowlists before writing.
- **RTL:** Hebrew content or a Hebrew/Arabic site language sets right alignment and a right-start flex row on the built elements.
- **Safety:** review card (summary + exact simple structure), one write, exact read-back of the stored `_elementor_data`
  (normalized JSON), activity log. Undo: a created draft goes to the trash; an update restores the previous `_elementor_data`
  byte for byte. Updates are refused when the existing page has elements the app cannot express (legacy sections, other widgets).
- **CSS cache:** Elementor offers no documented remote way to clear it, so the app does not; update and restore results tell the
  user to use Elementor > Tools > Regenerate CSS & Data if the styling looks stale.
- **Build plans:** `wp_prepare_elementor_page` is a plan step; `mediaId` may be a `{{key.id}}` reference to an earlier upload
  (the JSON is rebuilt from the verified id just before the write). An update step needs a real numeric page id. Plan undo
  trashes the created draft / restores the previous data.

### Elementor: kit, globals, video, CSS cache, header/footer, spec flow

- **Design kit (`src/elementor-kit/`):** ten patterns (hero-image, hero-simple, text-image, services-cards, features-list,
  testimonials, cta-band, contact-details, faq, footer-section). A pattern turns simple data into the same simple container
  structure as free-form input, so it passes the normal validator and builder. Global colors/fonts are referenced
  (`global:primary`...); a site that cannot offer globals gets a hex palette. The builder adds mobile settings to every container
  (rows stack, paddings/gaps shrink, cards full width, big titles smaller) and RTL alignment for Hebrew.
- **Globals (`wp_read_elementor_globals`, `wp_prepare_elementor_globals`):** Elementor's own routes
  `/elementor/v1/globals/colors|typography` (undocumented; version and route are checked first). Review card with swatches and font
  names, one write per item, exact read-back, undo restores existing values; new custom globals cannot be deleted remotely.
  Fonts: curated Google Fonts list (all Hebrew-capable ones included) plus Elementor system fonts.
- **Video widget:** `mediaId` (library file) or a YouTube/Vimeo `url` (https, known host, validated id, no other parameters);
  no HTML/embed widgets.
- **CSS cache:** after a VERIFIED update, restore or globals change the app sends `DELETE /elementor/v1/cache` (undocumented,
  administrator only, idempotent). It is announced on the review card, never fails the write, and the manual
  "Regenerate CSS & Data" note stays as the fallback.
- **Header/footer (Theme Builder):** NOT written. `elementor_library` is exposed over REST, but the display conditions
  (`_elementor_conditions`) are not exposed meta and Elementor Pro keeps a conditions cache in an option that REST cannot clear.
  The agent is told (HEADER/FOOTER line) to explain this in Hebrew and keep the theme's own header/footer.
- **Spec flow:** see `src/elementor-instructions.cjs`. Missing facts are written `(להשלים: ...)` and listed in the review and the
  final result.

### Provider switching, rejected key, blocked project

- History is provider-neutral; a provider's own `native` turn is echoed only to the provider that produced it (`nativeKind`), any
  other provider gets the turn rebuilt from the neutral calls (tests: every provider pair).
- A key the provider rejects (401) is remembered; no request is sent with it until a different key is connected.
- A blocked project shows ONE card (change, view, release, technical reason). Reads and questions still work; write preparations
  get a short tool error instead of a long message.
