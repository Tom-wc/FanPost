import test from "node:test";
import assert from "node:assert/strict";
import { appInfoView, compareVersions, sanitizeAppInfo } from "./app-info.ts";

test("compareVersions compares each part as a number", () => {
  assert.equal(compareVersions("1.0.10", "1.0.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("0.9.9", "1.0.0"), -1);
});

test("only a newer server version counts as an update", () => {
  assert.equal(appInfoView("1.0.0", { latestVersion: "1.0.1" }).hasUpdate, true);
  assert.equal(appInfoView("1.0.1", { latestVersion: "1.0.1" }).hasUpdate, false);
  assert.equal(appInfoView("1.0.2", { latestVersion: "1.0.1" }).hasUpdate, false);
  assert.equal(appInfoView("1.0.0", {}).hasUpdate, false);
});

test("sanitizeAppInfo drops non-https links and malformed fields", () => {
  const out = sanitizeAppInfo({
    latestVersion: "v2",
    downloadUrl: "javascript:alert(1)",
    buyBasicUrl: "http://example.com",
    buyStudioUrl: "https://example.com/s",
    downloadCode: "ab cd",
    releaseNotes: 42,
  });
  assert.deepEqual(out, { latestVersion: undefined, releaseNotes: undefined, downloadUrl: undefined, downloadCode: undefined, buyBasicUrl: undefined, buyStudioUrl: "https://example.com/s", notices: [] });
  assert.deepEqual(sanitizeAppInfo(null).latestVersion, undefined);
});

test("推广位和公告：服务器下发的 JSON 字符串校验后才显示，过期公告不显示", () => {
  const promos = JSON.stringify([{ id: "a", slot: "home", title: "推广", url: "https://x.cn", ad: true }, { id: "b", slot: "home", title: "坏链接", url: "http://x.cn" }, { id: "c", slot: "top", title: "坏位置", url: "https://x.cn" }]);
  const notices = JSON.stringify([{ id: "n1", title: "维护通知", body: "今晚维护", level: "warning" }, { id: "n2", title: "已过期", body: "", until: "2020-01-01" }]);
  const out = sanitizeAppInfo({ promos, notices });
  assert.deepEqual(out.promos, [{ id: "a", slot: "home", title: "推广", url: "https://x.cn", ad: true }]);
  assert.deepEqual(out.notices?.map((n) => n.id), ["n1"]);
  assert.equal(out.notices?.[0].level, "warning");
  assert.equal(sanitizeAppInfo({}).promos, undefined);
  assert.deepEqual(sanitizeAppInfo({ promos: "[]" }).promos, []);
});
