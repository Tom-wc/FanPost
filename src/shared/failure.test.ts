import assert from "node:assert/strict";
import test from "node:test";
import { classifyFailure, isRetryable } from "./failure.ts";

test("失败原因归到具体类别", () => {
  assert.equal(classifyFailure(["抖音登录已失效，请在账号管理重新扫码登录"]).bucket, "login");
  assert.equal(classifyFailure(["自动发布未完成：需要拖动滑块完成安全验证"]).bucket, "captcha");
  assert.equal(classifyFailure(["超过 12 分钟没完成（停在：正在上传视频）"]).bucket, "timeout");
  assert.equal(classifyFailure(["页面已打开，但未定位到编辑器"]).bucket, "not_found");
  assert.equal(classifyFailure(["已自动点击发布，平台后台暂未查到"]).bucket, "unconfirmed");
  assert.equal(classifyFailure(["QUOTA:当前是基础版，每个平台最多 1 个账号"]).bucket, "quota");
  assert.equal(classifyFailure(["net::ERR_CONNECTION_RESET"]).bucket, "network");
  assert.equal(classifyFailure(["小红书图文需要至少一张图片，当前草稿无图片。"]).bucket, "input");
  assert.equal(classifyFailure(["自动发布任务异常：unknown"]).bucket, "other");
});

test("每条只自动重试一次，放弃的不再重试", () => {
  const base = { status: "failed" as const, message: "" };
  assert.equal(isRetryable({ ...base, failure: { bucket: "timeout", reason: "", detail: "", at: "", retried: 0 } }), true);
  assert.equal(isRetryable({ ...base, failure: { bucket: "timeout", reason: "", detail: "", at: "", retried: 1 } }), false);
  assert.equal(isRetryable({ ...base, failure: { bucket: "timeout", reason: "", detail: "", at: "", retried: 0, gaveUp: true } }), false);
  assert.equal(isRetryable({ ...base, status: "success", failure: { bucket: "timeout", reason: "", detail: "", at: "", retried: 0 } }), false);
  assert.equal(isRetryable({ ...base, failure: { bucket: "input", reason: "", detail: "", at: "", retried: 0 } }), false);
});
