# MacroDroid setup

Create a macro named **Macro MCP - Command Router** with a Webhook trigger. Parse the incoming JSON and save the following values to MacroDroid variables:

- `mm_request_id`
- `mm_action`
- `mm_parameters`

Create IF / ELSE IF branches for each supported action. Begin with the `ping` branch.

For a Termux:Tasker action, accept only the fixed script names `device_info`, `storage_summary`, and `termux_version`. Do not interpolate arbitrary MCP text into a shell command.

After executing a branch, use an HTTP Request action:

- Method: POST
- URL: `https://<worker-host>/device/result`
- Header: `Authorization: Bearer <DEVICE_TOKEN>`
- Header: `Content-Type: application/json`
- Body: include the original `mm_request_id`, a boolean `success`, and either `data` or `error`.

Use MacroDroid's own variable substitution syntax in the request body. Keep the webhook URL and token out of the repository.

Verify `ping_phone` first, then add native Android actions one by one.
