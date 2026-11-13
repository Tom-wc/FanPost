/**
 * 公众号模板：一组排版令牌 + 每类块的「结构骨架」。
 *
 * 令牌只描述字号、颜色、间距，套出来的东西彼此长得都差不多。真正让人一眼认出
 * 「这篇是那个号」的，是标题外面那层卡片、引用的圆角底色、分割线的装饰。
 * 公众号会剥掉 class 和 <style>，这些只能靠内联样式 + 嵌套 section 表达，
 * 所以模板里直接存 HTML 骨架，用 {{c}} 占位正文内容。
 */
import { parseStyleTokens, type MpStyleTokens } from "./mp-style.ts";

export type SkinKind = "h1" | "h2" | "h3" | "p" | "quote" | "hr";

export const SKIN_KINDS: SkinKind[] = ["h1", "h2", "h3", "p", "quote", "hr"];

export const SKIN_LABEL: Record<SkinKind, string> = {
  h1: "大标题",
  h2: "小标题",
  h3: "三级标题",
  p: "正文段落",
  quote: "引用",
  hr: "分割线",
};

/** 内容占位符。正文替换进这里，骨架的其余部分原样保留 */
export const CONTENT_SLOT = "{{c}}";

/**
 * 单条骨架的长度上限：超过这个数基本等于把别人整篇文章搬进来了，宁可不存。
 *
 * 早先是 2000，只考虑「文章提取」那一类骨架（它们本来就该瘦）。加了「素材」之后
 * 这个门槛太低：站点上的一个花边标题卡本身就有三四千字节，卡在 2000 会把素材丢掉，
 * 或者逼提取器把装饰削光——那正是这轮要解决的问题。
 */
export const SKIN_MAX = 6000;

/**
 * 一个「素材」：一类块的一种具体长相。
 *
 * 站点上的一套模板其实是十几个素材串起来的（头图、小标题、正文、引用、分割线……）。
 * 用户要的往往不是整套，而是其中某一个——比如「这个引用框不错，用在我的号上」。
 * 所以提取时除了合成整套，还要把每个素材单独留着，能一条一条挑。
 */
export interface MpAsset {
  id: string;
  kind: SkinKind;
  /** 骨架 HTML，含 {{c}} 占位；分割线这类整块装饰的没有占位符 */
  html: string;
  /** 列表上显示的名字：「小标题 · 传统习俗」 */
  label: string;
  /** 从哪来的：「壹伴 500」 */
  source: string;
  createdAt: number;
}

export interface MpTemplate {
  id: string;
  name: string;
  createdAt: number;
  /** 从哪来的：文章链接、「正文」，或「内置」 */
  source: string;
  tokens: MpStyleTokens;
  /** 每类块的骨架；没有的类型在套用时按令牌生成默认样式 */
  skins: Partial<Record<SkinKind, string>>;
  /**
   * 内置模板的生成器名。有这个字段就不看 skins——骨架每次按当前令牌现生成，
   * 用户改主色、改字号，卡片底色和边框会跟着一起变。
   */
  builtin?: string;
  /** 这套模板里逐个素材的样子，界面上一张一张列出来，可以只取其中一个 */
  assets?: MpAsset[];
  skinAccent?: string;
}

