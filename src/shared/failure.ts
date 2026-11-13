import type { FailureBucket, PublishTask } from "./types";

export const RETRY_MAX = 1;
export const RETRY_DELAY_MS = 5 * 60000;

export const BUCKET_LABEL: Record<FailureBucket, string> = {
  login: "登录失效",
  captcha: "需要验证",
  not_found: "页面没找到元素",
  timeout: "超时",
  unconfirmed: "点了发布但没查到",
  quota: "额度不足",
  network: "网络问题",
  input: "内容不完整",
  other: "其他",
};

const RULES: Array<[FailureBucket, RegExp]> = [
  ["input", /需要至少一张图片|没有选择视频|视频文件不存在|草稿没有/],
  ["login", /登录|掉线|未登录|扫码/],
  ["captcha", /验证码|安全验证|滑块|需要你完成|短信验证/],
  ["quota", /QUOTA:|额度|超出上限/],
  ["network", /net::|连不上|网络|ECONN|ETIMEDOUT|DNS/],
  ["timeout", /超时|超过 ?\d+ ?分钟(没有|没)完成/],
  ["not_found", /未找到|未定位|页面已打开但|改版|找不到/],
  ["unconfirmed", /未确认|没查到|暂未查到/],
];

export function classifyFailure(strings: string[]): { bucket: FailureBucket; reason: string } {
  const text = strings.filter(Boolean).join(" ");
  for (const [bucket, re] of RULES) if (re.test(text)) return { bucket, reason: BUCKET_LABEL[bucket] };
  return { bucket: "other", reason: text ? BUCKET_LABEL.other : BUCKET_LABEL.other };
}

export const isRetryable = (task: Pick<PublishTask, "status" | "failure">) => {
  const f = task.failure;
  if (!f) return false;
  if (f.bucket === "input") return false;
  return task.status === "failed" && f.retried < RETRY_MAX && !f.gaveUp;
};
