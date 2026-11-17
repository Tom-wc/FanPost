import { parseNotices, parsePromos, type Notice, type PromoItem } from "./promo.ts";

export const APP_LINK_KEYS = ["downloadUrl", "buyBasicUrl", "buyStudioUrl"] as const;
export type AppLinkKey = (typeof APP_LINK_KEYS)[number];

export interface RemoteAppInfo {
  latestVersion?: string;
  releaseNotes?: string;
  downloadUrl?: string;
  downloadCode?: string;
  buyBasicUrl?: string;
  buyStudioUrl?: string;
  promos?: PromoItem[];
  notices?: Notice[];
}

export interface AppInfoView extends RemoteAppInfo {
  version: string;
  hasUpdate: boolean;
}

const VERSION_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/;

export function compareVersions(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

const httpsUrl = (v: unknown) => {
  if (typeof v !== "string" || v.length > 300) return undefined;
  try {
    return new URL(v).protocol === "https:" ? v : undefined;
  } catch {
    return undefined;
  }
};

const text = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : undefined);

const jsonOf = (v: unknown) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
};

export function sanitizeAppInfo(raw: unknown): RemoteAppInfo {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const version = text(r.latestVersion, 12);
  const code = text(r.downloadCode, 12);
  return {
    latestVersion: version && VERSION_PATTERN.test(version) ? version : undefined,
    releaseNotes: text(r.releaseNotes, 500),
    downloadUrl: httpsUrl(r.downloadUrl),
    downloadCode: code && /^[A-Za-z0-9]+$/.test(code) ? code : undefined,
    buyBasicUrl: httpsUrl(r.buyBasicUrl),
    buyStudioUrl: httpsUrl(r.buyStudioUrl),
    ...(typeof r.promos === "string" || Array.isArray(r.promos) ? { promos: parsePromos(jsonOf(r.promos)) } : {}),
    notices: parseNotices(jsonOf(r.notices), Date.now()),
  };
}

export function appInfoView(version: string, remote: RemoteAppInfo): AppInfoView {
  return { ...remote, version, hasUpdate: !!remote.latestVersion && compareVersions(remote.latestVersion, version) > 0 };
}
