# Model providers — implemented scope and verification

## Supported connections

All authenticated traffic runs in Electron **main**, not the renderer. The five adapters are implemented, not just provider labels. There are no built-in model IDs, no demo models in production, no automatic fallback, and no arbitrary/custom base-URL field.

| Provider | Discovery (GET) | Inference (POST) | Authentication |
|---|---|---|---|
| OpenAI | `https://api.openai.com/v1/models` | `https://api.openai.com/v1/chat/completions` | `Authorization: Bearer …` |
| Claude / Anthropic | `https://api.anthropic.com/v1/models` | `https://api.anthropic.com/v1/messages` | `x-api-key`, `anthropic-version: 2023-06-01` |
| Gemini / Google AI Studio | `https://generativelanguage.googleapis.com/v1beta/models` | `https://generativelanguage.googleapis.com/v1beta/models/{encodedModelId}:generateContent` | `x-goog-api-key` header, never URL query |
| Kimi / Moonshot international | `https://api.moonshot.ai/v1/models` | `https://api.moonshot.ai/v1/chat/completions` | `Authorization: Bearer …` |
| Qwen / Alibaba Model Studio **Singapore only** | `https://dashscope-intl.aliyuncs.com/api/v1/models` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions` | `Authorization: Bearer …`, Singapore-region key |

Qwen region is an explicit visible preset; currently only `singapore` is supported. Other regions are rejected before network access. The official compatibility documentation describes migration from the legacy regional DashScope host to workspace-specific hosts; this adapter uses the documented fixed regional host, not an arbitrary workspace hostname. China/US/Tokyo/Hong Kong deployments and Coding Plan endpoints are **not** implemented. Moonshot China/Kimi Code, Vertex AI, Bedrock, Azure, OAuth and subscription logins are also not implemented. An API key is not a ChatGPT/Claude/Gemini app subscription.

### Discovery is not a successful connection

- Loading models requires an explicitly supplied key or the separately saved key for exactly that provider/region. Clicking “טעינת מודלים מהספק” makes only authenticated **GET** requests, no generation, project context, or chat history.
- Anthropic follows `after_id`/`has_more`; Gemini follows `pageToken`/`nextPageToken`; Qwen follows `output.page_no`, `page_size`, `total`. Repeated cursors or more than 20 pages fail rather than publish a silently incomplete list.
- Gemini retains models advertising `generateContent`; Qwen retains input/output Text models. OpenAI/Moonshot list entries are candidates because model-list presence alone does not prove chat compatibility. The UI says so. Non-chat entries may appear in OpenAI's list and fail validation; there is no claim to support every returned model.
- Qwen's **native** model-list endpoint returns `output.models`, not OpenAI `data`. No invented `/compatible-mode/v1/models` endpoint is used.
- All five providers now have documented discovery routes, so there is **no curated fallback list**. Failure/empty response stays an error. Production never inserts model IDs from screenshots or tests.
- Model IDs are preserved as returned (Gemini's documented `models/` resource prefix is separated from its ID), checked against the supported identifier grammar and displayed via text/Option APIs, not HTML.

## Connection and selection UX

1. Settings keep WordPress separate. Choose a provider, and the displayed Singapore region for Qwen.
2. Enter a key in the masked field, or leave it empty to use that provider's saved main-only key. Keys are never returned to the UI. Changing provider clears the field and invalidates any staged selection.
3. Load models, search the expandable model dropdown, choose one.
4. Check the explicit billing/data consent and press “חיבור מודל”. Exactly one small generation request sends `Reply with OK.` with a 128-token generation cap (including reasoning where the provider counts it). No project data is sent during validation. The user sees the billing warning before submission.
5. Only a non-empty text response and successful encrypted atomic save replace the active connection. Errors leave the prior selection and keys intact. A key replacement invalidates the old key's set of validated models. No automatic retries or larger-token retries.
6. The main chat composer shows the active model. Its searchable popover lists previously validated models grouped by provider label. Clicking a row stages a choice; **“אישור החלפה · ללא בקשת AI”** is a separate explicit action. Switching a previously validated model makes **no network call** and persists the choice. “חיבור ספק / מודל נוסף…” opens setup for new validation.

Keys and the active model are deliberately **app-wide**, as the old OpenAI connection was. This is stated in settings and the chat picker. Projects keep separate histories, context, rules and WordPress credentials; switching provider never switches/merges projects. The next explicit chat Send transmits the current project's context/history to the selected provider. WordPress credentials and the raw users/me response do not enter model prompts. A sanitized boolean capability map, site metadata and tool-read page/post/media/settings data do enter the selected provider context; content is untrusted data, never instructions.

## Protocol and storage details

- OpenAI sends `store:false`, `max_completion_tokens`, `model`, `messages`.
- Anthropic extracts system messages into top-level `system`, sends user/assistant messages plus `max_tokens`, and reads only text blocks.
- Gemini maps assistant to `model`, text to `parts`, system to `systemInstruction`, sends `generationConfig.maxOutputTokens`, and reads non-thought text parts only.
- Moonshot and Qwen use documented Chat Completions compatibility and `max_tokens`. Kimi's current docs mark `max_tokens` deprecated in favor of `max_completion_tokens`; the compatible parameter remains documented and is used here for compatibility across discovered generations.
- Chat generation is capped at 4096 output tokens per request. Connected WordPress now supplies genuine scoped page/post/media/settings/capability tools through `src/tool-adapters.cjs` and the bounded approval executor: see [WP-EXECUTION.md](WP-EXECUTION.md) for wire-format matrix, limits and verification. Disconnected WordPress preserves text-only chat. No general computer use, remote executor, streaming, vision/audio or built-in web search exists. Hermes/ACP remains disabled.
- Every request has `redirect:"error"`, fixed allowlisted HTTPS origins and a 60-second timeout. Status/error bodies are not echoed; network, JSON and encryption errors are sanitized. Keys are placed only in auth headers, never URLs, payloads or logs.
- `connection.json` version 2 stores independent safeStorage ciphertext records keyed by provider/region, the selected model, and IDs previously validated with that key. Only non-secret metadata crosses IPC. Key input exists transiently in the masked DOM/IPC until submit clears it; JS cannot guarantee physical memory erasure.
- A candidate key is retained only in main for up to 10 minutes, or until cancel/provider change/success/disconnect. A timer clears expired staging. In-flight cancelled discovery cannot resurrect the candidate. Staged keys are not persisted.
- The original `{model, encrypted}` OpenAI file is recognized without rewriting it at startup. Its ciphertext and selected model migrate unchanged in the next successful atomic save. Failed validation does not migrate or destroy it. Corrupt files fail closed and remain untouched for recovery.
- Unavailable OS encryption, including Linux `basic_text`, fails before network or write. Decryption failure reports a reconnect need without deleting encrypted records.
- Disconnect removes only the **active provider/region** record and clears active selection; other saved providers and WordPress connections remain. Select another saved provider to remove it. Removing a local key does not revoke it at the provider and is not forensic deletion of backups.
- Renderer CSP/network restrictions, named authorized IPC, sender/main-frame validation, sandbox and context isolation remain in place. The pet cannot use discovery/selection/connection IPC.

## Limitations / not verified live

No real credentials were supplied or used. **No live authenticated model-list or inference request has been verified for any provider.** Official docs were inspected in a browser after the lightweight extraction/search service returned 403. Tests use labeled injected transport responses; native Electron tests use real safeStorage with public dummy strings.

Provider access, billing, regional entitlement, API changes and model-specific parameter support remain subject to live verification. Small token budgets can produce no final text on reasoning-heavy models; such validation fails explicitly and keeps the old connection. Some response-only/multimodal models returned by discovery cannot be used by this text-chat adapter. Previously validated models may later be removed/revoked; sending then fails without switching providers or retrying. This is not a promise of all-model support.

No Windows build was produced for this change. Existing `dist/` binaries are stale. The user's running Electron app was not restarted; test instances use separate temporary userData directories.

## Official sources inspected

- OpenAI list: https://developers.openai.com/api/reference/resources/models/methods/list
- OpenAI Chat Completions: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- Anthropic list/auth/pagination: https://platform.claude.com/docs/en/api/models/list
- Anthropic Messages: https://platform.claude.com/docs/en/api/messages/create
- Gemini model listing/pagination/capabilities: https://ai.google.dev/api/models
- Gemini GenerateContent: https://ai.google.dev/api/generate-content?hl=en
- Google key-header example: https://ai.google.dev/gemini-api/docs/get-started?hl=en
- Kimi service address/auth: https://platform.kimi.ai/docs/api/overview
- Kimi list: https://platform.kimi.ai/docs/api/list-models
- Kimi Chat Completions: https://platform.kimi.ai/docs/api/chat
- Alibaba OpenAI compatibility, region binding and regional-host migration: https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
- Alibaba actual model discovery, auth, pagination and response schema: https://www.alibabacloud.com/help/en/model-studio/list-models

## Extending safely

Add reviewed fixed endpoints, auth and payload parsing in `src/provider-adapters.cjs`, supply a documented discovery method or **explicitly labeled curated** options if no discovery exists, and add mock contract/error/security tests before enabling a provider. Never expose arbitrary endpoints, reuse another provider's key, accept model IDs as proof of compatibility, or silently fall back after auth failure. Provider metadata is returned from main so the renderer needs no host/auth knowledge.
