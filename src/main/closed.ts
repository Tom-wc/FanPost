export const CLOSED_FEATURE = "开源版不含此功能。请到 https://github.com/Tom-wc/FanPost/releases 下载发布版并激活使用。";

export function closedFeature(): never {
  throw new Error(CLOSED_FEATURE);
}
