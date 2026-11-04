export const MP_RULES = {
  titleMax: 64,
  authorMax: 8,
  digestMax: 120,
  bodyCharsMax: 20000,
  bodyBytesMax: 1024 * 1024,
  imageBytesMax: 1024 * 1024,
  coverBytesMax: 10 * 1024 * 1024,
  imagesMax: 50,
};

export interface MpArticleInput {
  title: string;
  author: string;
  digest: string;
  text: string;
  html?: string;
  images: string[];
  cover?: string;
  sourceUrl: string;
  openComment: boolean;
  repost?: boolean;
}

export interface MpIssue {
  level: "error" | "warn";
  text: string;
}

const len = (s: string) => Array.from(s.trim()).length;

export function checkMpArticle(a: MpArticleInput): MpIssue[] {
  const out: MpIssue[] = [];
  const r = MP_RULES;
  if (!a.title.trim()) out.push({ level: "error", text: "标题不能为空" });
  if (len(a.title) > r.titleMax) out.push({ level: "error", text: "标题超出 " + (len(a.title) - r.titleMax) + " 字（公众号上限 " + r.titleMax + " 字）" });
  if (len(a.author) > r.authorMax) out.push({ level: "error", text: "作者超出 " + (len(a.author) - r.authorMax) + " 字（上限 " + r.authorMax + " 字）" });
  if (len(a.digest) > r.digestMax) out.push({ level: "error", text: "摘要超出 " + (len(a.digest) - r.digestMax) + " 字（上限 " + r.digestMax + " 字）" });
  if (!a.text.trim()) out.push({ level: "error", text: "正文不能为空" });
  if (len(a.text) > r.bodyCharsMax) out.push({ level: "error", text: "正文超出 " + (len(a.text) - r.bodyCharsMax) + " 字（上限 " + r.bodyCharsMax + " 字）" });
  if (!a.cover && !a.images.length && !/<img/i.test(a.html || "")) out.push({ level: "warn", text: "没有封面和图片，存草稿时会按标题自动生成一张封面" });
  if (a.images.length > r.imagesMax) out.push({ level: "error", text: "正文图片最多 " + r.imagesMax + " 张" });
  if (a.sourceUrl.trim() && !/^https?:\/\/\S+$/i.test(a.sourceUrl.trim())) out.push({ level: "error", text: "原文链接要以 http:// 或 https:// 开头" });
  if (!a.digest.trim()) out.push({ level: "warn", text: "没填摘要，公众号会自动取正文前 54 个字" });
  if (/https?:\/\//i.test(a.text)) out.push({ level: "warn", text: "正文里的网址在公众号文章里点不开，需要跳转请填「原文链接」" });
  if (a.repost && !a.sourceUrl.trim()) out.push({ level: "warn", text: "标了「内容为转载」但没填原文链接，建议填上原文地址" });
  return out;
}

export const MP_NOTES = [
  "存进公众号草稿箱后，要到 mp.weixin.qq.com「内容管理 → 草稿箱」里检查并点「发表」。",
  "「原创」声明、合集、付费等只能在公众号后台设置，接口不支持。",
  "正文排版和图片位置按编辑器里的样子存进公众号；图片会自动压到 1MB 以内（公众号限制），封面依次用你选的封面、原文封面、正文第一张图；都没有时按标题自动生成。",
];
