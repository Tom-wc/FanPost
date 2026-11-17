import { app, safeStorage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isSealed, osCodec } from "./secure-file";

const SEALED_FILES = ["license.json", "safety-rules.json", "wechat-mp.json"];
const DATA_LEFTOVERS = /^fanpost-data\.json\.(bak|tmp|corrupt-\d+)$/;

async function sealOne(file: string) {
  const raw = await fs.readFile(file, "utf8").catch(() => "");
  if (!raw || isSealed(raw)) return;
  await fs.writeFile(file + ".tmp", osCodec().seal(raw), "utf8");
  await fs.rename(file + ".tmp", file);
}


export async function sealPlainFiles() {
  if (!safeStorage.isEncryptionAvailable()) return;
  const dir = app.getPath("userData");
  for (const name of SEALED_FILES) await sealOne(path.join(dir, name));
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  for (const name of names.filter((n) => DATA_LEFTOVERS.test(n))) await sealOne(path.join(dir, name));
}
