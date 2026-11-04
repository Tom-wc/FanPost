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
