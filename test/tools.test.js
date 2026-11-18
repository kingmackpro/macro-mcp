import test from "node:test";
import assert from "node:assert/strict";
import { validateToolArguments } from "../src/tools.js";

test("volume defaults to media and accepts bounds", () => {
  assert.deepEqual(validateToolArguments("set_volume", { level: 0 }), { stream: "media", level: 0 });
  assert.deepEqual(validateToolArguments("set_volume", { stream: "alarm", level: 100 }), { stream: "alarm", level: 100 });
});

test("volume rejects invalid levels and extra properties", () => {
  assert.throws(() => validateToolArguments("set_volume", { level: 101 }));
  assert.throws(() => validateToolArguments("set_volume", { level: 10, shell: "echo hi" }));
});

test("brightness bounds are enforced", () => {
  assert.deepEqual(validateToolArguments("set_brightness", { level: 255 }), { level: 255 });
  assert.throws(() => validateToolArguments("set_brightness", { level: 0 }));
});

test("Termux is restricted to the fixed script allowlist", () => {
  assert.deepEqual(validateToolArguments("run_termux_script", { name: "device_info" }), { name: "device_info" });
  assert.throws(() => validateToolArguments("run_termux_script", { name: "arbitrary_shell" }));
});

test("Android package names are validated", () => {
  assert.deepEqual(validateToolArguments("launch_app", { package_name: "com.example.app" }), { package_name: "com.example.app" });
  assert.throws(() => validateToolArguments("launch_app", { package_name: "bad name" }));
});

test("empty tools do not accept arbitrary arguments", () => {
  assert.deepEqual(validateToolArguments("ping_phone", {}), {});
  assert.throws(() => validateToolArguments("ping_phone", { command: "anything" }));
});