const UNSAFE_HTML = [
  /<\s*\/?\s*(script|iframe|frame|object|embed|form|input|button|textarea|link|meta|base|style|svg|math|template)\b/i,
  /[\s"'\/]on[a-z]+\s*=/i,
  /(javascript|vbscript)\s*:/i,
  /\bsrcdoc\s*=/i,
  /data\s*:\s*text\/html/i,
];

export function isSafeSkinHtml(html: string): boolean {
  return !UNSAFE_HTML.some((re) => re.test(html));
}

export function newTemplateId(): string {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 这套模板有没有带结构（带结构的才需要走骨架渲染） */
export function hasSkins(t: Pick<MpTemplate, "skins"> & { builtin?: string }): boolean {
  if (t.builtin) return true;
  return Object.values(t.skins || {}).some((s) => typeof s === "string" && s.trim().length > 0);
}

/** 把内容填进骨架。分割线这类整块都是装饰的骨架没有占位符，原样返回 */
export function fillSkin(skin: string, content: string): string {
  if (!skin.includes(CONTENT_SLOT)) return skin;
  // 用函数形式替换，避免内容里的 $& / $1 被当成替换模式
  return skin.replace(CONTENT_SLOT, () => content);
}

/**
 * 骨架里的颜色跟着主色走。
 * 旋钮改了主色，卡片底色、边框、标题色都得一起变，否则一套模板里外两种色很怪。
 */
export function recolorSkin(skin: string, from: string, to: string): string {
  const a = (from || "").trim().toLowerCase();
  const b = (to || "").trim().toLowerCase();
  if (!a || !b || a === b) return skin;
  const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return skin.replace(new RegExp(esc, "gi"), to);
}

/** 列表里显示的说明，比如「含标题卡片、引用卡片」 */
export function skinSummary(t: Pick<MpTemplate, "skins">): string {
  const kinds = SKIN_KINDS.filter((k) => (t.skins[k] || "").trim());
  if (!kinds.length) return "";
  return "含" + kinds.map((k) => SKIN_LABEL[k]).join("、");
}

/**
 * 一套模板所有骨架加起来的上限。
 * 单条放宽到 6000 是为了保住素材的装饰，但整套不能跟着涨 12 倍——
 * 30 套模板要塞进 localStorage，按 24KB 一套算总共 700KB 左右，不会顶到 5MB。
 */
const SKIN_TOTAL_MAX = 24000;

/** 读回一个素材；任何一处不对就当没有，不让坏数据进列表 */
export function parseAsset(v: unknown): MpAsset | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const kind = o.kind as SkinKind;
  if (!SKIN_KINDS.includes(kind)) return undefined;
  const html = typeof o.html === "string" ? o.html : "";
  if (!html.trim() || html.length > SKIN_MAX) return undefined;
  if (kind !== "hr" && !html.includes(CONTENT_SLOT)) return undefined;
  if (!isSafeSkinHtml(html)) return undefined;
  return {
    id: typeof o.id === "string" && o.id ? o.id : newTemplateId(),
    kind,
    html,
    label: typeof o.label === "string" ? o.label.slice(0, 24) : SKIN_LABEL[kind],
    source: typeof o.source === "string" ? o.source.slice(0, 60) : "",
    createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
  };
}

/** 从 localStorage 或导入的 JSON 里读回模板，字段坏了就当没有 */
export function parseTemplate(v: unknown): MpTemplate | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const tokens = parseStyleTokens(o.tokens);
  if (!tokens) return undefined;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 20) : "";
  if (!name) return undefined;
  const skins: Partial<Record<SkinKind, string>> = {};
  const rawSkins = o.skins && typeof o.skins === "object" ? (o.skins as Record<string, unknown>) : {};
  let total = 0;
  for (const k of SKIN_KINDS) {
    const s = rawSkins[k];
    // 太大的一律不收：宁可少一块装饰，也不把几 KB 的陌生结构塞进正文
    if (typeof s !== "string" || !s.trim() || s.length > SKIN_MAX) continue;
    if (k !== "hr" && !s.includes(CONTENT_SLOT)) continue;
    if (!isSafeSkinHtml(s)) continue;
    if (total + s.length > SKIN_TOTAL_MAX) break;
    skins[k] = s;
    total += s.length;
  }
  const assets = Array.isArray(o.assets) ? o.assets.map(parseAsset).filter((x): x is MpAsset => Boolean(x)).slice(0, 40) : [];
  return {
    id: typeof o.id === "string" && o.id ? o.id : newTemplateId(),
    name,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
    source: typeof o.source === "string" ? o.source.slice(0, 300) : "",
    tokens,
    skins,
    ...(typeof o.builtin === "string" && o.builtin ? { builtin: o.builtin.slice(0, 40) } : {}),
    ...(assets.length ? { assets } : {}),
    ...(typeof o.skinAccent === "string" && /^#[0-9a-f]{6}$/i.test(o.skinAccent) ? { skinAccent: o.skinAccent.toLowerCase() } : {}),
  };
}

/** 导出成文件时用的结构，带版本号方便以后改格式 */
export interface MpTemplateFile {
  app: "fanpost";
  kind: "mp-templates";
  version: 1;
  exportedAt: string;
  templates: MpTemplate[];
}

export function buildTemplateFile(list: MpTemplate[]): MpTemplateFile {
  return { app: "fanpost", kind: "mp-templates", version: 1, exportedAt: new Date().toISOString(), templates: list };
}

/** 读导入文件：认 app/kind，也容忍直接丢一个模板数组进来 */
export function readTemplateFile(raw: unknown): MpTemplate[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { templates?: unknown }).templates : undefined;
  if (!Array.isArray(list)) throw new Error("这个文件不是模板文件");
  const out = list
    .map(parseTemplate)
    .filter((x): x is MpTemplate => Boolean(x))
    .map((t) => ({ ...t, id: newTemplateId() }));
  if (!out.length) throw new Error("文件里没有能用的模板");
  return out.slice(0, 30);
}
