import path from "node:path";
import { locateGarminSdk } from "../config/sdk-locator.js";
import {
  listInstalledDevices,
  parseDeviceProfile,
} from "../metadata/device-parser.js";
import { getWindowInfo } from "../simulator/bridge.js";
import { processManager } from "../simulator/process-manager.js";
import {
  captureAndFormatScreenshot,
  getActiveDeviceId,
  resolveActiveDeviceProfile,
  setManualActiveDeviceId,
  type McpToolContent,
} from "./shared.js";
import type { DeviceProfile } from "../types.js";

export interface SimulatorStatusResult {
  running: boolean;
  port1234Open: boolean;
  windowId?: number;
  bounds?: { x: number; y: number; width: number; height: number };
  permissions: {
    screenRecording: boolean;
    accessibility: boolean;
  };
  activeDeviceId: string;
  device?: {
    displayName: string;
    resolution: { width: number; height: number };
    isTouch: boolean;
    shape: string;
    buttons: Array<{
      id: string;
      behavior?: string;
      isHold: boolean;
      aliases: string[];
    }>;
  };
}

/**
 * Checks the status of the Connect IQ simulator process, window, network port,
 * permissions, and active device profile.
 */
export async function getSimulatorStatus(): Promise<SimulatorStatusResult> {
  const windowInfo = await getWindowInfo();
  const port1234Open = await processManager.isSimulatorPortOpen(1234);
  const activeDeviceId = getActiveDeviceId();

  let profile: DeviceProfile | undefined;
  try {
    profile = resolveActiveDeviceProfile(activeDeviceId);
  } catch {
    // Device profile might not be parsed if SDK root not yet available
  }

  const result: SimulatorStatusResult = {
    running: windowInfo.running,
    port1234Open,
    windowId: windowInfo.windowId,
    bounds: windowInfo.bounds,
    permissions: windowInfo.permissions,
    activeDeviceId,
  };

  if (profile) {
    result.device = {
      displayName: profile.displayName,
      resolution: {
        width: profile.display.location.width,
        height: profile.display.location.height,
      },
      isTouch: profile.display.isTouch,
      shape: profile.display.shape,
      buttons: profile.keys.map((k) => ({
        id: k.id,
        behavior: k.behavior,
        isHold: k.isHold,
        aliases: k.aliases,
      })),
    };
  }

  return result;
}

/**
 * Tool handler: simulator_status
 */
export async function handleSimulatorStatus(): Promise<{
  content: McpToolContent[];
  isError?: boolean;
}> {
  try {
    const status = await getSimulatorStatus();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(status, null, 2),
        },
      ],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error checking simulator status: ${err?.message || err}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool handler: launch_simulator
 */
export async function handleLaunchSimulator(args?: {
  wait_ms?: number;
}): Promise<{
  content: McpToolContent[];
  isError?: boolean;
}> {
  try {
    const sdkPaths = locateGarminSdk();
    const result = await processManager.launchSimulatorApp(
      sdkPaths,
      args?.wait_ms ?? 15000
    );

    const activeDeviceId = getActiveDeviceId();
    const status = await getSimulatorStatus();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: result.started && result.portOpen,
              started: result.started,
              port1234Open: result.portOpen,
              activeDeviceId,
              window: status.bounds,
              permissions: status.permissions,
            },
            null,
            2
          ),
        },
      ],
      isError: !result.started || !result.portOpen,
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to launch Connect IQ simulator: ${err?.message || err}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool handler: list_devices
 */
