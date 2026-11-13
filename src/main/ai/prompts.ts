import type { AiAction, ChatMessage } from "../../shared/ai.ts";
import type { ContentType, Platform } from "../../shared/types.ts";
import { platformMap } from "../../shared/platforms.ts";
import { platformRule } from "../../shared/platform-rules.ts";

export interface PromptContext {
  text: string;
  platform?: Platform;
  type?: ContentType;
  limit?: number;
  instruction?: string;
}

const BASE = "你是中文自媒体编辑。只输出可以直接粘贴使用的结果，不要解释、不要加引号、不要加『以下是』这类前缀，不要使用 Markdown 代码块。";

const STYLE: Partial<Record<Platform, string>> = {
  douyin: "口语、短句、节奏快，开头一句就抓人，避免书面语。",
  kuaishou: "口语、接地气、像和老铁聊天，句子短。",
  xiaohongshu: "第一人称分享感，多用具体细节和真实体验，可以适度用 emoji，分段短。",
  toutiao: "信息密度高，事实和结论前置，少用感叹号。",
  zhihu: "理性、讲逻辑，先给结论再给理由，不用营销腔。",
  baijiahao: "新闻化表达，客观陈述，避免主观夸张。",
  weibo: "精简、有信息量，适合一句话看完，可带 1 到 2 个话题。",
  weixin: "叙述平实，适合口播，句子不要太长。",
  bilibili: "有网感、可略带调侃，但信息要准确。",
  qqmedia: "规范书面表达，段落清晰。",
};

function limitOf(ctx: PromptContext, fallback?: number) {
  if (ctx.limit && ctx.limit > 0) return ctx.limit;
  if (ctx.platform) return platformRule(ctx.platform, ctx.type || "image_text").titleMax || fallback;
  return fallback;
}

function platformName(p?: Platform) {
  return p ? platformMap[p].name : "";
}

export function buildPrompt(action: AiAction, ctx: PromptContext): ChatMessage[] {
  const name = platformName(ctx.platform);
  const limit = limitOf(ctx, 30);
  const style = ctx.platform ? STYLE[ctx.platform] || "" : "";

  switch (action) {
    case "polish":
      return [
        { role: "system", content: BASE + (style ? "风格要求：" + style : "") + "保持原意和段落结构，只改表达，不增删事实。" },
        { role: "user", content: "润色下面这段文案：\n\n" + ctx.text },
      ];
    case "expand":
      return [
        { role: "system", content: BASE + "在不编造事实的前提下补充细节和例子，篇幅约为原文的 1.5 倍，保持段落。" },
        { role: "user", content: "扩写下面这段文案：\n\n" + ctx.text },
      ];
    case "shorten":
      return [
        { role: "system", content: BASE + "压缩表达，保留关键信息，删掉重复和铺垫，目标 " + Math.max(50, Math.round(ctx.limit || ctx.text.length * 0.6)) + " 字以内。" },
        { role: "user", content: "压缩下面这段文案：\n\n" + ctx.text },
      ];
    case "title":
      return [
        {
          role: "system",
          content:
            BASE +
            "只输出一个 JSON 字符串数组，包含 5 个标题，形如 [\"标题一\",\"标题二\"]。每个标题不超过 " +
            limit +
            " 个汉字，不要编号，不要书名号，不要引号以外的任何字符。" +
            (style ? "风格：" + style : ""),
        },
        { role: "user", content: "根据下面的内容拟标题" + (name ? "（发布平台：" + name + "）" : "") + "：\n\n" + ctx.text },
      ];
    case "topics":
      return [
        { role: "system", content: BASE + "提炼 8 个话题词，用中文逗号分隔，不带井号，每个 2 到 8 个字，贴合内容且有搜索价值。" },
        { role: "user", content: "为下面的内容提炼话题" + (name ? "（发布平台：" + name + "）" : "") + "：\n\n" + ctx.text },
      ];
    case "rewrite":
      return [
        { role: "system", content: BASE + "把同一份内容改写成目标平台的表达习惯，信息不能删减，不要出现平台名。" + (style ? "目标风格：" + style : "") },
        { role: "user", content: "目标平台：" + (name || "通用") + "\n\n原始内容：\n" + ctx.text },
      ];
    case "reply":
      return [
        { role: "system", content: BASE + "写一条回复粉丝评论的话，语气自然、有温度，不超过 40 字，不提任何联系方式、不引导站外、不承诺疗效或收益。" },
        { role: "user", content: (ctx.instruction ? "背景：" + ctx.instruction + "\n" : "") + "粉丝评论：" + ctx.text },
      ];
    default:
      return [
        { role: "system", content: BASE },
        { role: "user", content: ctx.text },
      ];
  }
}
