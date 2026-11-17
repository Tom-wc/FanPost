import type { WebContents } from "electron";
import type { Account, LoginStatus, Platform, TaskStatus } from "../../shared/types";
import { platformMap } from "../../shared/platforms";
import { platformRule } from "../../shared/platform-rules";

export type AccountUpdate = { name?: string; loginStatus?: LoginStatus };
export type PublishProgress = (status: TaskStatus, message: string) => Promise<void>;
export type PublishResult = { status: "manual_required" | "failed"; message: string };

export const chromeUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

export const redactDiagnostic = (value: unknown, limit = 16000) =>
  String(value ?? "")
    .replace(
      /((?:cookie|sessionid|token|findertoken|encfilekey|authkey)["']?\s*[:=]\s*["']?)[^"'&\s,}]+/gi,
      "$1[redacted]",
    )
    .replace(/([?&](?:token|findertoken|encfilekey)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, limit);

export const XHS_PUBLISH_PATH_VIDEO = "/publish/publish?from=homepage&target=video";
export const XHS_PUBLISH_PATH_IMAGE = "/publish/publish?from=homepage&target=image";
const XHS_ORIGIN_DOMESTIC = "https://creator.xiaohongshu.com";
const XHS_ORIGIN_OVERSEAS = "https://creator.rednote.com";

export const xhsOriginFromUrl = (url?: string) => {
  try {
    const host = new URL(url || "").hostname.toLowerCase();
    if (host === "rednote.com" || host.endsWith(".rednote.com")) return XHS_ORIGIN_OVERSEAS;
  } catch {}
  return XHS_ORIGIN_DOMESTIC;
};

export const platformTitle = (title: string, max?: number) =>
  max ? Array.from(title).slice(0, max).join("") : title;

export const videoTitleLimit = (platform: Platform) => platformRule(platform, "video").titleMax;

const flatText = (text: string) => text.replace(/[\s​-‍﻿]+/g, "");
export const textLanded = (actual: string, expected: string) => flatText(actual).includes(flatText(expected));

export const videoReadyMessage = (platform: Account["platform"]) => {
  const name = platformMap[platform].name;
  const { declarationHint: declaration, reviewHint } = platformRule(platform, "video");
  return (
    name +
    "视频已上传，标题/简介已填好，发布页停在该账号页面里。请检查封面、话题" +
    (reviewHint ? "、" + reviewHint : "") +
    (declaration ? "，并按实际情况自行勾选「" + declaration + "」" : "") +
    "，确认无误后由你本人点击「发布」。发布后可点「检查是否已发布」更新状态。"
  );
};

export const ignoreAborted = (error: unknown) => {
  if (!/ERR_ABORTED/.test(String(error))) throw error;
};


