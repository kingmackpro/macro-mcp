# macro-mcp

A Cloudflare-hosted, stateless MCP server that exposes a small, allowlisted set of Android actions through MacroDroid and optional Termux:Tasker scripts.

## Architecture

`MCP client → Cloudflare Worker (/mcp) → Durable Object broker → MacroDroid webhook → Android action → HTTPS callback → Durable Object → MCP result`

The phone does not host a server. Cloudflare hosts the MCP endpoint and correlates asynchronous device responses.

## Features

- MCP Streamable HTTP endpoint with current stateless protocol support and backwards-compatible legacy initialization
- Authenticated MCP requests and device callbacks
- Durable Object request correlation with five-minute expiry and automatic cleanup
- Bounded wait for phone responses, with a `request_id` for later polling
- Strict argument validation and an allowlist of Termux script names
- No arbitrary shell execution

## Development

Requires Node.js 22+.

```bash
npm install
npm test
npm run build
npm run dev
```

## Cloudflare configuration

The Worker is configured in `wrangler.jsonc` with a SQLite-backed Durable Object binding named `BROKER`. The first migration creates `DeviceBroker`.

Set these Worker secrets before using phone tools:

```bash
npx wrangler secret put MCP_TOKEN
npx wrangler secret put DEVICE_TOKEN
npx wrangler secret put MACRO_WEBHOOK_URL
```

- `MCP_TOKEN`: bearer token used by MCP clients.
- `DEVICE_TOKEN`: shared secret sent to MacroDroid as `x-device-token` and required as a Bearer token on the callback endpoint.
- `MACRO_WEBHOOK_URL`: the final HTTPS MacroDroid webhook URL.

The health endpoint is public: `GET /health`. The MCP endpoint is `POST /mcp`, authenticated with `Authorization: Bearer <MCP_TOKEN>`. Device callbacks use `POST /device/result` with `Authorization: Bearer <DEVICE_TOKEN>`.

## MCP clients

Use the endpoint:

```
https://macro-mcp.oprangerx.workers.dev/mcp
```

The endpoint supports the current `2026-07-28` stateless request format and legacy initialization for clients using `2025-11-25`, `2025-06-18`, or `2025-03-26`.

## MacroDroid setup

Follow [docs/macrodroid-setup.md](docs/macrodroid-setup.md). The macro must route only known action names and send the same `request_id` back to `/device/result`. Keep the webhook URL and secrets out of source control.

## Device tools

- `ping_phone`
- `get_battery`
- `get_device_info`
- `set_volume`
- `set_brightness`
- `launch_app`
- `run_termux_script` — only `device_info`, `storage_summary`, or `termux_version`
- `get_command_result`

A tool call waits up to eight seconds for the phone. If the callback has not arrived, it returns a pending `request_id`; use `get_command_result` to poll it later.

## Security notes

- Store all three configuration values as Cloudflare Worker secrets.
- Do not send arbitrary shell commands from MCP to Termux.
- Use HTTPS for the MacroDroid webhook.
- The Worker does not expose the webhook URL or token through its health endpoint.
- The MCP endpoint rejects cross-origin requests with an `Origin` header that does not match the Worker origin.
