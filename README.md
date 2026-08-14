# visbridge-mcp

[![npm version](https://img.shields.io/npm/v/visbridge-mcp)](https://www.npmjs.com/package/visbridge-mcp)
[![license](https://img.shields.io/npm/l/visbridge-mcp)](https://www.npmjs.com/package/visbridge-mcp)

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
  for remote / shared / team deployments.
- **One tool, three modes** — `describe` (summarize), `ocr` (extract text), `inspect` (answer a
  specific question via `prompt`).
- **`detail: low` by default** — cheaper *and* measurably better OCR than `high`.
- **Fence-free OCR** — every OCR answer is stripped of markdown code fences defensively.
- **Four image sources** — local `path`, `url`, `base64` (data URL or raw), and `resource`
  (resolved against a configured directory).
- **Hardened** — SSRF protection (private/loopback/link-local IPs blocked), DNS resolved before
  fetch, MIME sniffing (PNG/JPEG/WebP/GIF) + size limits, at most one redirect.
- **Structured errors** — 11-code taxonomy, MCP-safe messages (no keys/URLs leak).
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
| `VISION_PROVIDER` | — | `openai-compatible` | Adapter: `openai-compatible` (chat completions) or `openai` (Responses API — scaffold only). |
| `VISION_TRANSPORT` | — | `stdio` | Transport: `stdio` (default) or `http` (Streamable HTTP). |
| `VISION_HTTP_HOST` | — | `127.0.0.1` | Bind address for the HTTP transport. |
| `VISION_HTTP_PORT` | — | `3000` | Port for the HTTP transport. |
| `VISION_DESCRIBE_OUTPUT_BUDGET` | — | `256` | Max output tokens for `describe`. |
| `VISION_INSPECT_OUTPUT_BUDGET` | — | `384` | Max output tokens for `inspect`. |
| `VISION_OCR_OUTPUT_BUDGET` | — | `1024` | Max output tokens for `ocr`. |
| `VISION_TIMEOUT_MS` | — | `60000` | Provider request timeout (ms). |
| `VISION_MAX_RETRIES` | — | `2` | Retries for transient errors (429 / 5xx / network); honours `retry-after`. `0` disables. |
| `VISION_MAX_IMAGE_BYTES` | — | `20971520` | Max decoded image size (20 MB). |
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

HTTP transport (remote / shared):

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

For the HTTP transport, replace `type`/`command`/`environment` with the remote `type` and
`"url": "http://127.0.0.1:3000/mcp"`.

### Other clients (Windsurf, VS Code, Cline, …)

They accept the standard `mcpServers` shape from the Cursor example above. Two notes:

- **HTTP transport** — replace `command`/`args`/`env` with `"url": "https://your-host/mcp"` (plus
  `"headers"` for a bearer token once auth is enabled).
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

For remote / shared / team deployments, run the server over Streamable HTTP instead of stdio:

```bash
VISION_TRANSPORT=http VISION_HTTP_PORT=3000 node --import tsx src/index.ts
```

The server listens on `VISION_HTTP_HOST:VISION_HTTP_PORT` (default `127.0.0.1:3000`):

- `POST /mcp` — the MCP endpoint (stateless, JSON responses).
- `GET /health` — liveness probe.

Register it in a client that supports remote MCP servers:

```bash
claude mcp add --transport http visbridge http://127.0.0.1:3000/mcp
```

> Bind `VISION_HTTP_HOST=0.0.0.0` only behind a TLS-terminating gateway — the HTTP transport carries
> the provider's `VISION_API_KEY` and has no built-in authentication.

## Discoverability — helping non-vision models find the tool

The tool's `description` is the only "advertisement" a model sees in its context, so it is written
to signal when to use it: *"Analyze an image you cannot view directly…"*. A capable model will
usually reach for `analyze_image` on its own when it can't see an image.

Weak or small models may instead **announce** that they will use the tool ("I'll use visbridge to
look at it") without actually calling it. To make the behavior deterministic, add a reminder to the
driving agent's instructions:

- **Claude Code, global** → `~/.claude/CLAUDE.md`
- **Claude Code, per-project** → `CLAUDE.md`
- **Claude Code, per-agent** → `.claude/agents/<name>.md`
- **Cursor** → a rule under `.cursor/rules/`

```markdown
## Image handling
When asked to look at, read, describe, or extract text from an image and you have no
native vision, do not say you cannot see it and do not merely say you will use the
`visbridge` tool — call `analyze_image` in the same turn and answer from its result.
Pass the image by `kind` (`path` / `url` / `base64` / `resource`) and choose `mode`:
`describe`, `ocr`, or `inspect` (with `prompt`). If the image was pasted with no
path or URL, ask for a path or URL to pass to the tool.
```

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
npm test            # 39 unit + integration tests (integration spawns the server, no network)
npm run build       # compile to dist/  (bin: visbridge-mcp)
npm run dev         # start the stdio server via tsx
```

## Security

- **SSRF**: URL images resolve DNS first and reject private, loopback, link-local, and unspecified
  addresses (IPv4 + IPv6), with a one-hop redirect re-validation. Override per-host via
  `VISION_SSRF_ALLOW_HOSTS`.
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
- HTTP authorization (MCP-standard auth / OAuth) for protected multi-tenant deployments.
