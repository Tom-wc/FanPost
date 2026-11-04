export const CHECK_OK = "平台检测未发现问题。";
export const CHECK_PREFIX = "平台检测建议（未自动采纳，请你判断）：";

export interface SplitMessage {
  text: string;
  check?: { ok: boolean; text: string };
}

export function splitCheck(message: string): SplitMessage {
  if (message.endsWith(CHECK_OK)) return { text: message.slice(0, -CHECK_OK.length), check: { ok: true, text: "平台检测：未发现问题" } };
  const at = message.lastIndexOf(CHECK_PREFIX);
  if (at < 0) return { text: message };
  return { text: message.slice(0, at), check: { ok: false, text: message.slice(at) } };
}
