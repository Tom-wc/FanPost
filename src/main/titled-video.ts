import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeBrowserLog } from "./log-bus";

const DIR_NAME = "titled-videos";
const STALE_MS = 24 * 3600 * 1000;
const NAME_MAX = 60;

export function titleFileName(title: string) {
  const clean = Array.from(title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim()).slice(0, NAME_MAX).join("").replace(/[. ]+$/, "");
  return clean || "video";
}

async function pruneStale(dir: string) {
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const now = Date.now();
  for (const name of entries) {
    const p = path.join(dir, name);
    const stat = await fs.stat(p).catch(() => undefined);
    if (stat && now - stat.mtimeMs > STALE_MS) await fs.rm(p, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function titledVideo(source: string, title: string, taskId: string): Promise<string> {
  const root = path.join(app.getPath("userData"), DIR_NAME);
  await fs.mkdir(root, { recursive: true });
  await pruneStale(root);
  const dir = path.join(root, taskId);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, titleFileName(title) + path.extname(source));
  await fs.rm(target, { force: true }).catch(() => undefined);
  try {
    await fs.link(source, target);
  } catch {
    await fs.copyFile(source, target);
  }
  await writeBrowserLog("titled-video " + JSON.stringify({ source, target }));
  return target;
}