export async function handleListDevices(args?: {
  query?: string;
  touch_only?: boolean;
}): Promise<{
  content: McpToolContent[];
  isError?: boolean;
}> {
  try {
    const devices = listInstalledDevices({
      query: args?.query,
      touchOnly: args?.touch_only,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              total: devices.length,
              devices,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to list installed devices: ${err?.message || err}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool handler: set_active_device
 */
export async function handleSetActiveDevice(args: {
  device_id: string;
}): Promise<{
  content: McpToolContent[];
  isError?: boolean;
}> {
  try {
    const profile = parseDeviceProfile(args.device_id);
    setManualActiveDeviceId(profile.deviceId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              activeDeviceId: profile.deviceId,
              displayName: profile.displayName,
              resolution: {
                width: profile.display.location.width,
                height: profile.display.location.height,
              },
              isTouch: profile.display.isTouch,
              shape: profile.display.shape,
              buttons: profile.keys.map((k) => ({
                id: k.id,
                behavior: k.behavior,
                isHold: k.isHold,
                aliases: k.aliases,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to set active device to "${args.device_id}": ${err?.message || err}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool handler: build_app
 */
export async function handleBuildApp(args: {
  project_dir: string;
  device_id?: string;
  jungle_file?: string;
  developer_key_path?: string;
  output_prg_path?: string;
  extra_args?: string[];
}): Promise<{
  content: McpToolContent[];
  isError?: boolean;
}> {
  try {
    const sdkPaths = locateGarminSdk();
    const deviceId = getActiveDeviceId(args.device_id);
    const resolvedProjectDir = path.resolve(args.project_dir);

    const result = await processManager.buildMonkeyCProject(sdkPaths, {
      projectDir: resolvedProjectDir,
      deviceId,
      jungleFile: args.jungle_file
        ? path.resolve(args.jungle_file)
        : undefined,
      developerKeyPath: args.developer_key_path
        ? path.resolve(args.developer_key_path)
        : undefined,
      outputPrgPath: args.output_prg_path
        ? path.resolve(args.output_prg_path)
        : undefined,
      extraArgs: args.extra_args,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: result.success,
              exitCode: result.exitCode,
              deviceId,
              outputPrgPath: result.outputPrgPath,
              stdout: result.stdout,
              stderr: result.stderr,
            },
            null,
            2
          ),
        },
      ],
      isError: !result.success,
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Build failed with error: ${err?.message || err}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool handler: run_app
 */
export async function handleRunApp(args: {
  prg_path: string;
  device_id?: string;
  wait_ms?: number;
  capture_after?: boolean;
}): Promise<{
  content: McpToolContent[];
  isError?: boolean;
}> {
  try {
    const sdkPaths = locateGarminSdk();
    const deviceId = getActiveDeviceId(args.device_id);
    const resolvedPrgPath = path.resolve(args.prg_path);

    const result = await processManager.runAppInSimulator(sdkPaths, {
      prgPath: resolvedPrgPath,
      deviceId,
      waitMs: args.wait_ms ?? 2500,
    });

    const content: McpToolContent[] = [
      {
        type: "text",
        text: JSON.stringify(
          {
            launched: result.launched,
            startupConfirmed: result.startupConfirmed ?? false,
            fatalError: result.fatalError,
            deviceId: result.activeDeviceId,
            initialLogs: result.initialLogs,
          },
          null,
          2
        ),
      },
    ];

    if (result.launched && args.capture_after !== false) {
      try {
        // Allow simulator a brief moment to render first frame
        await new Promise((r) => setTimeout(r, 400));
        const screenshotResult = await captureAndFormatScreenshot({
          view: "screen",
          deviceId,
        });
        content.push(...screenshotResult.mcpContent);
      } catch (screenshotErr: any) {
        content.push({
          type: "text",
          text: `Note: App launched, but could not capture initial screenshot: ${screenshotErr?.message || screenshotErr}`,
        });
      }
    }

    return {
      content,
      isError: !result.launched,
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to run app in simulator: ${err?.message || err}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool handler: stop_app
 */
export async function handleStopApp(): Promise<{
  content: McpToolContent[];
  isError?: boolean;
}> {
  try {
    const result = await processManager.stopActiveApp();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to stop app: ${err?.message || err}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool handler: run_unit_tests
 */
export async function handleRunUnitTests(args: {
  prg_path: string;
  device_id?: string;
  test_name?: string;
  timeout_ms?: number;
}): Promise<{
  content: McpToolContent[];
  isError?: boolean;
}> {
  try {
    const sdkPaths = locateGarminSdk();
    const deviceId = getActiveDeviceId(args.device_id);
    const resolvedPrgPath = path.resolve(args.prg_path);

    const result = await processManager.runUnitTests(sdkPaths, {
      prgPath: resolvedPrgPath,
      deviceId,
      testName: args.test_name,
      timeoutMs: args.timeout_ms ?? 30000,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              passed: result.passed,
              exitCode: result.exitCode,
              deviceId,
              output: result.output,
              summary: result.summary,
              signal: result.signal,
              timedOut: result.timedOut ?? false,
              exitCodeWarning: result.exitCodeWarning,
            },
            null,
            2
          ),
        },
      ],
      isError: !result.passed,
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to execute unit tests: ${err?.message || err}`,
        },
      ],
      isError: true,
    };
  }
}
