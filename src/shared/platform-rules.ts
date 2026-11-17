import type { ContentType, Platform, PlatformContent, PublishDraft } from "./types";
import { platformMap } from "./platforms.ts";

export interface PlatformRule {
  titleMin?: number;
  titleMax?: number;
  bodyMax?: number;
  imageMax?: number;
  topicMax?: number;
  titleCharset?: RegExp;
  titleCharsetHint?: string;
  mergeTitleIntoBody?: boolean;
  declarationHint?: string;
  reviewHint?: string;
}

const imageRules: Partial<Record<Platform, PlatformRule>> = {
  douyin: { titleMax: 20, bodyMax: 1000, imageMax: 35, topicMax: 5 },
  kuaishou: { mergeTitleIntoBody: true, bodyMax: 500, imageMax: 31 },
  xiaohongshu: { titleMax: 20, bodyMax: 1000, imageMax: 18, topicMax: 10 },
  toutiao: { titleMax: 30 },
  zhihu: { titleMax: 100 },
  baijiahao: { titleMax: 30 },
  weibo: { mergeTitleIntoBody: true, bodyMax: 2000, imageMax: 18 },
};

const WEIXIN_SHORT_TITLE = /^[\p{L}\p{N}\s《》“”：+？%℃]*$/u;
const WEIXIN_SHORT_TITLE_SWAP: Record<string, string> = { ":": "：", "?": "？", '"': "“", "‘": "“", "’": "”", "「": "“", "」": "”", "<": "《", ">": "》" };

export function weixinShortTitle(title: string) {
  return Array.from(title)
    .map((c) => WEIXIN_SHORT_TITLE_SWAP[c] ?? (WEIXIN_SHORT_TITLE.test(c) ? c : " "))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

const WEIXIN_TITLE_MIN = 6;
const WEIXIN_TITLE_MAX = 16;

export function weixinVideoTitle(title: string, description: string) {
  const clean = weixinShortTitle(title);
  const padded = Array.from(clean).length >= WEIXIN_TITLE_MIN ? clean : (clean + " " + weixinShortTitle(description)).trim();
  return Array.from(padded).slice(0, WEIXIN_TITLE_MAX).join("").trim();
}

const videoRules: Partial<Record<Platform, PlatformRule>> = {
  douyin: { titleMax: 30, bodyMax: 1000, topicMax: 5 },
  xiaohongshu: { titleMax: 20, bodyMax: 1000, topicMax: 10 },
  toutiao: { titleMax: 30 },
  weixin: {
    titleMin: WEIXIN_TITLE_MIN,
    titleMax: WEIXIN_TITLE_MAX,
    bodyMax: 1000,
    titleCharset: WEIXIN_SHORT_TITLE,
    titleCharsetHint: "短标题只能用文字、数字和《》“”：+？%℃",
    declarationHint: "内容为自行拍摄 / 内容为转载",
  },
  bilibili: { titleMax: 80, bodyMax: 2000, topicMax: 10 },
  qqmedia: { titleMax: 30 },
  kuaishou: { mergeTitleIntoBody: true, bodyMax: 500 },
  weibo: { mergeTitleIntoBody: true, bodyMax: 2000 },
};

export function supportsType(platform: Platform, type: ContentType) {
  return platform in (type === "video" ? videoRules : imageRules);
}

export function platformRule(platform: Platform, type: ContentType): PlatformRule {
  return (type === "video" ? videoRules : imageRules)[platform] || {};
}

export const titleLength = (title: string) => Array.from(title || "").length;

export interface ContentIssue {
  level: "error" | "warn";
  field: "title" | "body" | "images" | "topics";
  text: string;
}

export function mergedBody(title: string, description: string) {
  return [title, description].filter((x) => x.trim()).join("\n");
}

export function checkContent(
  platform: Platform,
  type: ContentType,
  content: { title: string; description: string; topics: string[] },
  imageCount = 0,
): ContentIssue[] {
  const rule = platformRule(platform, type);
  const issues: ContentIssue[] = [];
  const title = content.title.trim();
  if (!rule.mergeTitleIntoBody && title) {
    const len = titleLength(title);
    if (rule.titleMax !== undefined && len > rule.titleMax)
      issues.push({ level: "error", field: "title", text: "标题超出 " + (len - rule.titleMax) + " 字（上限 " + rule.titleMax + "）" });
    if (rule.titleMin !== undefined && len < rule.titleMin)
      issues.push({ level: "error", field: "title", text: "标题至少 " + rule.titleMin + " 字，当前 " + len + " 字" });
    if (rule.titleCharset && !rule.titleCharset.test(title))
      issues.push({ level: "warn", field: "title", text: (rule.titleCharsetHint || "标题含平台不支持的符号") + "，其他符号会自动去掉" });
  }
  const body = rule.mergeTitleIntoBody ? mergedBody(content.title, content.description) : content.description;
  const bodyLen = titleLength(body);
  if (rule.bodyMax !== undefined && bodyLen > rule.bodyMax)
    issues.push({ level: "error", field: "body", text: (type === "video" ? "简介" : "正文") + "超出 " + (bodyLen - rule.bodyMax) + " 字（上限 " + rule.bodyMax + "）" });
  if (type === "image_text" && rule.imageMax !== undefined && imageCount > rule.imageMax)
    issues.push({ level: "error", field: "images", text: "图片最多 " + rule.imageMax + " 张，当前 " + imageCount + " 张" });
  if (rule.topicMax !== undefined && content.topics.length > rule.topicMax)
    issues.push({ level: "warn", field: "topics", text: "话题建议不超过 " + rule.topicMax + " 个，多出的可能不生效" });
  return issues;
}

export function contentFor(draft: PublishDraft, platform: Platform): Required<Omit<PlatformContent, "coverPath" | "question" | "zone">> & { coverPath?: string; question?: string; zone?: string } {
  const own = draft.overrides?.[platform];
  return {
    title: own?.title ?? draft.title,
    description: own?.description ?? draft.description,
    topics: own?.topics ?? draft.topics,
    coverPath: own?.coverPath ?? draft.coverPath,
    ...(own?.question?.trim() ? { question: own.question.trim() } : {}),
    ...(own?.zone?.trim() ? { zone: own.zone.trim() } : {}),
  };
}

export function resolveDraft(draft: PublishDraft, platform: Platform): PublishDraft {
  return { ...draft, ...contentFor(draft, platform) };
}

export function isAssisted(platform: Platform, _type: ContentType) {
  return platformMap[platform].publishMode === "assisted";
}
