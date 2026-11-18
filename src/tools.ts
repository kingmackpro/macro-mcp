import { z } from "zod";

export type DeviceAction =
  | "ping" | "get_battery" | "get_device_info"
  | "set_volume" | "set_brightness" | "launch_app" | "termux_script";

export interface ToolSpec {
  name: string;
  description: string;
  action: DeviceAction;
  schema: z.ZodObject<any>;
  validate: (value: unknown) => Record<string, unknown>;
}

const empty = z.object({}).strict();
const volume = z.object({
  stream: z.enum(["media", "ring", "alarm", "notification"]).default("media"),
  level: z.number().int().min(0).max(100)
}).strict();
const brightness = z.object({ level: z.number().int().min(1).max(255) }).strict();
const app = z.object({
  package_name: z.string().min(3).max(160).regex(/^[A-Za-z][A-Za-z0-9_.]+$/)
}).strict();
const script = z.object({
  name: z.enum(["device_info", "storage_summary", "termux_version"])
}).strict();

function validator(schema: z.ZodObject<any>): ToolSpec["validate"] {
  return (value) => schema.parse(value) as Record<string, unknown>;
}

export const TOOLS: ToolSpec[] = [
  { name: "ping_phone", description: "Check whether the Android phone is reachable through MacroDroid.", action: "ping", schema: empty, validate: validator(empty) },
  { name: "get_battery", description: "Get Android battery percentage and charging state.", action: "get_battery", schema: empty, validate: validator(empty) },
  { name: "get_device_info", description: "Get basic Android device information.", action: "get_device_info", schema: empty, validate: validator(empty) },
  { name: "set_volume", description: "Set an Android audio stream volume from 0 to 100 percent.", action: "set_volume", schema: volume, validate: validator(volume) },
  { name: "set_brightness", description: "Set Android screen brightness from 1 to 255.", action: "set_brightness", schema: brightness, validate: validator(brightness) },
  { name: "launch_app", description: "Launch an Android application using its package name.", action: "launch_app", schema: app, validate: validator(app) },
  { name: "run_termux_script", description: "Run one pre-approved Termux:Tasker script by name. Raw shell commands are not accepted.", action: "termux_script", schema: script, validate: validator(script) }
];
