# Device protocol

Cloudflare posts a JSON command to the MacroDroid webhook URL held in the Worker secret `MACRO_WEBHOOK_URL`.

```json
{
  "request_id": "UUID",
  "action": "get_battery",
  "parameters": {}
}
```

MacroDroid routes only recognized action names through IF / ELSE branches. It must not run arbitrary shell text from MCP arguments.

## Callback

MacroDroid sends an HTTPS POST to `/device/result` with header `Authorization: Bearer <DEVICE_TOKEN>`.

```json
{
  "request_id": "same UUID",
  "success": true,
  "data": { "battery_percent": 87, "charging": false }
}
```

On failure, send `success: false` and an `error` string. Echo the request ID unchanged. Unknown or expired IDs are rejected.
