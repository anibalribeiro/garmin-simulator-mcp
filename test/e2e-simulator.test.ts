import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const serverScript = path.resolve(projectRoot, "dist/index.js");

const EXPECTED_TOOLS = [
  "simulator_status",
  "launch_simulator",
  "list_devices",
  "set_active_device",
  "build_app",
  "run_app",
  "stop_app",
  "run_unit_tests",
  "press_button",
  "press_button_sequence",
  "send_key",
  "tap_screen",
  "swipe_screen",
  "hold_screen",
  "get_screenshot",
  "get_app_logs",
  "trigger_menu_action",
  "set_glance_mode",
];

async function runE2E() {
  console.log("=== Running Garmin Emulator MCP End-to-End Client Verification ===");
  console.log(`Server entry point: ${serverScript}`);

  assert.ok(
    fs.existsSync(serverScript),
    `Compiled server entry point not found at ${serverScript}. Run 'npm run build' first.`
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverScript],
    env: {
      ...process.env,
    },
  });

  const client = new Client(
    {
      name: "garmin-emulator-e2e-test",
      version: "0.1.0",
    },
    {
      capabilities: {},
    }
  );

  try {
    console.log("\n[E2E 1] Connecting to MCP server via stdio transport...");
    await client.connect(transport);
    console.log("✓ Connected successfully to Garmin Emulator MCP server.");

    console.log("\n[E2E 2] Calling client.listTools() and asserting all expected tools...");
    const toolsResult = await client.listTools();
    const registeredToolNames = toolsResult.tools.map((t) => t.name);
    console.log(`Registered tools (${registeredToolNames.length}):`, registeredToolNames);

    for (const expectedTool of EXPECTED_TOOLS) {
      assert.ok(
        registeredToolNames.includes(expectedTool),
        `Expected tool '${expectedTool}' missing from registered tools: ${registeredToolNames.join(", ")}`
      );
    }
    console.log(`✓ All ${EXPECTED_TOOLS.length} expected MCP tools are registered.`);

    console.log("\n[E2E 3] Calling simulator_status...");
    const statusRes = await client.callTool({
      name: "simulator_status",
      arguments: {},
    });
    assert.ok(!statusRes.isError, "simulator_status returned error");
    const statusText = (statusRes.content as any[])[0]?.text;
    assert.ok(statusText, "simulator_status should return text content");
    const statusData = JSON.parse(statusText);
    console.log("Simulator status response:", JSON.stringify(statusData, null, 2));
    assert.strictEqual(typeof statusData.running, "boolean");
    assert.strictEqual(typeof statusData.port1234Open, "boolean");
    console.log("✓ simulator_status verified successfully.");

    console.log("\n[E2E 4] Calling list_devices for 'fenix8'...");
    const listRes = await client.callTool({
      name: "list_devices",
      arguments: { query: "fenix8" },
    });
    assert.ok(!listRes.isError, "list_devices returned error");
    const listText = (listRes.content as any[])[0]?.text;
    assert.ok(listText, "list_devices should return text content");
    const listData = JSON.parse(listText);
    console.log(`Found ${listData.total} Fenix 8 device profiles:`, listData.devices.map((d: any) => d.deviceId));
    assert.ok(listData.total > 0, "Should return at least one Fenix 8 profile");
    assert.ok(
      listData.devices.some((d: any) => d.deviceId.includes("fenix8")),
      "Results must include fenix8 device"
    );
    console.log("✓ list_devices verified successfully.");

    const tmpDir = path.resolve(projectRoot, ".tmp");
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const annotatedSavePath = path.resolve(tmpDir, "e2e-annotated.png");
    const screenSavePath = path.resolve(tmpDir, "e2e-screen.png");

    if (statusData.running && statusData.permissions?.screenRecording) {
      console.log("\n[E2E 5] Simulator is running with screen recording permission.");

      console.log(`- Capturing annotated view to: ${annotatedSavePath}`);
      const annotatedRes = await client.callTool({
        name: "get_screenshot",
        arguments: {
          view: "annotated",
          save_path: annotatedSavePath,
        },
      });
      assert.ok(!annotatedRes.isError, "get_screenshot annotated should succeed");
      assert.ok(fs.existsSync(annotatedSavePath), "Annotated screenshot file should exist on disk");
      const annotatedSize = fs.statSync(annotatedSavePath).size;
      assert.ok(annotatedSize > 0, "Annotated file size must be > 0 bytes");
      console.log(`✓ Annotated screenshot saved (${annotatedSize} bytes).`);

      console.log(`- Capturing watch screen crop view to: ${screenSavePath}`);
      const screenRes = await client.callTool({
        name: "get_screenshot",
        arguments: {
          view: "screen",
          save_path: screenSavePath,
        },
      });
      assert.ok(!screenRes.isError, "get_screenshot screen crop should succeed");
      assert.ok(fs.existsSync(screenSavePath), "Screen crop screenshot file should exist on disk");
      const screenSize = fs.statSync(screenSavePath).size;
      assert.ok(screenSize > 0, "Screen crop file size must be > 0 bytes");
      console.log(`✓ Screen crop screenshot saved (${screenSize} bytes).`);

      console.log("- Calling press_button (button: 'down', capture_after: true, wait_ms: 300)...");
      const pressRes = await client.callTool({
        name: "press_button",
        arguments: {
          button: "down",
          capture_after: true,
          wait_ms: 300,
        },
      });
      assert.ok(!pressRes.isError, "press_button should succeed");
      const pressContent = pressRes.content as any[];
      assert.ok(pressContent && pressContent.length > 0, "press_button must return content");
      console.log("press_button response:", pressContent[0]?.text);

      const capturedImg = pressContent.find((c: any) => c.type === "image");
      assert.ok(capturedImg, "press_button with capture_after: true should return image block");
      assert.strictEqual(capturedImg.mimeType, "image/png");
      assert.ok(capturedImg.data && capturedImg.data.length > 0, "Image block data must not be empty");
      console.log(`✓ press_button succeeded and returned updated screenshot (${capturedImg.data.length} chars base64).`);
    } else {
      console.log("\n[E2E 5] Simulator is not running or Screen Recording permission is not active. Skipping live window captures.");
    }

    console.log("\n========================================================");
    console.log("Garmin Emulator E2E Client Verification PASSED! 🎉");
    console.log("========================================================");
  } finally {
    console.log("\nClosing MCP client connection...");
    await client.close();
    console.log("✓ Client closed cleanly.");
  }
}

runE2E().catch((err) => {
  console.error("E2E Verification failed with error:", err);
  process.exit(1);
});
