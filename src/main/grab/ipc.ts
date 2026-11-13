import { ipcMain, type BrowserWindow } from "electron";
import type { AppData } from "../../shared/types";
import type { SafetyRules } from "../../shared/safety";
import type { MpHealthView } from "../../shared/mp-health";
import type { LicenseFeature } from "../../shared/license";
import { closedFeature } from "../closed";

interface Deps {
  win: () => BrowserWindow | null;
  getData: () => AppData;
  update: (fn: (d: AppData) => void) => Promise<AppData>;
  rules: () => SafetyRules | undefined;
  assertLicensed: () => void;
  assertFeature: (feature: LicenseFeature) => void;
  onHealth: (h: MpHealthView) => void;
}

const CHANNELS = ["grab:url", "note:template", "note:import", "grab:album", "grab:batch", "grab:doc", "mp:save", "mp:clear", "mp:store", "mp:remove", "mp:import", "mp:draft", "mp:copy"];

export function registerGrabIpc(_deps: Deps) {
  for (const channel of CHANNELS) ipcMain.handle(channel, () => closedFeature());
  ipcMain.handle("mp:get", () => ({ appId: "", health: null }));
  ipcMain.handle("mp:health", () => ({ state: "unset", appId: "", checkedAt: new Date().toISOString(), message: "开源版不含公众号功能" }));
}
