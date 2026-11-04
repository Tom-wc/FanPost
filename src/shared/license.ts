import type { Account, Platform } from "./types.ts";

export type LicenseTier = "none" | "basic" | "studio";

export const TIER_LIMITS: Record<LicenseTier, number> = { none: 0, basic: 1, studio: 10 };
export const TIER_LABELS: Record<LicenseTier, string> = { none: "未激活", basic: "基础版", studio: "工作室版" };
export const TIER_PRICES: Record<Exclude<LicenseTier, "none">, number> = { basic: 298, studio: 2888 };
export const YEAR_PRICES: Record<Exclude<LicenseTier, "none">, number> = { basic: 58, studio: 498 };

export type LicenseTerm = "forever" | "year" | "trial";
export const PERMANENT_YEAR = 9999;

export const isPermanent = (expiresAt: string | undefined) => !!expiresAt && new Date(expiresAt).getUTCFullYear() >= PERMANENT_YEAR;

export const REFRESH_INTERVAL_MS = 24 * 3600 * 1000;
export const OFFLINE_GRACE_MS = 7 * 24 * 3600 * 1000;

export interface LicensePayload {
  keyId: string;
  machine: string;
  tier: Exclude<LicenseTier, "none">;
  term: LicenseTerm;
  expiresAt: string;
  issuedAt: string;
}

export interface LicenseState {
  tier: LicenseTier;
  limit: number;
  keyId?: string;
  term?: LicenseTerm;
  expiresAt?: string;
  issuedAt?: string;
  reason?: "none" | "expired" | "machine" | "stale" | "invalid";
}

const isTier = (v: unknown): v is Exclude<LicenseTier, "none"> => v === "basic" || v === "studio";
const isTerm = (v: unknown): v is LicenseTerm => v === "forever" || v === "year" || v === "trial";

export function parsePayload(text: string): LicensePayload | undefined {
  try {
    const p = JSON.parse(text) as Record<string, unknown>;
    if (typeof p.keyId !== "string" || typeof p.machine !== "string" || !isTier(p.tier)) return undefined;
    if (typeof p.expiresAt !== "string" || typeof p.issuedAt !== "string") return undefined;
    if (Number.isNaN(Date.parse(p.expiresAt)) || Number.isNaN(Date.parse(p.issuedAt))) return undefined;
    const term = isTerm(p.term) ? p.term : isPermanent(p.expiresAt) ? "forever" : "trial";
    return { keyId: p.keyId, machine: p.machine, tier: p.tier, term, expiresAt: p.expiresAt, issuedAt: p.issuedAt };
  } catch {
    return undefined;
  }
}

export const NO_LICENSE: LicenseState = { tier: "none", limit: TIER_LIMITS.none, reason: "none" };

export function evaluateLicense(payload: LicensePayload | undefined, machine: string, now: number): LicenseState {
  if (!payload) return NO_LICENSE;
  const base = { keyId: payload.keyId, term: payload.term, expiresAt: payload.expiresAt, issuedAt: payload.issuedAt };
  if (payload.machine !== machine) return { ...NO_LICENSE, ...base, reason: "machine" };
  if (Date.parse(payload.expiresAt) <= now) return { ...NO_LICENSE, ...base, reason: "expired" };
  if (now - Date.parse(payload.issuedAt) > OFFLINE_GRACE_MS) return { ...NO_LICENSE, ...base, reason: "stale" };
  return { tier: payload.tier, limit: TIER_LIMITS[payload.tier], ...base };
}

export interface QuotaOverflow {
  platform: Platform;
  count: number;
  limit: number;
}

export function quotaOverflow(accounts: Pick<Account, "platform">[], limit: number): QuotaOverflow[] {
  const counts = new Map<Platform, number>();
  for (const a of accounts) counts.set(a.platform, (counts.get(a.platform) || 0) + 1);
  return [...counts].filter(([, n]) => n > limit).map(([platform, count]) => ({ platform, count, limit }));
}

export function canAddAccount(accounts: Pick<Account, "platform">[], platform: Platform, limit: number) {
  return accounts.filter((a) => a.platform === platform).length < limit;
}

export function needsRefresh(state: LicenseState, now: number) {
  if (!state.keyId || !state.issuedAt) return false;
  if (state.reason === "stale" || state.reason === "expired") return true;
  return now - Date.parse(state.issuedAt) >= REFRESH_INTERVAL_MS;
}

export function formatMachine(hex: string) {
  return hex.slice(0, 16).toUpperCase().match(/.{4}/g)!.join("-");
}

export interface LicenseView extends LicenseState {
  machine: string;
  over: QuotaOverflow[];
}

export const CARD_KEY_PATTERN = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/;
export const QUOTA_ERROR = "QUOTA:";

export function normalizeCardKey(input: string) {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return raw.length === 16 ? raw.match(/.{4}/g)!.join("-") : "";
}
