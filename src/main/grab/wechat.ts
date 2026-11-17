import type { MpHealthView } from "../../shared/mp-health";

export async function checkMpHealth(): Promise<MpHealthView> {
  return { state: "unset", appId: "", checkedAt: new Date().toISOString(), message: "开源版不含公众号功能" };
}
