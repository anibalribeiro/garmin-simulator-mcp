# Testing and result integrity

`npm test` runs metadata, bridge/image, tool, process-manager, result-parser and unit-runner regression suites serially. The bridge/image suite uses synthetic images, not a live screenshot. Some suites inspect the installed SDK/window status; these are not app functional tests or cross-device app executions.

`npm run test:e2e` retains the existing live client verification. It can press a button on the active app when Screen Recording is enabled; run it only in an isolated simulator session. Its conditional skip of live captures must not be described as a successful live capture.

`npm run build:ts` rebuilds the server. Existing connected clients keep their loaded code until restarted. Use a fresh stdio client when validating a local change.

## Unit-test result contract

`run_unit_tests` now returns the raw output, a structured `summary`, exit status, signal and timeout state. Success requires:

- Exactly one SDK `RESULTS` table, `Ran N test(s)` count and terminal summary.
- At least one executed test and one named table result per executed test.
- Consistent passed/failed/error counts, no duplicate names and no conflicting error/verdict output.
- Zero failed/error tests, normal zero exit and no timeout.

Unrecognized output is incomplete, not success. If a later SDK uses a different format, add real output fixtures and corresponding parser tests before accepting it. The parser regression samples currently follow Garmin's documented output; no Mood Check-in test output has yet been obtained because its source does not compile.

An app startup timeout or zero launcher exit without a recognized startup marker is no longer reported as a confirmed launch. The existing accepted startup markers still need validation against a real successful app session. Native app stop semantics, background isolation, structured storage/time/sensor/notification controls and complication readback remain to be implemented/verified when app testing can proceed.
