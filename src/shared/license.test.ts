import test from "node:test";
import assert from "node:assert/strict";
import { OFFLINE_GRACE_MS, REFRESH_INTERVAL_MS, canAddAccount, evaluateLicense, formatMachine, isPermanent, needsRefresh, normalizeCardKey, parsePayload, quotaOverflow, type LicensePayload } from "./license.ts";

const NOW = Date.parse("2026-10-30T00:00:00Z");
const day = 24 * 3600 * 1000;
const lic = (over: Partial<LicensePayload> = {}): LicensePayload => ({
  keyId: "K1",
  machine: "M1",
  tier: "basic",
  term: "year",
  expiresAt: new Date(NOW + 300 * day).toISOString(),
  issuedAt: new Date(NOW - day / 2).toISOString(),
  ...over,
});

test("no license means no accounts can be used", () => {
  assert.deepEqual(evaluateLicense(undefined, "M1", NOW), { tier: "none", limit: 0, reason: "none" });
});

test("valid license on the bound machine grants its tier", () => {
  const s = evaluateLicense(lic(), "M1", NOW);
  assert.equal(s.tier, "basic");
  assert.equal(s.limit, 1);
  assert.equal(s.reason, undefined);
  assert.equal(evaluateLicense(lic({ tier: "studio" }), "M1", NOW).limit, 10);
});

test("license copied to another machine is locked", () => {
  const s = evaluateLicense(lic(), "OTHER", NOW);
  assert.equal(s.tier, "none");
  assert.equal(s.reason, "machine");
});

test("expired license is locked", () => {
  const s = evaluateLicense(lic({ expiresAt: new Date(NOW - 1).toISOString() }), "M1", NOW);
  assert.equal(s.tier, "none");
  assert.equal(s.reason, "expired");
});

test("offline longer than the grace period is locked until refreshed", () => {
  const fresh = evaluateLicense(lic({ issuedAt: new Date(NOW - OFFLINE_GRACE_MS + day).toISOString() }), "M1", NOW);
  assert.equal(fresh.tier, "basic");
  const stale = evaluateLicense(lic({ issuedAt: new Date(NOW - OFFLINE_GRACE_MS - 1).toISOString() }), "M1", NOW);
  assert.equal(stale.tier, "none");
  assert.equal(stale.reason, "stale");
});

test("refresh is due after 24 hours, or right away when stale or expired", () => {
  assert.equal(needsRefresh(evaluateLicense(undefined, "M1", NOW), NOW), false);
  assert.equal(needsRefresh(evaluateLicense(lic(), "M1", NOW), NOW), false);
  assert.equal(needsRefresh(evaluateLicense(lic({ issuedAt: new Date(NOW - REFRESH_INTERVAL_MS).toISOString() }), "M1", NOW), NOW), true);
  assert.equal(needsRefresh(evaluateLicense(lic({ expiresAt: new Date(NOW - 1).toISOString() }), "M1", NOW), NOW), true);
});

test("payload parsing rejects malformed or unknown-tier licenses", () => {
  assert.deepEqual(parsePayload(JSON.stringify(lic())), lic());
  assert.equal(parsePayload("not json"), undefined);
  assert.equal(parsePayload(JSON.stringify({ ...lic(), tier: "matrix" })), undefined);
  assert.equal(parsePayload(JSON.stringify({ ...lic(), expiresAt: "soon" })), undefined);
});

test("quota overflow lists every platform over the limit", () => {
  const accounts = [{ platform: "douyin" }, { platform: "douyin" }, { platform: "zhihu" }] as const;
  assert.deepEqual(quotaOverflow([...accounts], 1), [{ platform: "douyin", count: 2, limit: 1 }]);
  assert.deepEqual(quotaOverflow([...accounts], 3), []);
});

test("adding an account is refused once the platform is at its limit", () => {
  const accounts = [{ platform: "douyin" }] as const;
  assert.equal(canAddAccount([...accounts], "douyin", 1), false);
  assert.equal(canAddAccount([...accounts], "zhihu", 1), true);
  assert.equal(canAddAccount([...accounts], "douyin", 3), true);
});

test("without activation every account is over quota and none can be added", () => {
  assert.deepEqual(quotaOverflow([{ platform: "douyin" }], 0), [{ platform: "douyin", count: 1, limit: 0 }]);
  assert.equal(canAddAccount([], "douyin", 0), false);
});

test("buyout licenses never expire", () => {
  const p = lic({ expiresAt: "9999-12-31T00:00:00.000Z" });
  assert.equal(isPermanent(p.expiresAt), true);
  assert.equal(isPermanent(lic().expiresAt), false);
  assert.equal(evaluateLicense(p, "M1", Date.parse("2090-01-01T00:00:00Z")).reason, "stale");
  assert.equal(evaluateLicense({ ...p, issuedAt: "2090-01-01T00:00:00Z" }, "M1", Date.parse("2090-01-02T00:00:00Z")).tier, "basic");
});

test("license term comes from the server, older payloads fall back by expiry", () => {
  const { term, ...old } = lic();
  assert.equal(term, "year");
  assert.equal(parsePayload(JSON.stringify(lic()))?.term, "year");
  assert.equal(parsePayload(JSON.stringify(old))?.term, "trial");
  assert.equal(parsePayload(JSON.stringify({ ...old, expiresAt: "9999-12-31T00:00:00.000Z" }))?.term, "forever");
  assert.equal(parsePayload(JSON.stringify({ ...lic(), term: "month" }))?.term, "trial");
  assert.equal(evaluateLicense(lic(), "M1", NOW).term, "year");
});

test("machine code and card keys are normalized for display and input", () => {
  assert.equal(formatMachine("a1b2c3d4e5f6a7b8c9d0"), "A1B2-C3D4-E5F6-A7B8");
  assert.equal(normalizeCardKey(" ab12-cd34 ef56gh78 "), "AB12-CD34-EF56-GH78");
  assert.equal(normalizeCardKey("short"), "");
});
