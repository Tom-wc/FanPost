import { NO_LICENSE, type LicenseState } from "../shared/license";
import type { RemoteAppInfo } from "../shared/app-info";
import type { SafetyRules } from "../shared/safety";
import { closedFeature } from "./closed";

export class LicenseManager {
  async init(): Promise<void> {}

  machineCode(): string {
    return "";
  }

  current(): LicenseState {
    return NO_LICENSE;
  }

  safetyRules(): SafetyRules | undefined {
    return undefined;
  }

  rulesInfo() {
    return { ok: false, version: "", issuedAt: "", pack: "" };
  }

  async refreshRules(_force = false) {
    return this.rulesInfo();
  }

  async appInfo(_force = false): Promise<RemoteAppInfo> {
    return {};
  }

  async activate(_input: string): Promise<LicenseState> {
    return closedFeature();
  }

  async refresh(_force = false): Promise<LicenseState> {
    return NO_LICENSE;
  }

  async unbind(): Promise<LicenseState> {
    return closedFeature();
  }
}
