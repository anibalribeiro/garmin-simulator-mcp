import { readSimulatorIni } from "../config/sdk-locator.js";
import { triggerMenu } from "../simulator/bridge.js";
import {
  captureAndFormatScreenshot,
  getActiveDeviceId,
  type McpToolContent,
} from "./shared.js";

/**
 * Tool handler: trigger_menu_action
 */
export async function handleTriggerMenuAction(args: {
  menu_path: string[];
  capture_after?: boolean;
  wait_ms?: number;
}): Promise<{
  content: McpToolContent[];
  isError?: boolean;
}> {
  try {
    if (!args.menu_path || args.menu_path.length === 0) {
      throw new Error("menu_path must be a non-empty array of menu item titles.");
    }

    const res = await triggerMenu(args.menu_path);
    if (!res.ok) {
      throw new Error(res.error ?? `Menu item "${args.menu_path.join(" > ")}" could not be triggered.`);
    }

    const content: McpToolContent[] = [
      {
        type: "text",
        text: `Successfully triggered menu item: "${args.menu_path.join(" > ")}".`,
      },
    ];

    if (args.capture_after !== false) {
      await new Promise((r) => setTimeout(r, args.wait_ms ?? 400));
      const activeDeviceId = getActiveDeviceId();
      const screenshotResult = await captureAndFormatScreenshot({
        view: "screen",
        deviceId: activeDeviceId,
      });
      content.push(...screenshotResult.mcpContent);
    }

    return {
      content,
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to trigger menu item "${args.menu_path?.join(" > ")}": ${err?.message || err}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool handler: set_glance_mode
 */
export async function handleSetGlanceMode(args?: {
  enabled?: boolean;
  capture_after?: boolean;
  wait_ms?: number;
}): Promise<{
  content: McpToolContent[];
  isError?: boolean;
}> {
  try {
    let currentGlance: boolean | undefined;
    try {
      const ini = readSimulatorIni();
      currentGlance = ini.glance;
    } catch {
      // Ignore ini read error
    }

    if (args?.enabled !== undefined && currentGlance !== undefined) {
      if (args.enabled === currentGlance) {
        return {
          content: [
            {
              type: "text",
              text: `Glance mode is already ${args.enabled ? "enabled" : "disabled"}.`,
            },
          ],
        };
      }
    }

    const res = await triggerMenu(["Settings", "Glance View"]);
    if (!res.ok) {
      throw new Error(
        res.error ?? "Failed to toggle 'Settings > Glance View' in Connect IQ simulator."
      );
    }

    const content: McpToolContent[] = [
      {
        type: "text",
        text: `Toggled Glance View in Connect IQ simulator${args?.enabled !== undefined ? ` (target: ${args.enabled ? "enabled" : "disabled"})` : ""}.`,
      },
    ];

    if (args?.capture_after !== false) {
      await new Promise((r) => setTimeout(r, args?.wait_ms ?? 400));
      const activeDeviceId = getActiveDeviceId();
      const screenshotResult = await captureAndFormatScreenshot({
        view: "screen",
        deviceId: activeDeviceId,
      });
      content.push(...screenshotResult.mcpContent);
    }

    return {
      content,
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to set glance mode: ${err?.message || err}`,
        },
      ],
      isError: true,
    };
  }
}
