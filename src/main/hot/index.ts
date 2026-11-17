import { ipcMain } from "electron";
import type { Account } from "../../shared/types";
import type { BrowserManager } from "../browser-manager";
import type { SafetyRules } from "../../shared/safety";
import { closedFeature } from "../closed";

export interface HotDeps {
  getAccounts: () => Account[];
  browsers: () => BrowserManager | undefined;
  assertFeature: () => void;
  rules: () => SafetyRules | undefined;
}

const CHANNELS = ["hot:list", "hot:profiles", "hot:save-profile", "hot:learn", "hot:suggest", "hot:comment-topics", "hot:record", "hot:video", "hot:cards", "hot:generate"];

export function registerHot(_deps: HotDeps) {
  for (const channel of CHANNELS) ipcMain.handle(channel, () => closedFeature());
}
