import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { locateGarminSdk, readSimulatorIni } from "../src/config/sdk-locator.js";
import {
  parsePngDimensions,
  parseDeviceProfile,
  resolveDeviceButton,
  computeSwipePoints,
  listInstalledDevices,
} from "../src/metadata/device-parser.js";

function test(name: string, fn: () => void | Promise<void>) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exit(1);
  }
}

console.log("Running SDK & Device Metadata Engine Tests...\n");

// 1. SDK Locator
test("locateGarminSdk resolves valid paths to SDK tools", () => {
  const sdk = locateGarminSdk();

  assert.ok(sdk.connectIqRoot, "connectIqRoot should be set");
  assert.ok(fs.existsSync(sdk.connectIqRoot), "connectIqRoot must exist on disk");
  assert.ok(fs.existsSync(sdk.sdkPath), "sdkPath must exist on disk");
  assert.ok(fs.existsSync(sdk.binDir), "binDir must exist on disk");
  assert.ok(fs.existsSync(sdk.devicesDir), "devicesDir must exist on disk");
  assert.ok(fs.existsSync(sdk.simulatorIniPath), "simulator.ini must exist on disk");
  assert.ok(fs.existsSync(sdk.simulatorAppPath), "ConnectIQ.app must exist on disk");
  assert.ok(fs.existsSync(sdk.monkeycPath), "monkeyc must exist on disk");
  assert.ok(fs.existsSync(sdk.monkeydoPath), "monkeydo must exist on disk");
  assert.ok(fs.existsSync(sdk.shellPath), "shell must exist on disk");
});

// 2. Simulator INI Parser
test("readSimulatorIni parses simulator.ini properties", () => {
  const ini = readSimulatorIni();

  assert.ok(typeof ini.lastUsedDevice === "string", "lastUsedDevice should be a string");
  assert.ok(ini.windowWidth === undefined || typeof ini.windowWidth === "number", "windowWidth should be a number or undefined");
  assert.ok(ini.windowHeight === undefined || typeof ini.windowHeight === "number", "windowHeight should be a number or undefined");
  assert.strictEqual(typeof ini.glance, "boolean", "glance should be a boolean");
  assert.ok(Object.keys(ini.raw).length > 0, "raw ini map should have entries");
});

// 3. PNG Dimensions Parser
test("parsePngDimensions extracts width and height from PNG header", () => {
  const sdk = locateGarminSdk();
  const fenixPng = path.join(sdk.devicesDir, "fenix847mm", "fenix847mm.png");

  const dims = parsePngDimensions(fenixPng);
  assert.ok(dims, "dimensions should not be undefined");
  assert.strictEqual(dims.width, 713);
  assert.strictEqual(dims.height, 921);

  // Test invalid path
  assert.strictEqual(parsePngDimensions("/non/existent/path.png"), undefined);

  // Test non-PNG file
  const iniFile = sdk.simulatorIniPath;
  assert.strictEqual(parsePngDimensions(iniFile), undefined);
});

// 4. Device Profile Parser - fenix847mm
test("parseDeviceProfile correctly parses fenix847mm", () => {
  const profile = parseDeviceProfile("fenix847mm");

  assert.strictEqual(profile.deviceId, "fenix847mm");
  assert.ok(profile.displayName.includes("fēnix® 8"), "displayName should contain fēnix® 8");
  assert.strictEqual(profile.deviceFamily, "round-454x454");
  assert.strictEqual(profile.displayType, "amoled");
  assert.strictEqual(profile.display.isTouch, true);
  assert.strictEqual(profile.display.shape, "round");
  assert.strictEqual(profile.display.location.width, 454);
  assert.strictEqual(profile.display.location.height, 454);
  assert.strictEqual(profile.display.location.x, 134);
  assert.strictEqual(profile.display.location.y, 221);

  assert.ok(profile.bezelImageFile, "bezelImageFile should be present");
  assert.deepStrictEqual(profile.bezelDimensions, { width: 713, height: 921 });

  // Key mappings
  const keyIds = profile.keys.map((k) => k.id);
  assert.ok(keyIds.includes("enter"));
  assert.ok(keyIds.includes("up"));
  assert.ok(keyIds.includes("menu"));
  assert.ok(keyIds.includes("down"));
  assert.ok(keyIds.includes("esc"));

  const enterKey = profile.keys.find((k) => k.id === "enter")!;
  assert.strictEqual(enterKey.behavior, "onSelect");
  assert.strictEqual(enterKey.isHold, false);
  assert.ok(enterKey.aliases.includes("select"));
  assert.ok(enterKey.aliases.includes("start"));
  assert.ok(enterKey.aliases.includes("enter"));

  const menuKey = profile.keys.find((k) => k.id === "menu")!;
  assert.strictEqual(menuKey.behavior, "onMenu");
  assert.strictEqual(menuKey.isHold, true);
  assert.ok(menuKey.aliases.includes("menu"));
});

// 5. Device Profile Parser - venu3
test("parseDeviceProfile correctly parses venu3", () => {
  const profile = parseDeviceProfile("venu3");

  assert.strictEqual(profile.deviceId, "venu3");
  assert.strictEqual(profile.display.isTouch, true);
  assert.strictEqual(profile.display.shape, "round");
  assert.strictEqual(profile.display.location.width, 454);
  assert.strictEqual(profile.display.location.height, 454);

  const keyIds = profile.keys.map((k) => k.id);
  assert.ok(keyIds.includes("enter"));
  assert.ok(keyIds.includes("esc"));
  assert.ok(keyIds.includes("menu"));
});

