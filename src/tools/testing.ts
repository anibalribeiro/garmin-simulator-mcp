import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runBridgeCommand } from "../simulator/bridge.js";
import type { McpToolContent } from "./shared.js";

export async function testingResult(action: () => Promise<unknown>): Promise<{ content: McpToolContent[]; isError?: boolean }> {
  try {
    const result = await action();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      ...((result as { ok?: boolean })?.ok === false ? { isError: true } : {}) };
  } catch (error) {
    return { content: [{ type: "text", text: String(error) }], isError: true };
  }
}

export const inspectUI = (depth: number) => runBridgeCommand(["ui-tree", String(depth)]);
export const actOnUI = (route: number[], action: string, value?: string) =>
  runBridgeCommand(["ui-action", route.join("."), action, ...(value === undefined ? [] : [value])]);

const storageRoot = () => path.join(process.platform === "darwin"
  ? execFileSync("getconf", ["DARWIN_USER_TEMP_DIR"], { encoding: "utf8" }).trim() : os.tmpdir(),
  "com.garmin.connectiq/GARMIN/APPS");
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const RESERVED = new Set(["DATA", "SETTINGS", "MEDIA", "OBJSTORE", "LOGS", "TEMP", "MAIL", "AUXFILE", "NEWFILES", "DEBUG"]);
export function validateAppNames(names: string[]): string[] {
  if (names.length < 1 || names.length > 8 || names.some((s) => !/^[A-Z0-9_-]{1,64}$/.test(s))) {
    throw new Error("Use 1..8 uppercase PRG basenames without extensions/path separators.");
  }
  if (names.some((s) => RESERVED.has(s))) {
    throw new Error("App names must not be simulator container directories.");
  }
  return [...new Set(names)].sort();
}
// Only the simulator's documented per-app locations are in scope. Matching any path
// segment would let a name like "OBJSTORE" or "OTHER" select unrelated apps' files.
export function appFilePatterns(name: string): RegExp[] {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(`^DATA/${n}\\.(DAT|IDX|IMT)$`),
    new RegExp(`^SETTINGS/${n}\\.SET$`),
    new RegExp(`^MEDIA/${n}\\.PRG$`),
    new RegExp(`^DATA/MEDIA/OBJSTORE/${n}/`),
    new RegExp(`^DATA/OBJSTORE/${n}/`),
  ];
}
async function selectedFiles(root: string, names: string[]): Promise<string[]> {
  const patterns = names.flatMap(appFilePatterns);
  const files: string[] = [];
  const visit = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Refusing symbolic links in simulator storage.");
      const filename = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else {
        const relative = path.relative(root, filename).split(path.sep).join("/");
        if (patterns.some((pattern) => pattern.test(relative))) files.push(relative);
      }
    }
  };
  await visit(root);
  return files.sort();
}
export async function snapshotAppFiles(directory: string, appNames: string[], root = storageRoot()) {
  const names = validateAppNames(appNames);
  const target = path.resolve(directory);
  const storageRootPath = path.resolve(root);
  if (target === storageRootPath || target.startsWith(storageRootPath + path.sep)) throw new Error("Snapshot must be outside simulator storage.");
  await fs.mkdir(target, { recursive: false }); // Never overwrite a previous snapshot.
  const files = await selectedFiles(root, names);
  const manifest: Record<string, { sha256: string; bytes: number }> = {};
  for (const relative of files) {
    const data = await fs.readFile(path.join(root, relative));
    const dest = path.join(target, "files", relative);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data, { flag: "wx" });
    manifest[relative] = { sha256: digest(data), bytes: data.length };
  }
  const result = { version: 1, root: path.resolve(root), appNames: names, files: manifest };
  await fs.writeFile(path.join(target, "manifest.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  return { ok: true, snapshot: target, ...result };
}

export async function restoreAppFiles(directory: string, appNames: string[], root = storageRoot()) {
  const names = validateAppNames(appNames);
  const source = path.resolve(directory);
  const manifest = JSON.parse(await fs.readFile(path.join(source, "manifest.json"), "utf8"));
  if (manifest.version !== 1 || manifest.root !== path.resolve(root) ||
      JSON.stringify(names) !== JSON.stringify(manifest.appNames)) throw new Error("Snapshot identity mismatch.");
  // Validate all backup contents before modifying any current file.
  const backups = new Map<string, Buffer>();
  for (const [relative, info] of Object.entries(manifest.files) as Array<[string, { sha256: string }]>) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..") ||
        !names.flatMap(appFilePatterns).some((pattern) => pattern.test(relative))) throw new Error("Invalid snapshot path.");
    const backupFile = path.join(source, "files", relative);
    // lstat every segment: an intermediate directory could itself be a symlink.
    let current = path.join(source, "files");
    for (const segment of relative.split("/")) {
      current = path.join(current, segment);
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("Snapshot contains a symbolic link.");
    }
    const data = await fs.readFile(backupFile);
    if (digest(data) !== info.sha256) throw new Error("Snapshot checksum mismatch.");
    backups.set(relative, data);
  }
  for (const relative of await selectedFiles(root, names)) {
    if (!backups.has(relative)) await fs.unlink(path.join(root, relative));
  }
  for (const [relative, data] of backups) {
    const filename = path.join(root, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, data);
    if (digest(await fs.readFile(filename)) !== manifest.files[relative].sha256) throw new Error("Restoration readback failed.");
  }
  return { ok: true, restored: backups.size, removedNewFiles: true, appNames: names };
}
