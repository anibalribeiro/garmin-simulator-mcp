import { processManager } from "../simulator/process-manager.js";
import {
  captureAndFormatScreenshot,
  type McpToolContent,
} from "./shared.js";
import type { ScreenshotViewMode } from "../types.js";

/**
 * Tool handler: get_screenshot
 */
export async function handleGetScreenshot(args?: {
  view?: ScreenshotViewMode;
  device_id?: string;
  save_path?: string;
}): Promise<{
  content: McpToolContent[];
  isError?: boolean;
}> {
  try {
    const result = await captureAndFormatScreenshot({
      view: args?.view ?? "screen",
      deviceId: args?.device_id,
      savePath: args?.save_path,
    });

    return {
      content: result.mcpContent,
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to capture screenshot: ${err?.message || err}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool handler: get_app_logs
 */
export async function handleGetAppLogs(args?: {
  lines?: number;
  clear?: boolean;
}): Promise<{
  content: McpToolContent[];
  isError?: boolean;
}> {
  try {
    const logs = processManager.getLogs({
      lines: args?.lines,
      clear: args?.clear,
    });

    const body =
      logs.length === 0
        ? "No simulator or app logs recorded."
        : logs.join("\n");

    return {
      content: [
        {
          type: "text",
          text: `Simulator & App Logs (${logs.length} line${logs.length === 1 ? "" : "s"}):\n\n${body}`,
        },
      ],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to retrieve logs: ${err?.message || err}`,
        },
      ],
      isError: true,
    };
  }
}
