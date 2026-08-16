# visbridge-mcp

[![npm version](https://img.shields.io/npm/v/visbridge-mcp)](https://www.npmjs.com/package/visbridge-mcp)
[![license](https://img.shields.io/npm/l/visbridge-mcp)](https://www.npmjs.com/package/visbridge-mcp)

> **Status: stable beta.** The core pipeline (media resolution, SSRF hardening, provider
> adapters, local preprocessing) is covered by automated tests and releases are automated,
> but real-world mileage is still limited. For local / personal use it is production-grade;
> for critical workflows, pin your version and smoke-test with `visbridge-mcp doctor` first.

Token-efficient vision for MCP clients. An [MCP](https://modelcontextprotocol.io) server
(stdio + Streamable HTTP) exposing a single `analyze_image` tool that lets any MCP client **see**
images — describe, OCR, or inspect — through an OpenAI-compatible vision provider.

It exists for one reason: to give a **model without native vision** (or any client that wants to
spend fewer tokens) the ability to understand images. The client sends only an image *reference*
plus a mode; the server resolves the image, sends it to the vision model, and returns compact plain
text.

```
┌──────────────────┐    JSON-RPC (stdio)   ┌──────────────────┐     HTTP (chat)     ┌──────────────────┐
│    MCP client    │ ────────────────────▶ │   visbridge-mcp   │ ──────────────────▶ │  vision provider │
│   (non-vision    │ ◀──────────────────── │   (this server)   │ ◀────────────────── │  (OpenAI-compat, │
│     model)       │    compact text       │                   │   /chat/completions │    e.g. gemini)  │
└──────────────────┘                       └──────────────────┘                     └──────────────────┘
```

## Features

- **Two transports** — stdio for local clients (Claude Code, Cursor), Streamable HTTP (`POST /mcp`)
  for local clients that connect over HTTP. Both run on the user's own machine — this server is
  not designed for remote/public hosting.
- **One tool, three modes** — `describe` (summarize), `ocr` (extract text), `inspect` (answer a
  specific question via `prompt`).
- **`detail: low` by default** — cheaper *and* measurably better OCR than `high`.
- **Fence-free OCR** — every OCR answer is stripped of markdown code fences defensively.
- **Four image sources** — local `path`, `url`, `base64` (data URL or raw), and `resource`
  (resolved against a configured directory).
- **Hardened** — SSRF protection (private/loopback/link-local IPs blocked), DNS resolved before
  fetch, MIME sniffing (PNG/JPEG/WebP/GIF) + size limits, at most one redirect.
- **Local preprocessing** — oversized images are downscaled before the provider call
  (`VISION_MAX_DIMENSION`, default 2048, never upscales; animated GIFs use the first frame).
  Cheaper, faster, and immune to provider-side image limits. A `warnings` entry notes every resize.
- **Structured errors** — 10-code taxonomy, MCP-safe messages (no keys/URLs leak).
- **Observability** — token/cost estimation and one JSON log line per call, written to **stderr**
  (never stdout, which is reserved for the JSON-RPC channel).

## Requirements

- Node.js >= 20
- A vision provider exposing an OpenAI-compatible `POST /chat/completions` endpoint + an API key.

## Setup

```bash
npm install
cp .env.example .env   # then fill in VISION_BASE_URL / VISION_API_KEY / VISION_MODEL
```

The server reads `process.env` directly. If you register it in an MCP client, the client populates
the environment from its own config — a `.env` file is optional.

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VISION_BASE_URL` | ✅ | — | Base URL of the OpenAI-compatible endpoint (http/https). |
| `VISION_API_KEY` | ✅ | — | Bearer token sent to the provider. |
| `VISION_MODEL` | ✅ | — | Vision model id, e.g. `ag/gemini-3.6-flash-medium`. |
| `VISION_PROVIDER` | — | `openai-compatible` | Adapter: `openai-compatible` (chat completions), `mock` (offline deterministic adapter for tests/demos), or `openai` (Responses API — scaffold only). |
| `VISION_TRANSPORT` | — | `stdio` | Transport: `stdio` (default) or `http` (Streamable HTTP). |
| `VISION_HTTP_HOST` | — | `127.0.0.1` | Bind address for the HTTP transport. |
| `VISION_HTTP_PORT` | — | `3000` | Port for the HTTP transport. |
| `VISION_DESCRIBE_OUTPUT_BUDGET` | — | `256` | Max output tokens for `describe`. |
| `VISION_INSPECT_OUTPUT_BUDGET` | — | `384` | Max output tokens for `inspect`. |
| `VISION_OCR_OUTPUT_BUDGET` | — | `1024` | Max output tokens for `ocr`. |
| `VISION_TIMEOUT_MS` | — | `60000` | Provider request timeout (ms). |
| `VISION_MAX_RETRIES` | — | `2` | Retries for transient errors (429 / 5xx / network); honours `retry-after`. `0` disables. |
| `VISION_MAX_IMAGE_BYTES` | — | `20971520` | Max decoded image size (20 MB). |
| `VISION_MAX_DIMENSION` | — | `2048` | Downscale locally so the longest edge fits (never upscales; `0` disables). |
| `VISION_MAX_REDIRECTS` | — | `3` | Max redirects for `url` images; every hop is SSRF-revalidated. |
| `VISION_SSRF_ALLOW_HOSTS` | — | *(none)* | Comma-separated hostnames allowed to reach private networks. |
| `VISION_RESOURCE_DIR` | — | *(none)* | Base dir for resolving `resource` image references. |

## Usage

### Install from npm (npx)

The package is published to npm — anyone can run it without a local checkout:

```jsonc
{
  "mcpServers": {
    "visbridge": {
      "command": "npx",
      "args": ["-y", "visbridge-mcp"],
      "env": {
        "VISION_BASE_URL": "https://...",
        "VISION_API_KEY": "sk-...",
        "VISION_MODEL": "ag/gemini-3.6-flash-medium"
      }
    }
  }
}
```

With `npx` there is no local `.env` or launcher script, so credentials come from the client's
`env` block (above) rather than a `.env` file.

### Register in Claude Code

Published package, stdio (credentials via `-e` flags):

```bash
claude mcp add visbridge \
  -e VISION_BASE_URL=https://... \
  -e VISION_API_KEY=sk-... \
  -e VISION_MODEL=ag/gemini-3.6-flash-medium \
  -- npx -y visbridge-mcp
```

HTTP transport (local clients that connect over HTTP):

```bash
claude mcp add --transport http visbridge http://127.0.0.1:3000/mcp
```

> **Local development** (from a checkout): point at the launcher instead, so the API key stays in
> the repo's `.env` rather than the client config:
> `claude mcp add visbridge -- /path/to/visbridge-mcp/scripts/visbridge.sh`

Verify with `claude mcp list`, then in a session ask the (non-vision) model to use the tool:

```
Use analyze_image to describe fixtures/images/dense-ui.png
Use analyze_image in ocr mode to read all the text in this image
Use analyze_image: what is the background color of the hero section, and how many CTAs are there?
```

### Register in Cursor

Create `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "visbridge": {
      "command": "npx",
      "args": ["-y", "visbridge-mcp"],
      "env": {
        "VISION_BASE_URL": "https://...",
        "VISION_API_KEY": "sk-...",
        "VISION_MODEL": "ag/gemini-3.6-flash-medium"
      }
    }
  }
}
```

For the HTTP transport, replace `command`/`args`/`env` with
`"url": "http://127.0.0.1:3000/mcp"`.

### Register in Kilo Code

Kilo Code stores MCP servers in `~/.config/kilo/kilo.jsonc` (JSONC), under a top-level `mcp` key.
Its schema is **not** the standard `mcpServers` shape — `command` is the full argument array (no
separate `args`) and `enabled` is required:

```jsonc
{
  "mcp": {
    "visbridge": {
      "type": "local",
      "command": ["npx", "-y", "visbridge-mcp"],
      "environment": {
        "VISION_BASE_URL": "https://...",
        "VISION_API_KEY": "sk-...",
        "VISION_MODEL": "ag/gemini-3.6-flash-medium"
      },
      "enabled": true
    }
  }
}
```

For the HTTP transport, replace `type`/`command`/`environment` with `"type": "http"` and
`"url": "http://127.0.0.1:3000/mcp"` — pointing at a server running on the same machine.

### Other clients (Windsurf, VS Code, Cline, …)

They accept the standard `mcpServers` shape from the Cursor example above. Two notes:

- **HTTP transport** — replace `command`/`args`/`env` with `"url": "http://127.0.0.1:3000/mcp"`
  (a server running on the same machine).
- **Windows** — wrap the stdio command: `"command": "cmd", "args": ["/c", "npx", "-y",
  "visbridge-mcp"]`.

The three `VISION_*` variables are the only required config; everything else has safe defaults.

### Invoke the tool directly

`analyze_image` accepts:

```jsonc
{
  "image": { "kind": "path", "value": "fixtures/images/dense-ui.png" }, // path | url | base64 | resource
  "mode": "auto",          // auto | describe | ocr | inspect
  "prompt": "…",           // optional; for inspect mode
  "context": "…",          // optional; the user's original request so the vision model understands intent
  "detail": "auto"         // auto | low | high
}
```

Mode resolution: `auto` → `describe` when `prompt` is empty, otherwise `inspect`. Detail resolution:
`auto` → `low`.  

**`context`** — when set, the user's original question or intent is injected into the vision model's
prompt alongside the mode-specific instruction. This lets the vision model focus on what the user
actually asked about (e.g. *"analyze the layout"*, *"find the error code"*) even when the driving
model only describes the mode generically. Always pass the full user request as `context` when the
driving model's own instructions risk stripping the intent.

The result is a structured object plus a human-readable text block:

```jsonc
{
  "answer": "…",          // always present
  "text": "…",            // for ocr (plain text, fence-free)
  "warnings": ["…"],      // optional
  "truncated": false      // true if the provider hit the output budget
}
```

### Run over HTTP (Streamable HTTP)

Some local clients and web UIs prefer to connect over HTTP instead of stdio. Run the server over
Streamable HTTP on the same machine:

```bash
VISION_TRANSPORT=http VISION_HTTP_PORT=3000 node --import tsx src/index.ts
```

The server listens on `VISION_HTTP_HOST:VISION_HTTP_PORT` (default `127.0.0.1:3000`):

- `POST /mcp` — the MCP endpoint (stateless, JSON responses).
- `GET /health` — liveness probe.

Register it in a client that supports HTTP MCP servers:

```bash
claude mcp add --transport http visbridge http://127.0.0.1:3000/mcp
```

> **Local-only by design.** This server is meant to run on the user's own machine and has no
> built-in authentication. Do not bind `VISION_HTTP_HOST=0.0.0.0` or expose the port beyond
> localhost — the HTTP transport carries the provider's `VISION_API_KEY`, accepts arbitrary
> local `path` image references, and would let anyone who can reach the port use your provider
> account. If you ever need remote access, front it with an authenticated TLS gateway.

## Discoverability — making non-vision models use it reliably

The tool's `description` is written to signal when to use it, and most models will reach for
`analyze_image` on their own. But non-vision models have a trained-in reflex to refuse image
requests ("I can't see images"), and some paste attachments arrive as `clipboard-*.png`
filenames that invite wrong guesses. To make the behavior deterministic, add the ready-made
global rules from **[`docs/agents-image-rules.md`](docs/agents-image-rules.md)** to your
client's instructions:

- **Claude Code, global** → `~/.claude/CLAUDE.md`
- **Claude Code, per-project** → `CLAUDE.md`
- **Claude Code, per-agent** → `.claude/agents/<name>.md`
- **Cursor** → a rule under `.cursor/rules/`
- **opencode** → `~/.config/opencode/AGENTS.md` (global) or `AGENTS.md` in the project

The rules cover: calling the tool in the same turn (no refusals, no hedged openers), mapping
pasted data URLs to `kind: "base64"` instead of inventing paths, mode selection, and error
reporting. They were validated against GLM 5.3 and DeepSeek V4 (text-only) driving opencode.

## CLI

```
visbridge-mcp              start the stdio MCP server   (default)
visbridge-mcp init         print a ready-to-paste client config
visbridge-mcp config       print effective (redacted) configuration
visbridge-mcp doctor [img] run a live describe + ocr against an image
```

Run without building (dev):

```bash
npx tsx src/index.ts doctor        # live smoke test with your real credentials
npm run demo                       # MCP-client demo: listTools + describe + ocr
```

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # 93 unit + integration tests (mock provider + local HTTP fakes; no network)
npm run build       # compile to dist/  (bin: visbridge-mcp)
npm run dev         # start the stdio server via tsx
```

Try the full pipeline with no credentials at all:

```bash
VISION_PROVIDER=mock npx tsx src/index.ts doctor   # offline smoke test of the pipeline
```

## Security

- **SSRF**: URL images resolve DNS first, validate every address, block private, loopback,
  link-local, and unspecified ranges (IPv4 + IPv6), and pin the connection to the validated
  addresses (defeats DNS rebinding). Redirects are bounded (`VISION_MAX_REDIRECTS`) and each hop
  is re-validated. Downloads are streamed with a hard byte cap — a lying `content-length` cannot
  buffer an unbounded response. Override per-host via `VISION_SSRF_ALLOW_HOSTS`.
- **No secret leakage**: API keys are masked in `config` output and never appear in logs or error
  messages. The launcher script keeps the key out of client config files.
- **Stdout is the protocol channel** — all logging goes to stderr.

## Publishing to npm

Releases are automated with [npm trusted publishing](https://docs.npmjs.com/generating-provenance-statements)
(GitHub Actions OIDC — no npm token). To cut a release:

```bash
npm version patch          # or minor / major — bumps version, commits, and tags
git push --follow-tags
```

Pushing the `v*` tag triggers `.github/workflows/publish.yml`, which runs the tests, builds, and
publishes to npm. The tarball ships only `package.json`, `README.md`, `LICENSE`, and `dist/` — no
`src/`, fixtures, or `.env`.

## Roadmap

- `resource` wired to a live MCP resource list.
- `openai.ts` Responses-API adapter (native OpenAI path, replacing `openai-compatible` where desired).
- Richer `doctor` output (surfaced per-call cost).

This project is **local-only** — there are no plans for remote/multi-tenant hosting, so HTTP
authorization is explicitly out of scope.
