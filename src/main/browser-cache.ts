import { app, session } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeBrowserLog } from "./log-bus";

const CACHE_DIRS = ["Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache"];

async function dirBytes(dir: string): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirBytes(p);
    else total += await fs.stat(p).then((s) => s.size).catch(() => 0);
  }
  return total;
}

function profileRoots(accountIds: string[]) {
  const root = app.getPath("userData");
  return [root, ...accountIds.map((id) => path.join(root, "Partitions", "account-" + id))];
}

export async function browserCacheBytes(accountIds: string[]) {
  let total = 0;
  for (const base of profileRoots(accountIds)) for (const d of CACHE_DIRS) total += await dirBytes(path.join(base, d));
  return total;
}

export async function clearBrowserCache(accountIds: string[]) {
  const before = await browserCacheBytes(accountIds);
  const sessions = [session.defaultSession, ...accountIds.map((id) => session.fromPartition("persist:account-" + id))];
  for (const s of sessions) {
    await s.clearCache().catch((e) => writeBrowserLog("cache-clear-failed err=" + String(e)));
    await s.clearCodeCaches({}).catch(() => undefined);
  }
  const after = await browserCacheBytes(accountIds);
  await writeBrowserLog("cache-cleared before=" + before + " after=" + after);
  return { before, after };
}
