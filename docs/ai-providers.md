# AI providers (bring your own)

WorkOps ships with no AI vendor lock-in: operators choose the provider, supply their own credentials, and assign which model serves each AI role. All provider endpoints are **server-operator-owned configuration** — the application never accepts provider URLs or keys from chat input, and no AI feature is required for core functionality.

## Supported providers

| Provider | Protocol | Endpoint | Notes |
|----------|----------|----------|-------|
| `zai` | Chat Completions (GLM) | Official Z.AI hosts only (see below) | Default deployment target; GLM-4.5/5.x model catalog |
| `nuha` | OpenAI-compatible | `https://nuhagf.llmtests.org/v1` (fixed) | Native Arabic/English; `Nuha-2.1` |
| `openai` | Chat Completions | `https://api.openai.com/v1` | Any model id the operator assigns |
| `anthropic` | Anthropic Messages (native) | `https://api.anthropic.com/v1` | Streamed via the official SDK adapter; any model id |
| `openai-compatible` | Chat Completions | Operator-set `AI_BASE_URL` | Self-hosted or private gateways; HTTPS required |

## Credential resolution

At request time the runtime resolves credentials for the selected provider in this order:

1. **Stored credentials** — admin-managed, encrypted at rest (AES-256-GCM) with `SABAH_CREDENTIAL_KEY`, decrypted only in memory for the duration of a request. Manage them in **Admin → AI providers** (enable/disable, per-provider connection test).
2. **Environment variables** — `AI_API_KEY` (when `AI_PROVIDER` names the provider), or the per-provider key: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GLM_API_KEY`, `NUHA_API_KEY`, `OPENAI_COMPATIBLE_API_KEY`.

Credentials are never logged, never persisted with conversations, and never sent anywhere except the configured provider endpoint.

## Model routing

Which model serves a role is resolved in this order:

1. **Saved assignment** — `AiModelAssignment` rows managed in **Admin → AI models** for the `CHAT` and `COMPRESSION` roles. `CHAT` accepts the Z.AI/Nuha catalog plus any valid model id on `openai`, `anthropic`, or `openai-compatible` (operator-defined models are supported). `COMPRESSION` accepts a reduced catalog suitable for bounded summaries.
2. **Deployment default** — `AI_PROVIDER` + `AI_MODEL` environment variables.
3. **Safe default** — Z.AI `glm-5.3-flash`.

An invalid persisted assignment fails visibly with a sanitized error; it is never silently rerouted to a different vendor.

## Fallbacks

Fallback configuration is tri-state per assignment:

- **Unset** — legacy automatic order: Z.AI primary → lower-cost GLM on Z.AI's insufficient-balance response (`1113`) → Nuha when a Nuha credential is configured.
- **Empty list (`[]`)** — no fallback attempts.
- **Explicit list** — up to 4 validated targets tried in order. Generic providers (`openai`, `anthropic`, `openai-compatible`) default to **no cross-vendor fallback**: if the selected provider rejects a request, it surfaces instead of silently billing another vendor.

Uncredentialed fallback targets are skipped; a request fails only when no target holds a credential.

## Availability

Chat, field draft, and other AI surfaces run an availability preflight before doing work. The preflight is **assignment-aware**: a saved `CHAT` assignment (or one of its configured fallbacks) with a resolvable stored or environment credential is serviceable even when the deployment default provider is unconfigured. When nothing is configured, requests fail fast with `503 AI is not configured`.

## Endpoint safety

- Provider endpoints are **server configuration only**; requests never carry operator-supplied URLs from chat or page context.
- Custom base URLs must be HTTPS, without embedded credentials, query strings, or fragments. Plain HTTP is reserved for local evaluation and requires explicit operator opt-in (`AI_ALLOW_HTTP=1`).
- `GLM_BASE_URL`, when set, must be one of the four official Z.AI standard/Coding Plan hosts; `NUHA_BASE_URL` is pinned to the approved Nuha endpoint.
- Admin connection tests run admin-only, are bounded (10 s), disable fallbacks so a test cannot pass through another provider, and return metadata plus sanitized errors — never provider response bodies.

## Observability and failure behavior

Provider attempts emit sanitized diagnostics (`PROVIDER_REQUEST`, `PROVIDER_RESPONSE`, `PROVIDER_ERROR`, `PROVIDER_FALLBACK`) with provider, model, attempt count, duration, status, and bounded error codes. Message content, prompts, credentials, headers, and raw provider bodies are never recorded. Retry-before-output is bounded with backoff; a stream that has already emitted output is never restarted — failures after output are surfaced as sanitized stream errors.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `AI_PROVIDER` | Deployment default provider (`zai`, `nuha`, `openai`, `anthropic`, `openai-compatible`) |
| `AI_MODEL` | Deployment default model id (required with `AI_PROVIDER`) |
| `AI_API_KEY` | Credential for the provider named by `AI_PROVIDER` |
| `AI_BASE_URL` | Base URL for `openai-compatible` (HTTPS; required for that provider) |
| `AI_ALLOW_HTTP` | `1` opts in to plain-HTTP custom endpoints (local evaluation only) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_COMPATIBLE_API_KEY` | Per-provider environment credentials |
| `GLM_API_KEY` | Z.AI credential (legacy default provider) |
| `NUHA_API_KEY` | Nuha credential |
| `GLM_BASE_URL` | Optional official Z.AI host override |
| `NUHA_BASE_URL` | Optional (must equal the approved Nuha endpoint) |
| `SABAH_CREDENTIAL_KEY` | Base64 32-byte key encrypting admin-stored provider credentials; preserve existing key material |

## Testing and certification status

The provider transports are covered by unit tests and by wire-level tests against a local loopback mock server (request shape, SSE streaming, chunked UTF-8, HTTP opt-in gating) using synthetic credentials — no external vendor traffic. That is protocol coverage, not live-provider certification: availability, rate limits, tool-calling, and image support of any specific vendor model are the operator's responsibility to verify with their own keys. In particular, tool-calling and image input are not guaranteed for arbitrary custom model ids.
