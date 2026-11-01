import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { snapshotAppFiles, restoreAppFiles, validateAppNames } from "../src/tools/testing.js";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "garmin-state-tools-"));
try {
  const root = path.join(temporary, "APPS");
  await fs.mkdir(path.join(root, "DATA/OBJSTORE/TEST"), { recursive: true });
  await fs.writeFile(path.join(root, "DATA/TEST.DAT"), "original");
  await fs.writeFile(path.join(root, "DATA/OTHER.DAT"), "unrelated");
  const snapshot = path.join(temporary, "backup");
  const saved = await snapshotAppFiles(snapshot, ["TEST"], root);
  assert.equal(Object.keys(saved.files).length, 1);
  await assert.rejects(snapshotAppFiles(snapshot, ["TEST"], root));
  await fs.writeFile(path.join(root, "DATA/TEST.DAT"), "changed");
  await fs.writeFile(path.join(root, "DATA/OBJSTORE/TEST/new.cmp"), "new");
  await restoreAppFiles(snapshot, ["TEST"], root);
  assert.equal(await fs.readFile(path.join(root, "DATA/TEST.DAT"), "utf8"), "original");
  assert.equal(await fs.readFile(path.join(root, "DATA/OTHER.DAT"), "utf8"), "unrelated");
  await assert.rejects(fs.access(path.join(root, "DATA/OBJSTORE/TEST/new.cmp")));
  await assert.rejects(restoreAppFiles(snapshot, ["OTHER"], root));
  await fs.writeFile(path.join(snapshot, "files/DATA/TEST.DAT"), "tampered");
  await assert.rejects(restoreAppFiles(snapshot, ["TEST"], root));
  for (const invalid of [[], ["../TEST"], [""], ["test"], ["TEST.PRG"]]) assert.throws(() => validateAppNames(invalid));
  console.log("PASS snapshot/readback, restore, scoped cleanup, unrelated preservation, identity, checksum, overwrite and path safety");
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
