export interface UnitTestCaseResult {
  name: string;
  status: "PASS" | "FAIL" | "ERROR";
}

export interface UnitTestSummary {
  complete: boolean;
  executed: number;
  passed: number;
  failed: number;
  errors: number;
  tests: UnitTestCaseResult[];
  issues: string[];
}

/** Parse the SDK's RESULTS table, Ran count and terminal PASSED/FAILED summary.
 * Never infer success from an individual PASS or from the absence of failures.
 */
export function parseUnitTestOutput(output: string): UnitTestSummary {
  const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split(/\r\n|\n|\r/).map((s) => s.trim());
  const result: UnitTestSummary = {
    complete: false, executed: 0, passed: 0, failed: 0, errors: 0,
    tests: [], issues: [],
  };
  const headings = lines.flatMap((s, i) => /^RESULTS$/i.test(s) ? [i] : []);
  if (headings.length !== 1) {
    result.issues.push("Expected exactly one RESULTS table.");
    return result;
  }
  const section = lines.slice(headings[0] + 1);
  const runs = section.filter((s) => /^Ran\s+\d+\s+tests?$/i.test(s));
  const summaries = lines.filter((s) => /^(?:PASSED|FAILED)\s*\(/i.test(s));
  if (runs.length !== 1 || summaries.length !== 1) {
    result.issues.push("Expected one Ran count and one terminal PASSED/FAILED summary.");
    return result;
  }
  result.executed = Number(runs[0].match(/\d+/)![0]);
  for (const line of section.slice(0, section.indexOf(runs[0]))) {
    if (!line || /^Test:\s*Status:?$/i.test(line) || /^=+$/.test(line)) continue;
    const entry = line.match(/^(\S+)\s+(PASS|FAIL|FAILED|ERROR)$/i);
    if (!entry) {
      result.issues.push(`Unrecognized result row: ${line}`);
      continue;
    }
    const status = entry[2].toUpperCase();
    result.tests.push({ name: entry[1], status: status === "FAILED" ? "FAIL" : status as UnitTestCaseResult["status"] });
  }
  result.passed = result.tests.filter((t) => t.status === "PASS").length;
  result.failed = result.tests.filter((t) => t.status === "FAIL").length;
  result.errors = result.tests.filter((t) => t.status === "ERROR").length;

  const terminal = summaries[0].match(/^(PASSED|FAILED)\s*\(([^)]+)\)$/i);
  if (!terminal || section.indexOf(summaries[0]) <= section.indexOf(runs[0])) {
    result.issues.push("Missing or out-of-order terminal summary.");
    return result;
  }
  const counts: Record<string, number> = {};
  for (const field of terminal[2].split(",")) {
    const match = field.trim().match(/^(passed|failed|failures|errors)\s*=\s*(\d+)$/i);
    if (!match) {
      result.issues.push("Unrecognized summary count.");
      continue;
    }
    const key = match[1].toLowerCase().replace("failures", "failed");
    if (key in counts) result.issues.push("Duplicate summary count.");
    counts[key] = Number(match[2]);
  }
  if (counts.failed === undefined || counts.errors === undefined) result.issues.push("Missing failure/error counts.");
  if (result.executed < 1) result.issues.push("No tests executed.");
  if (result.tests.length !== result.executed) result.issues.push("RESULTS table does not match Ran count.");
  if (new Set(result.tests.map((t) => t.name)).size !== result.tests.length) result.issues.push("Duplicate test names.");
  if (counts.failed !== result.failed || counts.errors !== result.errors ||
      (counts.passed !== undefined && counts.passed !== result.passed)) {
    result.issues.push("Summary counts do not match individual test results.");
  }
  const terminalPassed = terminal[1].toUpperCase() === "PASSED";
  if (terminalPassed !== (result.failed === 0 && result.errors === 0)) result.issues.push("Terminal verdict conflicts with results.");
  // A complete table must not conceal an earlier crash or assertion failure.
  if (terminalPassed && lines.some((s) => /^(?:ASSERTION FAILED|Unhandled Exception|Encountered an app crash\.|Unable to communicate with (?:the )?simulator\.|FAIL$|ERROR\b|Error:.*)$/i.test(s))) {
    result.issues.push("Error output conflicts with successful summary.");
  }
  result.complete = result.issues.length === 0;
  return result;
}
