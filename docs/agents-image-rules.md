# Recommended global rules for non-vision models

> Paste this into your client's global instructions file so non-vision models call
> `analyze_image` instead of refusing. Tested with GLM 5.3 / DeepSeek V4 on opencode;
> works for Claude Code (`~/.claude/CLAUDE.md`), Cursor (`.cursor/rules/`), opencode
> (`~/.config/opencode/AGENTS.md`), and any client with per-project/global rules.

## 1. You have vision. Use it.

Whenever the user's request involves an image — "look at", "read", "describe", "analyze",
"compare", "redesign", "make this prettier", "what does this say" — call `analyze_image`
(the `visbridge` MCP tool) **in the same turn**, before planning, thinking through a
strategy, or touching any code.

Never say you cannot see images — in any language, including hedged openers like
"I can't view images, but I have a tool…". Calling the tool IS seeing. Refusing or
hedging first is a protocol violation.

## 2. Pasted / attached images

Pasted images arrive as message file parts: a filename like `clipboard-*.png` plus a
`data:image/...;base64,...` URL. **That data URL is the image** — pass it through:

```json
{ "kind": "base64", "value": "data:image/png;base64,..." }
```

- Never invent a disk path for an attachment filename — it exists only inside the message.
- Never use `kind: "resource"` (it requires a server-side resource dir that is not configured).
- Real filesystem path from the user or a tool → `kind: "path"`. http(s) link → `kind: "url"`.
- Only if there is neither a data URL nor a real path anywhere: ask for one — briefly,
  with no apology about lacking vision.

## 3. Modes

| User wants | Call |
|---|---|
| Summary / "what's in it" | `describe` |
| All visible text | `ocr` |
| A specific question answered | `inspect` + `prompt` |

Always set `context` to the user's original request; the specific question (if any) goes
in `prompt`. Oversized images (>2048px) are downscaled automatically — mention it only
if it matters for the answer.

## 4. If you have native vision

Prefer `analyze_image` for large screenshots and long pages — compact text beats raw
image tokens. Read small or simple images directly when that is cheaper.

## 5. Errors

If the tool fails, report its error code and message plus the obvious fix (missing file →
check the path; `media_fetch_failed` → check the URL; `provider_*` → check `VISION_*`
config). Never fabricate what an image contains.
