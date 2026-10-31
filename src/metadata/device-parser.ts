import fs from "node:fs";
import path from "node:path";
import { locateGarminSdk } from "../config/sdk-locator.js";
import type {
  DeviceProfile,
  DeviceKeyMapping,
  DeviceDisplayInfo,
  Rect,
  Point,
} from "../types.js";

const profileCache = new Map<string, DeviceProfile>();

/**
 * Reads the first 24 bytes of a PNG file to extract width and height without decoding image data.
 * Returns undefined if the file does not exist, is too short, or lacks a valid PNG header.
 */
export function parsePngDimensions(
  pngPath: string
): { width: number; height: number } | undefined {
  let fd: number | undefined;
  try {
    if (!fs.existsSync(pngPath)) {
      return undefined;
    }

    fd = fs.openSync(pngPath, "r");
    const buf = Buffer.alloc(24);
    const bytesRead = fs.readSync(fd, buf, 0, 24, 0);
    if (bytesRead < 24) {
      return undefined;
    }

    // Verify PNG magic signature: 0x89 0x50 0x4E 0x47
    if (
      buf[0] !== 0x89 ||
      buf[1] !== 0x50 ||
      buf[2] !== 0x4e ||
      buf[3] !== 0x47
    ) {
      return undefined;
    }

    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * Parses simulator.json and compiler.json for a Garmin device ID into a structured DeviceProfile.
 */
export function parseDeviceProfile(
  deviceId: string,
  devicesDir?: string
): DeviceProfile {
  const resolvedDevicesDir = devicesDir ?? locateGarminSdk().devicesDir;
  const cacheKey = `${resolvedDevicesDir}:${deviceId}`;
  const cached = profileCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const devicePath = path.join(resolvedDevicesDir, deviceId);
  const simPath = path.join(devicePath, "simulator.json");
  const compPath = path.join(devicePath, "compiler.json");

  if (!fs.existsSync(simPath)) {
    throw new Error(
      `Device profile "${deviceId}" not found in "${resolvedDevicesDir}" (missing simulator.json)`
    );
  }

  const sim = JSON.parse(fs.readFileSync(simPath, "utf-8"));
  let comp: Record<string, any> = {};
  if (fs.existsSync(compPath)) {
    try {
      comp = JSON.parse(fs.readFileSync(compPath, "utf-8"));
    } catch {
      comp = {};
    }
  }

  const displayName: string = comp.displayName ?? deviceId;
  const deviceFamily: string | undefined = comp.deviceFamily;
  const displayType: string | undefined = comp.displayType;
  const partNumber: string | undefined =
    comp.worldWidePartNumber ?? comp.hardwarePartNumber;

  const bezelImageFile: string | undefined = sim.image;
  let bezelDimensions: { width: number; height: number } | undefined;
  if (bezelImageFile) {
    bezelDimensions = parsePngDimensions(path.join(devicePath, bezelImageFile));
  }

  const display: DeviceDisplayInfo = {
    isTouch: Boolean(sim.display?.isTouch),
    shape: sim.display?.shape ?? "round",
    location: sim.display?.location ?? {
      x: 0,
      y: 0,
      width: 454,
      height: 454,
    },
    behaviors: Array.isArray(sim.display?.behaviors)
      ? sim.display.behaviors
      : [],
  };

  const rawKeys = Array.isArray(sim.keys) ? sim.keys : [];
  const keys: DeviceKeyMapping[] = rawKeys.map((k: any) => {
    const id = String(k.id ?? "");
    const behavior = k.behavior ? String(k.behavior) : undefined;
    const isHold = Boolean(k.isHold);
    const location: Rect = k.location ?? { x: 0, y: 0, width: 0, height: 0 };
    const center: Point = {
      x: Math.round(location.x + location.width / 2),
      y: Math.round(location.y + location.height / 2),
    };

    const aliasesSet = new Set<string>();
    if (id) {
      aliasesSet.add(id.toLowerCase());
    }
    if (behavior) {
      aliasesSet.add(behavior.toLowerCase());
    }

    const idLower = id.toLowerCase();
    const behLower = behavior?.toLowerCase() ?? "";

    if (idLower === "enter" || behLower === "onselect") {
      ["select", "start", "enter", "ok", "onselect"].forEach((a) =>
        aliasesSet.add(a)
      );
    }
    if (idLower === "esc" || behLower === "onback") {
      ["back", "esc", "escape", "lap", "onback"].forEach((a) =>
        aliasesSet.add(a)
      );
    }
    if (idLower === "up" || behLower === "previouspage") {
      ["up", "prev", "previous", "previouspage"].forEach((a) =>
        aliasesSet.add(a)
      );
    }
    if (idLower === "down" || behLower === "nextpage") {
      ["down", "next", "nextpage"].forEach((a) => aliasesSet.add(a));
    }
    if (idLower === "menu" || behLower === "onmenu") {
      ["menu", "onmenu"].forEach((a) => aliasesSet.add(a));
    }

    return {
      id,
      behavior,
      isHold,
      location,
      center,
      aliases: Array.from(aliasesSet),
    };
  });

  const profile: DeviceProfile = {
    deviceId,
    displayName,
    deviceFamily,
    displayType,
    partNumber,
    bezelImageFile,
    bezelDimensions,
    display,
    keys,
  };

  profileCache.set(cacheKey, profile);
  return profile;
}

/**
 * Resolves a semantic button name (e.g. "select", "back", "up", "down", "menu")
 * to the appropriate DeviceKeyMapping on the device.
 * Handles hold actions and collocated hold keys (e.g. pressing "up" with hold=true -> "menu").
 */
export function resolveDeviceButton(
  profile: DeviceProfile,
  buttonName: string,
  hold?: boolean
): DeviceKeyMapping | undefined {
  const name = buttonName.toLowerCase().trim();
  if (!name) return undefined;

  // 1. Find all keys matching by alias
  let matchingKeys = profile.keys.filter((k) => k.aliases.includes(name));

  // Fallback: match by id or behavior
  if (matchingKeys.length === 0) {
    matchingKeys = profile.keys.filter(
      (k) =>
        k.id.toLowerCase() === name ||
        k.behavior?.toLowerCase() === name ||
        k.aliases.some((a) => a.includes(name))
    );
  }

  if (matchingKeys.length === 0) {
    return undefined;
  }

  // If hold === true:
  if (hold) {
    // Check if one of matchingKeys has isHold === true
    const holdMatch = matchingKeys.find((k) => k.isHold);
    if (holdMatch) {
      return holdMatch;
    }

    // Look for any key in profile.keys at the same location that has isHold === true
    const baseKey = matchingKeys[0];
    const collocatedHoldKey = profile.keys.find(
      (k) =>
        k.isHold &&
        k !== baseKey &&
        Math.abs(k.center.x - baseKey.center.x) <= 5 &&
        Math.abs(k.center.y - baseKey.center.y) <= 5
    );
    if (collocatedHoldKey) {
      return collocatedHoldKey;
    }

    return baseKey;
  }

  // If hold !== true:
  // If buttonName is explicitly requesting menu, return menu mapping even though isHold may be true
  if (name === "menu" || name === "onmenu") {
    const menuKey = matchingKeys.find(
      (k) =>
        k.id.toLowerCase() === "menu" ||
        k.behavior?.toLowerCase() === "onmenu"
    );
    if (menuKey) return menuKey;
  }

  // Prefer non-hold key when hold is false/undefined
  const nonHoldKey = matchingKeys.find((k) => !k.isHold);
  if (nonHoldKey) {
    return nonHoldKey;
  }

  return matchingKeys[0];
}

/**
 * Computes swipe start and end coordinates relative to the watch screen display (0..width, 0..height)
 * based on device display dimensions and gesture recognizer constraints.
 */
export function computeSwipePoints(
  profile: DeviceProfile,
  direction: "up" | "down" | "left" | "right"
): { startWatch: Point; endWatch: Point; durationMs: number } {
  const width = profile.display.location.width;
  const height = profile.display.location.height;

  const behaviors = profile.display.behaviors ?? [];
  const rightBehavior = behaviors.find(
    (b) => b.gesture === "swipeRight" || b.id === "onBack"
  );

  const durationMs = 150;
  let startWatch: Point;
  let endWatch: Point;

  switch (direction) {
    case "right": {
      // Swipe right triggers onBack: must start within maxDistToEdge of left border
      const maxDistToEdge = rightBehavior?.maxDistToEdge ?? 80;
      const x1 = Math.min(35, Math.floor(maxDistToEdge * 0.45));
      const y1 = Math.round(height / 2);
      const x2 = Math.round(width * 0.75);
      const y2 = y1;
      startWatch = { x: x1, y: y1 };
      endWatch = { x: x2, y: y2 };
      break;
    }
    case "left": {
      const x1 = Math.round(width * 0.8);
      const y1 = Math.round(height / 2);
      const x2 = Math.round(width * 0.2);
      const y2 = y1;
      startWatch = { x: x1, y: y1 };
      endWatch = { x: x2, y: y2 };
      break;
    }
    case "up": {
      // Drag finger UP -> triggers nextPage
      const x = Math.round(width / 2);
      const y1 = Math.round(height * 0.78);
      const y2 = Math.round(height * 0.22);
      startWatch = { x, y: y1 };
      endWatch = { x, y: y2 };
      break;
    }
    case "down": {
      // Drag finger DOWN -> triggers previousPage
      const x = Math.round(width / 2);
      const y1 = Math.round(height * 0.22);
      const y2 = Math.round(height * 0.78);
      startWatch = { x, y: y1 };
      endWatch = { x, y: y2 };
      break;
    }
  }

  return { startWatch, endWatch, durationMs };
}

export interface InstalledDeviceSummary {
  deviceId: string;
  displayName: string;
  resolution: { width: number; height: number };
  isTouch: boolean;
  shape: string;
  buttons: string[];
}

/**
 * Scans devices directory, parses each device folder having simulator.json,
 * and filters by search query and touch capability.
 */
export function listInstalledDevices(options?: {
  query?: string;
  touchOnly?: boolean;
  devicesDir?: string;
}): InstalledDeviceSummary[] {
  const resolvedDevicesDir =
    options?.devicesDir ?? locateGarminSdk().devicesDir;

  if (!fs.existsSync(resolvedDevicesDir)) {
    return [];
  }

  const entries = fs.readdirSync(resolvedDevicesDir, { withFileTypes: true });
  const results: InstalledDeviceSummary[] = [];
  const queryLower = options?.query?.toLowerCase().trim();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const deviceId = entry.name;
    const simPath = path.join(resolvedDevicesDir, deviceId, "simulator.json");
    if (!fs.existsSync(simPath)) continue;

    try {
      const profile = parseDeviceProfile(deviceId, resolvedDevicesDir);

      if (options?.touchOnly && !profile.display.isTouch) {
        continue;
      }

      if (queryLower) {
        const matchId = profile.deviceId.toLowerCase().includes(queryLower);
        const matchName = profile.displayName.toLowerCase().includes(queryLower);
        if (!matchId && !matchName) {
          continue;
        }
      }

      const buttonSet = new Set<string>();
      for (const k of profile.keys) {
        if (k.id) buttonSet.add(k.id);
      }

      results.push({
        deviceId: profile.deviceId,
        displayName: profile.displayName,
        resolution: {
          width: profile.display.location.width,
          height: profile.display.location.height,
        },
        isTouch: profile.display.isTouch,
        shape: profile.display.shape,
        buttons: Array.from(buttonSet),
      });
    } catch {
      // Ignore unparseable profiles
    }
  }

  results.sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  return results;
}