// 6. Button Resolver
test("resolveDeviceButton matches buttons and handles hold collocated keys", () => {
  const fenix = parseDeviceProfile("fenix847mm");

  // Basic lookups
  const selectKey = resolveDeviceButton(fenix, "select");
  assert.strictEqual(selectKey?.id, "enter");
  assert.strictEqual(selectKey?.isHold, false);

  const backKey = resolveDeviceButton(fenix, "back");
  assert.strictEqual(backKey?.id, "esc");
  assert.strictEqual(backKey?.isHold, false);

  const downKey = resolveDeviceButton(fenix, "down");
  assert.strictEqual(downKey?.id, "down");
  assert.strictEqual(downKey?.isHold, false);

  // Short press up
  const upKey = resolveDeviceButton(fenix, "up");
  assert.strictEqual(upKey?.id, "up");
  assert.strictEqual(upKey?.isHold, false);

  // Hold up -> resolves collocated hold key (menu)
  const upHoldKey = resolveDeviceButton(fenix, "up", true);
  assert.strictEqual(upHoldKey?.id, "menu");
  assert.strictEqual(upHoldKey?.isHold, true);

  // Explicit menu request
  const menuKey = resolveDeviceButton(fenix, "menu");
  assert.strictEqual(menuKey?.id, "menu");
  assert.strictEqual(menuKey?.isHold, true);

  // Venu 3 hold button test
  const venu = parseDeviceProfile("venu3");
  const venuBack = resolveDeviceButton(venu, "back");
  assert.strictEqual(venuBack?.id, "esc");
  assert.strictEqual(venuBack?.isHold, false);

  const venuBackHold = resolveDeviceButton(venu, "back", true);
  assert.strictEqual(venuBackHold?.id, "menu");
  assert.strictEqual(venuBackHold?.isHold, true);
});

// 7. Swipe Points Calculator
test("computeSwipePoints calculates valid gesture points adhering to constraints", () => {
  const fenix = parseDeviceProfile("fenix847mm");

  // Swipe right (onBack)
  const rightSwipe = computeSwipePoints(fenix, "right");
  assert.strictEqual(rightSwipe.durationMs, 150);
  assert.ok(rightSwipe.startWatch.x <= 36, `startWatch.x should be <= 36 (got ${rightSwipe.startWatch.x})`);
  assert.strictEqual(rightSwipe.startWatch.y, 227);
  assert.strictEqual(rightSwipe.endWatch.x, 341);
  assert.strictEqual(rightSwipe.endWatch.y, 227);
  assert.ok(rightSwipe.endWatch.x - rightSwipe.startWatch.x >= 90, "swipe delta should exceed minSwipeDeltaX (90px)");

  // Swipe left
  const leftSwipe = computeSwipePoints(fenix, "left");
  assert.strictEqual(leftSwipe.durationMs, 150);
  assert.strictEqual(leftSwipe.startWatch.x, 363);
  assert.strictEqual(leftSwipe.endWatch.x, 91);
  assert.strictEqual(leftSwipe.startWatch.y, 227);
  assert.strictEqual(leftSwipe.endWatch.y, 227);

  // Swipe up (nextPage)
  const upSwipe = computeSwipePoints(fenix, "up");
  assert.strictEqual(upSwipe.durationMs, 150);
  assert.strictEqual(upSwipe.startWatch.x, 227);
  assert.strictEqual(upSwipe.endWatch.x, 227);
  assert.strictEqual(upSwipe.startWatch.y, 354);
  assert.strictEqual(upSwipe.endWatch.y, 100);

  // Swipe down (previousPage)
  const downSwipe = computeSwipePoints(fenix, "down");
  assert.strictEqual(downSwipe.durationMs, 150);
  assert.strictEqual(downSwipe.startWatch.x, 227);
  assert.strictEqual(downSwipe.endWatch.x, 227);
  assert.strictEqual(downSwipe.startWatch.y, 100);
  assert.strictEqual(downSwipe.endWatch.y, 354);
});

// 8. Device Listing & Filtering
test("listInstalledDevices lists, filters, and sorts devices", () => {
  const allDevices = listInstalledDevices();
  assert.ok(allDevices.length >= 170, `Expected >= 170 devices, got ${allDevices.length}`);

  // Check alphabetical sort
  for (let i = 1; i < allDevices.length; i++) {
    assert.ok(
      allDevices[i - 1].deviceId.localeCompare(allDevices[i].deviceId) <= 0,
      `Devices should be sorted by deviceId (${allDevices[i - 1].deviceId} vs ${allDevices[i].deviceId})`
    );
  }

  // Filter by query
  const fenix8Devices = listInstalledDevices({ query: "fenix8" });
  assert.ok(fenix8Devices.length >= 4, `Expected >= 4 fenix8 devices, got ${fenix8Devices.length}`);
  for (const d of fenix8Devices) {
    const match = d.deviceId.toLowerCase().includes("fenix8") || d.displayName.toLowerCase().includes("fenix8") || d.displayName.toLowerCase().includes("fēnix® 8");
    assert.ok(match, `Device ${d.deviceId} (${d.displayName}) should match query "fenix8"`);
  }

  // Filter by touchOnly
  const touchDevices = listInstalledDevices({ touchOnly: true });
  assert.ok(touchDevices.length > 0);
  assert.ok(touchDevices.length < allDevices.length, "Not all devices should be touch devices");
  for (const d of touchDevices) {
    assert.strictEqual(d.isTouch, true, `Device ${d.deviceId} must be a touch device`);
  }
});

console.log("\nAll Metadata Engine tests passed successfully! 🎉");
