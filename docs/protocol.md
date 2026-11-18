# Device protocol

The Worker sends this JSON body to the HTTPS MacroDroid webhook. It also sends the `x-device-token` request header.

```json
{
  "request_id": "UUID",
  "action": "get_battery",
  "parameters": {}
}
```

Supported action names:

- `ping`
- `get_battery`
- `get_device_info`
- `set_volume`
- `set_brightness`
- `launch_app`
- `termux_script`

MacroDroid must route only recognized action names. Never pass arbitrary MCP text into a shell action.

## Callback

After the action finishes, MacroDroid sends an HTTPS POST to `/device/result` with:

- Header: `Authorization: Bearer <DEVICE_TOKEN>`
- Header: `Content-Type: application/json`

Success example:

```json
{
  "request_id": "same UUID",
  "success": true,
  "data": { "battery_percent": 87, "charging": false }
}
```

Failure example:

```json
{
  "request_id": "same UUID",
  "success": false,
  "error": "Action could not be completed"
}
```

Echo the request ID unchanged. Unknown or expired IDs are rejected. The Worker retains pending requests and results for five minutes.
