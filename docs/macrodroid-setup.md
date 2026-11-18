# MacroDroid setup

Create a macro named **Macro MCP - Command Router** with a Webhook trigger.

## 1. Webhook trigger

Use the final HTTPS webhook URL provided by MacroDroid. Save that exact URL as the Cloudflare Worker secret `MACRO_WEBHOOK_URL`.

The Worker sends a POST request containing JSON with:

- `request_id` — correlation ID that must be returned unchanged.
- `action` — one of the allowlisted action names.
- `parameters` — validated arguments for that action.

The Worker also sends an `x-device-token` header. Configure MacroDroid to check this header when your installed MacroDroid version exposes incoming webhook headers. Treat the webhook URL as a secret even when the header check is unavailable.

## 2. Route actions

Parse the incoming JSON and save `request_id`, `action`, and `parameters` to MacroDroid variables. Create IF / ELSE IF branches for these action values:

- `ping`
- `get_battery`
- `get_device_info`
- `set_volume`
- `set_brightness`
- `launch_app`
- `termux_script`

For `termux_script`, accept only the fixed names `device_info`, `storage_summary`, and `termux_version`. Do not interpolate arbitrary MCP text into a shell command.

The `ping` branch can simply return a successful response such as `{"alive":true}`. Add the other native Android actions one at a time, checking that each branch maps the expected parameters.

## 3. Callback

After each branch completes, use an HTTP Request action:

- Method: POST
- URL: `https://macro-mcp.oprangerx.workers.dev/device/result`
- Header: `Authorization: Bearer <DEVICE_TOKEN>`
- Header: `Content-Type: application/json`
- Body: include the original request ID, a boolean `success`, and either `data` or `error`.

Example body:

```json
{
  "request_id": "<original request ID variable>",
  "success": true,
  "data": { "alive": true }
}
```

Use MacroDroid's variable substitution syntax in the request body. Keep the DEVICE_TOKEN in a MacroDroid variable or secure storage; do not hard-code it into a public URL or repository.

## 4. Verify

1. Confirm `GET https://macro-mcp.oprangerx.workers.dev/health` returns `ok: true`.
2. Configure the three Worker secrets: `MCP_TOKEN`, `DEVICE_TOKEN`, and `MACRO_WEBHOOK_URL`.
3. Confirm the callback can POST to `/device/result`.
4. Connect an MCP client to `https://macro-mcp.oprangerx.workers.dev/mcp` using `MCP_TOKEN`.
5. Call `ping_phone` before enabling the other actions.

A valid Worker deployment alone does not configure the Android macro. Phone actions remain unavailable until the webhook URL and MacroDroid branches are configured.
