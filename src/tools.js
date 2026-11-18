export const TOOLS = [
  {
    name: "ping_phone",
    description: "Check whether the Android phone is reachable through MacroDroid.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "get_battery",
    description: "Get Android battery percentage and charging state.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "get_device_info",
    description: "Get basic Android device information.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "set_volume",
    description: "Set an Android audio stream volume from 0 to 100 percent.",
    inputSchema: {
      type: "object",
      properties: {
        stream: { type: "string", enum: ["media", "ring", "alarm", "notification"], default: "media" },
        level: { type: "integer", minimum: 0, maximum: 100 }
      },
      required: ["level"],
      additionalProperties: false
    }
  },
  {
    name: "set_brightness",
    description: "Set Android screen brightness from 1 to 255.",
    inputSchema: {
      type: "object",
      properties: { level: { type: "integer", minimum: 1, maximum: 255 } },
      required: ["level"],
      additionalProperties: false
    }
  },
  {
    name: "launch_app",
    description: "Launch an Android application using its package name.",
    inputSchema: {
      type: "object",
      properties: {
        package_name: { type: "string", minLength: 3, maxLength: 160, pattern: "^[A-Za-z][A-Za-z0-9_.]+$" }
      },
      required: ["package_name"],
      additionalProperties: false
    }
  },
  {
    name: "run_termux_script",
    description: "Run one pre-approved Termux:Tasker script by name. Raw shell commands are not accepted.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", enum: ["device_info", "storage_summary", "termux_version"] } },
      required: ["name"],
      additionalProperties: false
    }
  },
  {
    name: "get_command_result",
    description: "Retrieve the result of a previously dispatched phone command.",
    inputSchema: {
      type: "object",
      properties: { request_id: { type: "string", minLength: 10, maxLength: 80 } },
      required: ["request_id"],
      additionalProperties: false
    }
  }
];

const ACTIONS = new Map([
  ["ping_phone", "ping"],
  ["get_battery", "get_battery"],
  ["get_device_info", "get_device_info"],
  ["set_volume", "set_volume"],
  ["set_brightness", "set_brightness"],
  ["launch_app", "launch_app"],
  ["run_termux_script", "termux_script"]
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`Unexpected argument: ${key}`);
  }
}

export function validateToolArguments(name, value) {
  const args = value === undefined ? {} : value;
  if (!isObject(args)) throw new Error("Arguments must be a JSON object.");

  if (name === "ping_phone" || name === "get_battery" || name === "get_device_info") {
    onlyKeys(args, []);
    return {};
  }

  if (name === "set_volume") {
    onlyKeys(args, ["stream", "level"]);
    const stream = args.stream === undefined ? "media" : args.stream;
    if (!["media", "ring", "alarm", "notification"].includes(stream)) {
      throw new Error("stream must be media, ring, alarm, or notification.");
    }
    if (!Number.isInteger(args.level) || args.level < 0 || args.level > 100) {
      throw new Error("level must be an integer from 0 to 100.");
    }
    return { stream, level: args.level };
  }

  if (name === "set_brightness") {
    onlyKeys(args, ["level"]);
    if (!Number.isInteger(args.level) || args.level < 1 || args.level > 255) {
      throw new Error("level must be an integer from 1 to 255.");
    }
    return { level: args.level };
  }

  if (name === "launch_app") {
    onlyKeys(args, ["package_name"]);
    if (typeof args.package_name !== "string" || args.package_name.length < 3 ||
        args.package_name.length > 160 || !/^[A-Za-z][A-Za-z0-9_.]+$/.test(args.package_name)) {
      throw new Error("package_name must be a valid Android package name.");
    }
    return { package_name: args.package_name };
  }

  if (name === "run_termux_script") {
    onlyKeys(args, ["name"]);
    if (!["device_info", "storage_summary", "termux_version"].includes(args.name)) {
      throw new Error("Only device_info, storage_summary, and termux_version are allowed.");
    }
    return { name: args.name };
  }

  if (name === "get_command_result") {
    onlyKeys(args, ["request_id"]);
    if (typeof args.request_id !== "string" || args.request_id.length < 10 || args.request_id.length > 80) {
      throw new Error("request_id must be a string between 10 and 80 characters.");
    }
    return { request_id: args.request_id };
  }

  throw new Error(`Unknown tool: ${name}`);
}

export function actionForTool(name) {
  return ACTIONS.get(name);
}
