import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { GarminSdkPaths, SimulatorIniState } from "../types.js";

/**
 * Resolves the ConnectIQ SDK root directory and tool paths.
 * Checks GARMIN_CONNECTIQ_ROOT or ~/Library/Application Support/Garmin/ConnectIQ,
 * reads current-sdk.cfg, and falls back to the latest directory in Sdks/.
 */
export function locateGarminSdk(): GarminSdkPaths {
  const connectIqRoot =
    process.env.GARMIN_CONNECTIQ_ROOT ||
    path.join(os.homedir(), "Library/Application Support/Garmin/ConnectIQ");

  if (!fs.existsSync(connectIqRoot)) {
    throw new Error(
      `Garmin ConnectIQ root not found at "${connectIqRoot}". Ensure the Garmin Connect IQ SDK Manager is installed or set GARMIN_CONNECTIQ_ROOT.`
    );
  }

  let sdkPath: string | undefined;
  const cfgPath = path.join(connectIqRoot, "current-sdk.cfg");

  if (fs.existsSync(cfgPath)) {
    const rawCfg = fs.readFileSync(cfgPath, "utf-8").trim();
    if (rawCfg && fs.existsSync(rawCfg)) {
      sdkPath = path.resolve(rawCfg);
    }
  }

  if (!sdkPath) {
    // Fallback to the latest folder inside Sdks/
    const sdksDir = path.join(connectIqRoot, "Sdks");
    if (fs.existsSync(sdksDir)) {
      const candidates = fs
        .readdirSync(sdksDir)
        .filter((entry) => {
          const fullPath = path.join(sdksDir, entry);
          try {
            return fs.statSync(fullPath).isDirectory();
          } catch {
            return false;
          }
        })
        .sort((a, b) => b.localeCompare(a)); // Descending sort

      if (candidates.length > 0) {
        sdkPath = path.resolve(path.join(sdksDir, candidates[0]));
      }
    }
  }

  if (!sdkPath) {
    throw new Error(
      `Garmin ConnectIQ SDK could not be located in "${connectIqRoot}". Missing current-sdk.cfg or Sdks/ entries.`
    );
  }

  const binDir = path.join(sdkPath, "bin");

  return {
    connectIqRoot,
    sdkPath,
    binDir,
    devicesDir: path.join(connectIqRoot, "Devices"),
    simulatorIniPath: path.join(connectIqRoot, "simulator.ini"),
    simulatorAppPath: path.join(binDir, "ConnectIQ.app"),
    monkeycPath: path.join(binDir, "monkeyc"),
    monkeydoPath: path.join(binDir, "monkeydo"),
    shellPath: path.join(binDir, "shell"),
  };
}

/**
 * Reads and parses Garmin simulator.ini configuration state.
 */
export function readSimulatorIni(simulatorIniPath?: string): SimulatorIniState {
  const targetIniPath =
    simulatorIniPath ??
    path.join(
      process.env.GARMIN_CONNECTIQ_ROOT ||
        path.join(os.homedir(), "Library/Application Support/Garmin/ConnectIQ"),
      "simulator.ini"
    );

  const raw: Record<string, string> = {};

  if (fs.existsSync(targetIniPath)) {
    const content = fs.readFileSync(targetIniPath, "utf-8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
        continue;
      }
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        raw[key] = val;
      }
    }
  }

  const parseNum = (val: string | undefined): number | undefined => {
    if (val === undefined || val === "") return undefined;
    const num = Number(val);
    return Number.isNaN(num) ? undefined : num;
  };

  return {
    lastUsedDevice: raw.LastUsedDevice || undefined,
    windowX: parseNum(raw.WindowX),
    windowY: parseNum(raw.WindowY),
    windowWidth: parseNum(raw.WindowWidth),
    windowHeight: parseNum(raw.WindowHeight),
    glance: raw.Glance === "1",
    raw,
  };
}
