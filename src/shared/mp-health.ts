export const MP_HEALTH_INTERVAL_MS = 6 * 3600 * 1000;
export const MP_HEALTH_FIRST_DELAY_MS = 60 * 1000;

export type MpHealthState = "ok" | "unset" | "failed" | "offline";

export interface MpHealthView {
  state: MpHealthState;
  appId: string;
  checkedAt: string;
  message: string;
  code?: number;
}

export interface MpHealthNotice {
  level: "error" | "success";
  title: string;
  message: string;
}

export function healthNotice(prev: MpHealthState | undefined, next: MpHealthView): MpHealthNotice | undefined {
  if (next.state === "failed" && prev !== "failed")
    return { level: "error", title: "公众号接口不能用了（" + next.appId + "）", message: next.message + "。修好之前「存公众号草稿」会失败，一键复制不受影响。到 设置 → 公众号 里点「检测接口」确认。" };
  if (next.state === "ok" && prev === "failed") return { level: "success", title: "公众号接口已恢复（" + next.appId + "）", message: "可以继续存公众号草稿。" };
  return undefined;
}

export const HEALTH_LABEL: Record<MpHealthState, string> = { ok: "接口正常", unset: "未设置", failed: "接口不可用", offline: "网络不通，没测成" };
