import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SimulatorProcessManager } from "../src/simulator/process-manager.js";
import type { GarminSdkPaths } from "../src/types.js";

// No real simulator or app state is touched by these process-lifecycle regressions.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "garmin-unit-runner-"));
const executable = path.join(root, "fake-monkeydo");
const good = "RESULTS\nexample PASS\nRan 1 test\nPASSED (failures=0, errors=0)\n";
try {
  await fs.writeFile(executable, `#!${process.execPath}\nconst mode=process.argv[2];\n` +
    `if(mode==='timeout') {console.error('timeout diagnostic'); setInterval(()=>{},1000);}\n` +
    `else if(mode==='signal') {process.stdout.write(${JSON.stringify(good)}); process.kill(process.pid,'SIGTERM');}\n` +
    `else if(mode==='empty') {}\n` +
    `else if(mode==='partial') {console.log('PASS');}\n` +
    `else if(mode==='failed') {console.log('RESULTS\\nfirst PASS\\nsecond ERROR\\nRan 2 tests\\nFAILED (passed=1, failed=0, errors=1)');}\n` +
    `else if(mode==='alive') {setInterval(()=>{},1000);}\n` +
    `else {process.stdout.write(${JSON.stringify(good)}); if(mode==='exit1') process.exitCode=1;}\n`);
  await fs.chmod(executable, 0o700);
  const sdk = { monkeydoPath: executable } as GarminSdkPaths;
  const manager = new SimulatorProcessManager();
  for (const [mode, expected] of [["success", true], ["exit1", true], ["empty", false],
    ["partial", false], ["failed", false], ["signal", false], ["timeout", false]] as const) {
    const result = await manager.runUnitTests(sdk, { prgPath: mode, deviceId: "fenix847mm", timeoutMs: mode === "timeout" ? 400 : 3000 });
    assert.equal(result.passed, expected, mode);
    if (mode === "exit1") assert.match(result.exitCodeWarning ?? "", /exited 1 despite a complete PASSED summary/);
    if (mode === "signal") assert.equal(result.signal, "SIGTERM");
    if (mode === "timeout") {
      assert.equal(result.timedOut, true);
      assert.match(result.output, /timeout diagnostic/);
    }
    console.log(`PASS runner ${mode}`);
  }
  const missing = await manager.runUnitTests({ monkeydoPath: path.join(root, "missing") } as GarminSdkPaths,
    { prgPath: "unused", deviceId: "fenix847mm", timeoutMs: 1000 });
  assert.equal(missing.passed, false);
  assert.equal(missing.summary.complete, false);
  console.log("PASS runner spawn error");
  await assert.rejects(manager.runUnitTests(sdk, { prgPath: "unused", deviceId: "fenix847mm", timeoutMs: 0 }));
  console.log("PASS runner rejects invalid timeout");
  // Startup requires a recognized marker; timeout and a zero launcher exit are not success.
  const prg = path.join(root, "test.prg");
  await fs.writeFile(prg, "fixture");
  const startup = await manager.runAppInSimulator(sdk, { prgPath: prg, deviceId: "fenix847mm", waitMs: 1000 });
  assert.equal(startup.launched, false);
  console.log("PASS zero launcher exit does not confirm startup");
  // An alive launcher past the wait window, with no fatal output, is a launch (unconfirmed).
  await fs.writeFile(executable, `#!${process.execPath}\nsetInterval(()=>{},1000);\n`);
  await fs.chmod(executable, 0o700);
  const alive = await manager.runAppInSimulator(sdk, { prgPath: prg, deviceId: "fenix847mm", waitMs: 600 });
  assert.equal(alive.launched, true);
  assert.equal(alive.startupConfirmed, false);
  await manager.stopActiveApp();
  console.log("PASS alive launcher past the wait window counts as an inferred launch");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
