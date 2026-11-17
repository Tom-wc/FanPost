import { app } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { AppData } from "../shared/types";
import { expiredDraftIds, referencedFiles, withoutDrafts } from "../shared/history";
import { writeBrowserLog } from "./log-bus";

const OWNED_DIRS = ["covers", "task-artifacts"];

function isOwnedFile(file: string) {
  const root = app.getPath("userData");
  const resolved = path.resolve(file);
  return OWNED_DIRS.some((dir) => {
    const base = path.join(root, dir) + path.sep;
    return resolved.toLowerCase().startsWith(base.toLowerCase());
  });
}

export function planRemoval(data: AppData, draftIds: string[]) {
  const next = withoutDrafts(data, draftIds);
  const removed = { drafts: data.drafts.filter((d) => draftIds.includes(d.id)), tasks: data.tasks.filter((t) => draftIds.includes(t.draftId)) };
  const kept = referencedFiles(next);
  const files = [...referencedFiles(removed)].filter((f) => !kept.has(f) && isOwnedFile(f));
  return { next, files };
}

export async function removeFiles(files: string[]) {
  for (const file of files)
    await fs.rm(file, { force: true }).catch((error) => writeBrowserLog(`history-file-rm-failed ${file} error=${String(error)}`));
}

export const expiredFor = (data: AppData, now: number, keepIds: string[]) =>
  expiredDraftIds(data, data.settings.historyRetention, now, keepIds);

const HOT_FILE = /^hot-[0-9a-f]{8}(-\d+)?\.(jpg|mp4)$/i;
const ORPHAN_GRACE_MS = 24 * 3600 * 1000;

export async function sweepOrphanHotFiles(data: AppData, now = Date.now()) {
  const dir = path.join(app.getPath("userData"), "covers");
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const kept = new Set([...referencedFiles(data)].map((f) => path.resolve(f).toLowerCase()));
  let removed = 0;
  for (const name of names) {
    if (!HOT_FILE.test(name)) continue;
    const full = path.join(dir, name);
    if (kept.has(path.resolve(full).toLowerCase())) continue;
    const stat = await fs.stat(full).catch(() => undefined);
    if (!stat || now - stat.mtimeMs < ORPHAN_GRACE_MS) continue;
    await fs.rm(full, { force: true }).then(() => removed++).catch(() => undefined);
  }
  if (removed) await writeBrowserLog("hot-orphans-swept n=" + removed);
  return removed;
}
