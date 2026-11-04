import type { ContentType, Platform } from "./types.ts";

export const DECLARATIONS = ["none", "ai", "fiction", "opinion", "repost", "promo"] as const;
export type Declaration = (typeof DECLARATIONS)[number];
export const DEFAULT_DECLARATION: Declaration = "none";

export const DECLARATION_LABELS: Record<Declaration, string> = {
  none: "无需声明（原创内容）",
  ai: "含AI生成内容",
  fiction: "虚构演绎，仅供娱乐",
  opinion: "个人观点，仅供参考",
  repost: "内容为转载",
  promo: "含营销推广信息",
};

type OptionMap = Partial<Record<Declaration, string>>;

const VIDEO_OPTIONS: Partial<Record<Platform, OptionMap>> = {
  douyin: { none: "无需添加自主声明", ai: "内容由AI生成", fiction: "虚构演绎，仅供娱乐", opinion: "内容为个人观点或见解", repost: "内容为转载信息", promo: "内容含营销推广信息" },
  weibo: { none: "我的内容无需声明", ai: "含AI生成内容", fiction: "含虚构演绎内容", opinion: "个人观点，仅供参考", repost: "内容为转载", promo: "内容含营销信息" },
  bilibili: { none: "内容无需标注", ai: "含AI生成内容", fiction: "含虚构演绎内容", opinion: "个人观点，仅供参考", repost: "内容为转载", promo: "内容含营销信息" },
  kuaishou: { ai: "内容为AI生成", fiction: "演绎情节，仅供娱乐", opinion: "个人观点，仅供参考", repost: "素材来源于网络" },
  toutiao: { ai: "AI生成", fiction: "虚构演绎，故事经历", opinion: "投资观点，仅供参考", repost: "取自站外" },
  qqmedia: { none: "无需标注", ai: "无需标注", fiction: "虚构演绎，仅供娱乐", opinion: "个人观点，仅供参考", repost: "内容为转载", promo: "内容包含营销广告信息" },
  xiaohongshu: { ai: "笔记含AI合成内容", fiction: "虚构演绎，仅供娱乐", promo: "内容包含营销广告" },
};

const IMAGE_OPTIONS: Partial<Record<Platform, OptionMap>> = {
  douyin: VIDEO_OPTIONS.douyin,
  kuaishou: VIDEO_OPTIONS.kuaishou,
  xiaohongshu: VIDEO_OPTIONS.xiaohongshu,
  weibo: VIDEO_OPTIONS.weibo,
  toutiao: { ai: "引用AI", fiction: "虚构演绎，故事经历", opinion: "个人观点，仅供参考", repost: "取材网络" },
  zhihu: { none: "无声明", ai: "包含 AI 辅助创作", fiction: "虚构创作" },
  baijiahao: { ai: "采用AI生成内容" },
};

const OPTIONS: Record<ContentType, Partial<Record<Platform, OptionMap>>> = { video: VIDEO_OPTIONS, image_text: IMAGE_OPTIONS };

const VARIANT_OPTIONS: Record<string, OptionMap> = {
  weiboCompact: { none: "无", ai: "内容由AI生成", fiction: "内容为虚构演绎", repost: "内容为转载" },
};

export function variantOption(variant: string, declaration: Declaration) {
  return VARIANT_OPTIONS[variant]?.[declaration];
}

export function isDeclaration(value: unknown): value is Declaration {
  return typeof value === "string" && (DECLARATIONS as readonly string[]).includes(value);
}

export function declarationOption(platform: Platform, type: ContentType, declaration: Declaration | undefined) {
  if (!declaration) return undefined;
  return OPTIONS[type][platform]?.[declaration];
}

export function hasDeclaration(platform: Platform, type: ContentType) {
  return !!OPTIONS[type][platform];
}

export function declarationGaps(platforms: Platform[], type: ContentType, declaration: Declaration | undefined) {
  if (!declaration || declaration === "none") return [];
  return platforms.filter((p) => OPTIONS[type][p] && !OPTIONS[type][p]![declaration]);
}

export const BILIBILI_ZONES = ["知识", "科技数码", "人工智能", "生活经验", "生活兴趣", "vlog", "资讯", "影视", "娱乐", "音乐", "舞蹈", "动画", "绘画", "鬼畜", "游戏", "汽车", "时尚美妆", "家装房产", "户外潮流", "健身", "体育运动", "手工", "美食", "小剧场", "旅游出行", "三农", "动物", "亲子", "健康", "情感"];
export const DEFAULT_BILIBILI_ZONE = "知识";
