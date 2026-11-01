import assert from "node:assert/strict";
import { parseUnitTestOutput } from "../src/simulator/unit-results.js";

const passed = "Executing test example...\nPASS\nRESULTS\nTest: Status:\nexample PASS\nRan 1 test\nPASSED (failures=0, errors=0)\nConnection Finished\n";
const cases: Array<[string, string, boolean, number, number, number]> = [
  ["documented success", passed, true, 1, 0, 0],
  ["explicit passed count", passed.replace("failures=0", "passed=1, failed=0"), true, 1, 0, 0],
  ["mixed case and CRLF", passed.replaceAll("\n", "\r\n").replaceAll("PASS", "Pass"), true, 1, 0, 0],
  ["ANSI colored table", passed.replace("example PASS", "example \x1b[32mPASS\x1b[0m"), true, 1, 0, 0],
  ["empty output", "", false, 0, 0, 0],
  ["individual pass only", "Executing test example...\nPASS\n", false, 0, 0, 0],
  ["truncated summary", passed.replace("PASSED (failures=0, errors=0)", "PASSED (failures="), false, 1, 0, 0],
  ["unknown test", "RESULTS\nRan 0 tests\nPASSED (failures=0, errors=0)\n", false, 0, 0, 0],
  ["missing Ran count", passed.replace("Ran 1 test\n", ""), false, 0, 0, 0],
  ["count mismatch", passed.replace("Ran 1 test", "Ran 2 tests"), false, 1, 0, 0],
  ["summary mismatch", passed.replace("failures=0", "passed=2, failed=0"), false, 1, 0, 0],
  ["missing error count", passed.replace(", errors=0", ""), false, 1, 0, 0],
  ["duplicate count", passed.replace("errors=0", "errors=0, errors=0"), false, 1, 0, 0],
  ["multiple sessions", passed + passed, false, 0, 0, 0],
  ["earlier assertion", "ASSERTION FAILED\n" + passed, false, 1, 0, 0],
  ["earlier exception", "Unhandled Exception\n" + passed, false, 1, 0, 0],
  ["complete failing suite", "RESULTS\nfirst PASS\nsecond FAIL\nRan 2 tests\nFAILED (passed=1, failed=1, errors=0)", true, 1, 1, 0],
  ["complete error suite", "RESULTS\nfirst PASS\nsecond ERROR\nRan 2 tests\nFAILED (passed=1, failed=0, errors=1)", true, 1, 0, 1],
  ["pass verdict with failed table", "RESULTS\nfirst FAIL\nRan 1 test\nPASSED (failures=1, errors=0)", false, 0, 1, 0],
  ["duplicate test names", "RESULTS\nfirst PASS\nfirst PASS\nRan 2 tests\nPASSED (failures=0, errors=0)", false, 2, 0, 0],
  ["summary before Ran", "RESULTS\nfirst PASS\nPASSED (failures=0, errors=0)\nRan 1 test", false, 1, 0, 0],
];
for (const [name, output, complete, nPassed, failed, errors] of cases) {
  const actual = parseUnitTestOutput(output);
  assert.equal(actual.complete, complete, name);
  assert.equal(actual.passed, nPassed, name);
  assert.equal(actual.failed, failed, name);
  assert.equal(actual.errors, errors, name);
  console.log(`PASS ${name}`);
}
console.log(`${cases.length} parser cases passed.`);
