import test from "node:test";
import assert from "node:assert/strict";
import { healthNotice, type MpHealthView } from "./mp-health.ts";

const view = (state: MpHealthView["state"]): MpHealthView => ({ state, appId: "wx1", checkedAt: "2026-11-04T00:00:00Z", message: "AppSecret 不对（40001）" });

test("接口失效只在第一次发现时提醒，恢复后再提醒一次", () => {
  assert.equal(healthNotice(undefined, view("failed"))?.level, "error");
  assert.match(healthNotice("ok", view("failed"))!.message, /40001/);
  assert.equal(healthNotice("failed", view("failed")), undefined);
  assert.equal(healthNotice("failed", view("ok"))?.level, "success");
  assert.equal(healthNotice(undefined, view("ok")), undefined);
  assert.equal(healthNotice("ok", view("ok")), undefined);
});

test("网络不通和没设置都不算失效，不提醒", () => {
  assert.equal(healthNotice("ok", view("offline")), undefined);
  assert.equal(healthNotice(undefined, view("unset")), undefined);
});
