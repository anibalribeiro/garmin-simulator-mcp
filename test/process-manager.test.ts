import assert from "node:assert";
import * as net from "node:net";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
  SimulatorProcessManager,
  getProcessManager,
  processManager,
} from "../src/simulator/process-manager.js";

async function runTests() {
  console.log("=== Running SimulatorProcessManager Tests ===\n");
  let passedCount = 0;
  let failedCount = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passedCount++;
    } catch (err: any) {
      console.error(`  [FAIL] ${name}: ${err?.message || err}`);
      if (err?.stack) {
        console.error(err.stack);
      }
      failedCount++;
    }
  }

  // 1. Singleton & Factory
  await test("singleton and factory export the same instance", () => {
    assert.strictEqual(processManager, getProcessManager());
    assert.ok(processManager instanceof SimulatorProcessManager);
  });

  // 2. Log Ring Buffer Operations
  await test("log ring buffer: appendLog, getLogs, clearLogs", () => {
    const pm = new SimulatorProcessManager(500);
    assert.strictEqual(pm.getLogs().length, 0);

    pm.appendLog("stdout", "First log line");
    pm.appendLog("stderr", "Second error line");
    pm.appendLog("system", "Third system line");

    const logs = pm.getLogs();
    assert.strictEqual(logs.length, 3);
    assert.ok(logs[0].includes("[stdout] First log line"));
    assert.ok(logs[1].includes("[stderr] Second error line"));
    assert.ok(logs[2].includes("[system] Third system line"));

    // Check ISO timestamp pattern [YYYY-MM-DDTHH:mm:ss
    assert.match(logs[0], /^\[\d{4}-\d{2}-\d{2}T/);

    // Test getLogs with lines limit
    const last2 = pm.getLogs({ lines: 2 });
    assert.strictEqual(last2.length, 2);
    assert.ok(last2[0].includes("Second error line"));
    assert.ok(last2[1].includes("Third system line"));

    // Test getLogs with clear=true
    const clearedLogs = pm.getLogs({ clear: true });
    assert.strictEqual(clearedLogs.length, 3);
    assert.strictEqual(pm.getLogs().length, 0);
  });

  await test("log ring buffer: multiline string splitting", () => {
    const pm = new SimulatorProcessManager(500);
    pm.appendLog("stdout", "Line 1\nLine 2\r\nLine 3");

    const logs = pm.getLogs();
    assert.strictEqual(logs.length, 3);
    assert.ok(logs[0].includes("[stdout] Line 1"));
    assert.ok(logs[1].includes("[stdout] Line 2"));
    assert.ok(logs[2].includes("[stdout] Line 3"));
  });

  await test("log ring buffer: capacity overflow (drops oldest entries)", () => {
    const capacity = 5;
    const pm = new SimulatorProcessManager(capacity);

    for (let i = 1; i <= 8; i++) {
      pm.appendLog("stdout", `Message ${i}`);
    }

    const logs = pm.getLogs();
    assert.strictEqual(logs.length, 5);
    // Messages 1, 2, 3 should have been dropped; 4..8 remain
    assert.ok(logs[0].includes("Message 4"));
    assert.ok(logs[1].includes("Message 5"));
    assert.ok(logs[2].includes("Message 6"));
    assert.ok(logs[3].includes("Message 7"));
    assert.ok(logs[4].includes("Message 8"));
  });

  await test("log ring buffer: explicit clearLogs()", () => {
    const pm = new SimulatorProcessManager(500);
    pm.appendLog("system", "Test line");
    assert.strictEqual(pm.getLogs().length, 1);
    pm.clearLogs();
    assert.strictEqual(pm.getLogs().length, 0);
  });

  // 3. TCP Port Readiness Check
  await test("isSimulatorPortOpen returns false on closed port", async () => {
    const pm = new SimulatorProcessManager();
    // Using an ephemeral port that is not in use
    const isOpen = await pm.isSimulatorPortOpen(59876, "127.0.0.1", 300);
    assert.strictEqual(isOpen, false);
  });

  await test("isSimulatorPortOpen returns true when local server is listening", async () => {
    const pm = new SimulatorProcessManager();
    const server = net.createServer();

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address() as net.AddressInfo;
    const testPort = address.port;

    try {
      const isOpen = await pm.isSimulatorPortOpen(testPort, "127.0.0.1", 500);
      assert.strictEqual(isOpen, true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // Now after closing, port should be closed
    const isClosedNow = await pm.isSimulatorPortOpen(testPort, "127.0.0.1", 300);
    assert.strictEqual(isClosedNow, false);
  });

  await test("isSimulatorPortOpen checks actual simulator port 1234", async () => {
    const pm = new SimulatorProcessManager();
    const isOpen = await pm.isSimulatorPortOpen(1234, "127.0.0.1", 800);
    console.log(`    (Current ConnectIQ simulator port 1234 status: ${isOpen ? "OPEN" : "CLOSED"})`);
    // Assert it returns a boolean
    assert.strictEqual(typeof isOpen, "boolean");
  });

  // 4. Command Argument Construction: monkeyc
  await test("buildMonkeyCArgs builds correct arguments without dev key", () => {
    const pm = new SimulatorProcessManager();
    const args = pm.buildMonkeyCArgs({
      deviceId: "fenix847mm",
      jungleFile: "/app/monkey.jungle",
      outputPrgPath: "/app/bin/app.prg",
    });

    assert.deepStrictEqual(args, [
      "-d", "fenix847mm",
      "-f", "/app/monkey.jungle",
      "-o", "/app/bin/app.prg",
      "-w",
    ]);
  });

  await test("buildMonkeyCArgs builds correct arguments with dev key and extraArgs", () => {
    const pm = new SimulatorProcessManager();
    const args = pm.buildMonkeyCArgs({
      deviceId: "venu3",
      jungleFile: "/project/monkey.jungle",
      outputPrgPath: "/project/bin/output.prg",
      developerKeyPath: "/keys/developer_key.der",
      extraArgs: ["--release", "-O", "p"],
    });

    assert.deepStrictEqual(args, [
      "-d", "venu3",
      "-f", "/project/monkey.jungle",
      "-o", "/project/bin/output.prg",
      "-y", "/keys/developer_key.der",
      "-w",
      "--release",
      "-O",
      "p",
    ]);
  });

  // 5. Command Argument Construction: monkeydo
  await test("buildMonkeyDoArgs for running app", () => {
    const pm = new SimulatorProcessManager();
    const args = pm.buildMonkeyDoArgs("/path/to/app.prg", "fr965");
    assert.deepStrictEqual(args, ["/path/to/app.prg", "fr965"]);
  });

  await test("buildMonkeyDoArgs for running all unit tests", () => {
    const pm = new SimulatorProcessManager();
    const args = pm.buildMonkeyDoArgs("/path/to/app.prg", "fr965", { test: true });
    assert.deepStrictEqual(args, ["/path/to/app.prg", "fr965", "-t"]);
  });

  await test("buildMonkeyDoArgs for running named unit test", () => {
    const pm = new SimulatorProcessManager();
    const args = pm.buildMonkeyDoArgs("/path/to/app.prg", "fr965", {
      test: true,
      testName: "TestHeartRateCalc",
    });
    assert.deepStrictEqual(args, [
      "/path/to/app.prg",
      "fr965",
      "-t",
      "TestHeartRateCalc",
    ]);
  });

  // 6. Developer Key Resolution
  await test("resolveDeveloperKey detects developer_key.der in projectDir", async () => {
    const pm = new SimulatorProcessManager();
    const tmpDir = path.join(os.tmpdir(), `garmin-test-${Date.now()}`);
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const dummyKey = path.join(tmpDir, "developer_key.der");
    await fs.promises.writeFile(dummyKey, "dummy-key-content");

    try {
      const resolved = await pm.resolveDeveloperKey(undefined, tmpDir);
      assert.strictEqual(resolved, dummyKey);
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  await test("resolveDeveloperKey prioritizes custom key if specified", async () => {
    const pm = new SimulatorProcessManager();
    const customKey = "/custom/path/key.der";
    const resolved = await pm.resolveDeveloperKey(customKey);
    assert.strictEqual(resolved, customKey);
  });

  // 7. Process State & stopActiveApp
  await test("stopActiveApp returns stopped: false when no app is active", async () => {
    const pm = new SimulatorProcessManager();
    assert.strictEqual(pm.isAppRunning(), false);
    assert.strictEqual(pm.getCurrentDeviceId(), undefined);
    const result = await pm.stopActiveApp();
    assert.strictEqual(result.stopped, false);
  });

  console.log(`\n=== Test Results: ${passedCount} passed, ${failedCount} failed ===\n`);
  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner threw uncaught exception:", err);
  process.exit(1);
});
