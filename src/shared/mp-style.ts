/**
 * 公众号排版样式令牌。
 *
 * 为什么不用 class + <style>：公众号后台和草稿接口都会把 <style> 和 class 剥掉，
 * 只保留元素上的 style 属性。所以一套「模板」在这里就是一组数值，排版时直接拼成内联样式，
 * 发出去是什么样，手机上就是什么样。
 */

export interface MpHeadingStyle {
  /** 字号 px */
  size: number;
  color: string;
  weight: number;
  /** 左侧竖条宽度 px，0 表示不要 */
  bar: number;
  /** 底部细线 */
  underline?: boolean;
  /** 底色块（整行铺底） */
  bg?: string;
  /** 居中标题 */
  center?: boolean;
}

export interface MpStyleTokens {
  /** 模板名，界面上显示 */
  name: string;
  /** 字体栈；公众号只认系统字体，这里给的是兜底列表 */
  fontFamily: string;
  bodySize: number;
  bodyColor: string;
  /** 行高倍数 */
  lineHeight: number;
  /** 段间距，单位 em */
  paraGap: number;
  /** 首行缩进两字 */
  indent: boolean;
  /** 字间距 px */
  letterSpacing: number;
  h1: MpHeadingStyle;
  h2: MpHeadingStyle;
  h3: MpHeadingStyle;
  strongColor: string;
  linkColor: string;
  quote: { bg: string; borderColor: string; color: string; radius: number };
  table: { headBg: string; headColor: string; borderColor: string; stripe: string; radius: number };
  code: { bg: string; color: string; blockBg: string; blockColor: string };
  divider: { color: string; dashed: boolean };
  imgRadius: number;
}

// 字体名一律用单引号：这些值最终会塞进 style="..." 里，双引号会把属性提前截断
export const SANS = "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
export const SERIF = "'Songti SC','STSong','SimSun',serif";
export const KAI = "'Kaiti SC','STKaiti','KaiTi',serif";
export const MONO = "'JetBrains Mono','Fira Code',Consolas,'Courier New',monospace";

const t = (p: Partial<MpStyleTokens> & { name: string }): MpStyleTokens => ({
  fontFamily: SANS,
  bodySize: 16,
  bodyColor: "#3f3f3f",
  lineHeight: 1.8,
  paraGap: 0.9,
  indent: false,
  letterSpacing: 0.4,
  h1: { size: 22, color: "#1a3c6d", weight: 700, bar: 4, underline: true },
  h2: { size: 18, color: "#2b6cb0", weight: 600, bar: 3 },
  h3: { size: 16, color: "#1a3c6d", weight: 600, bar: 0 },
  strongColor: "#1a3c6d",
  linkColor: "#2b6cb0",
  quote: { bg: "#f7f8fa", borderColor: "#2b6cb0", color: "#6b6b6b", radius: 6 },
  table: { headBg: "#1a3c6d", headColor: "#ffffff", borderColor: "#e5e6eb", stripe: "#f7f8fa", radius: 6 },
  code: { bg: "#f2f3f5", color: "#d6336c", blockBg: "#1e1e2e", blockColor: "#cdd6f4" },
  divider: { color: "#e5e6eb", dashed: false },
  imgRadius: 4,
  ...p,
});

/** 内置模板。顺序就是界面上宫格的顺序，头两个是「最不会被挑刺」的通用款 */
export const MP_STYLES: MpStyleTokens[] = [
  t({ name: "简约留白", bodyColor: "#333333", bodySize: 16, lineHeight: 1.9,
    h1: { size: 22, color: "#1a1a2e", weight: 700, bar: 0, underline: true },
    h2: { size: 18, color: "#1a1a2e", weight: 600, bar: 0 },
    h3: { size: 16, color: "#555555", weight: 600, bar: 0 },
    strongColor: "#1a1a2e",
    quote: { bg: "#f9f9fb", borderColor: "#cccccc", color: "#666666", radius: 0 },
    table: { headBg: "#1a1a2e", headColor: "#ffffff", borderColor: "#eeeeee", stripe: "#fafafa", radius: 0 },
    code: { bg: "#f0f0f2", color: "#d63384", blockBg: "#f5f5f7", blockColor: "#3f3f3f" },
    divider: { color: "#eeeeee", dashed: false } }),

  t({ name: "暖阳橙调", bodyColor: "#3d2e1e", lineHeight: 1.9,
    h1: { size: 22, color: "#c75b12", weight: 700, bar: 5 },
    h2: { size: 18, color: "#d4731e", weight: 600, bar: 4 },
    h3: { size: 16, color: "#a65d1a", weight: 600, bar: 0 },
    strongColor: "#c75b12",
    linkColor: "#d4731e",
    quote: { bg: "#fef7ee", borderColor: "#e8831a", color: "#7a5a3a", radius: 8 },
    table: { headBg: "#e8831a", headColor: "#ffffff", borderColor: "#f0dcc8", stripe: "#fef7ee", radius: 8 },
    code: { bg: "#fdf0e0", color: "#c75b12", blockBg: "#fdf6ed", blockColor: "#3d2e1e" },
    divider: { color: "#f0a347", dashed: false } }),

  t({ name: "森林绿意", bodyColor: "#2d3a2d", lineHeight: 1.9,
    h1: { size: 22, color: "#2d5a2d", weight: 700, bar: 4, underline: true },
    h2: { size: 18, color: "#3a7040", weight: 600, bar: 3 },
    h3: { size: 16, color: "#4a7a50", weight: 600, bar: 0 },
    strongColor: "#2d5a2d",
    linkColor: "#3a8c4a",
    quote: { bg: "#f2f8f2", borderColor: "#6baf7a", color: "#4a6a4a", radius: 8 },
    table: { headBg: "#4a8c5c", headColor: "#ffffff", borderColor: "#c8dcc8", stripe: "#f5faf5", radius: 8 },
    code: { bg: "#e8f0e8", color: "#2d6a3a", blockBg: "#f0f7f0", blockColor: "#2d3a2d" },
    divider: { color: "#c8dcc8", dashed: false } }),

  t({ name: "暮色紫调", bodyColor: "#2e2437", lineHeight: 1.9,
    h1: { size: 22, color: "#5b3a7a", weight: 700, bar: 4, underline: true },
    h2: { size: 18, color: "#6b4a8a", weight: 600, bar: 3 },
    h3: { size: 16, color: "#7b5a9a", weight: 600, bar: 0 },
    strongColor: "#5b3a7a",
    linkColor: "#7b4a9a",
    quote: { bg: "#f6f2fa", borderColor: "#a78bfa", color: "#5a4a6a", radius: 8 },
    table: { headBg: "#7b4a9a", headColor: "#ffffff", borderColor: "#d8cce8", stripe: "#f8f4fc", radius: 8 },
    code: { bg: "#eee8f4", color: "#7b3a9a", blockBg: "#f4f0f8", blockColor: "#2e2437" },
    divider: { color: "#d8cce8", dashed: false } }),

  t({ name: "海洋蓝调", bodyColor: "#25303d", lineHeight: 1.9,
    h1: { size: 22, color: "#14507a", weight: 700, bar: 4, underline: true },
    h2: { size: 18, color: "#1d6a9c", weight: 600, bar: 3 },
    h3: { size: 16, color: "#2a7bb0", weight: 600, bar: 0 },
    strongColor: "#14507a",
    linkColor: "#1d6a9c",
    quote: { bg: "#f1f7fb", borderColor: "#4a9fd4", color: "#4a6070", radius: 8 },
    table: { headBg: "#1d6a9c", headColor: "#ffffff", borderColor: "#cfe2ee", stripe: "#f6fbfd", radius: 8 },
    code: { bg: "#e8f2f8", color: "#1a6a9a", blockBg: "#f2f8fc", blockColor: "#25303d" },
    divider: { color: "#cfe2ee", dashed: false } }),

  t({ name: "国风典雅", fontFamily: KAI, bodyColor: "#3a2f28", bodySize: 17, lineHeight: 1.9, paraGap: 1, letterSpacing: 1,
    h1: { size: 22, color: "#8c1f28", weight: 700, bar: 0, center: true, underline: true },
    h2: { size: 18, color: "#a8323c", weight: 600, bar: 3 },
    h3: { size: 16, color: "#8c1f28", weight: 600, bar: 0 },
    strongColor: "#8c1f28",
    linkColor: "#a8323c",
    quote: { bg: "#faf6f0", borderColor: "#c9a063", color: "#6b5a48", radius: 2 },
    table: { headBg: "#8c1f28", headColor: "#faf6f0", borderColor: "#e0d3bf", stripe: "#fbf8f3", radius: 2 },
    code: { bg: "#f3ece0", color: "#8c1f28", blockBg: "#faf6f0", blockColor: "#3a2f28" },
    divider: { color: "#d9c9ae", dashed: false } }),

  t({ name: "柔和莫兰迪", bodyColor: "#4a4a48", lineHeight: 1.95, letterSpacing: 0.6,
    h1: { size: 21, color: "#6b6a63", weight: 700, bar: 0, underline: true },
    h2: { size: 17, color: "#81817a", weight: 600, bar: 3 },
    h3: { size: 16, color: "#8d8d85", weight: 600, bar: 0 },
    strongColor: "#6b6a63",
    linkColor: "#8a8f7d",
    quote: { bg: "#f4f3f0", borderColor: "#b9b8ad", color: "#6e6e68", radius: 6 },
    table: { headBg: "#8d8d85", headColor: "#ffffff", borderColor: "#e2e1db", stripe: "#f8f8f6", radius: 6 },
    code: { bg: "#efece5", color: "#8a6f5a", blockBg: "#f6f5f1", blockColor: "#4a4a48" },
    divider: { color: "#dcdbd4", dashed: true } }),

  t({ name: "深色极客", bodyColor: "#c9d1d9", bodySize: 15, lineHeight: 1.9, letterSpacing: 0.2,
    fontFamily: MONO,
    h1: { size: 21, color: "#7ee787", weight: 700, bar: 0, bg: "#161b22" },
    h2: { size: 17, color: "#79c0ff", weight: 600, bar: 0, bg: "#161b22" },
    h3: { size: 16, color: "#d2a8ff", weight: 600, bar: 0 },
    strongColor: "#7ee787",
    linkColor: "#79c0ff",
    quote: { bg: "#161b22", borderColor: "#30363d", color: "#8b949e", radius: 6 },
    table: { headBg: "#21262d", headColor: "#f0f6fc", borderColor: "#30363d", stripe: "#0d1117", radius: 6 },
    code: { bg: "#21262d", color: "#ff7b72", blockBg: "#161b22", blockColor: "#c9d1d9" },
    divider: { color: "#30363d", dashed: true } }),
];

export const DEFAULT_MP_STYLE = MP_STYLES[0]!;

const px = (n: number) => n + "px";

/** 块级元素的上下间距：首段不要上边距，否则正文头顶空一块 */
export function paraMargin(tk: MpStyleTokens) {
  return "0 0 " + tk.paraGap + "em";
}

export function bodyStyle(tk: MpStyleTokens) {
  return [
    "margin:0 0 " + tk.paraGap + "em 0",
    "font-size:" + px(tk.bodySize),
    "line-height:" + tk.lineHeight,
    "color:" + tk.bodyColor,
    "letter-spacing:" + px(tk.letterSpacing),
    tk.indent ? "text-indent:2em" : "",
    "word-break:break-word",
  ]
    .filter(Boolean)
    .join(";");
}

export function headingStyle(tk: MpStyleTokens, level: 1 | 2 | 3) {
  const h = level === 1 ? tk.h1 : level === 2 ? tk.h2 : tk.h3;
  return [
    "margin:" + (level === 1 ? "1.6em" : level === 2 ? "1.4em" : "1.2em") + " 0 " + (level === 1 ? "0.9em" : "0.7em"),
    "font-size:" + px(h.size),
    "font-weight:" + h.weight,
    "color:" + h.color,
    "line-height:1.5",
    h.bar ? "border-left:" + px(h.bar) + " solid " + h.color : "",
    h.bar ? "padding-left:" + px(h.bar * 3) : "",
    h.underline ? "border-bottom:1px solid " + (level === 1 ? tk.divider.color : tk.divider.color) + ";padding-bottom:0.35em" : "",
    h.bg ? "background:" + h.bg + ";padding:0.5em 0.8em;border-radius:4px" : "",
    h.center ? "text-align:center" : "",
    "letter-spacing:" + px(tk.letterSpacing),
  ]
    .filter(Boolean)
    .join(";");
}

/**
 * 只要「字体本身」的样式。
 * 骨架模板已经负责底色、边框、卡片这些装饰，这里只补字号颜色字重——
 * 否则骨架里搬来的竖条会和令牌生成的竖条叠成两条。
 */
export function textStyle(tk: MpStyleTokens, kind: "h1" | "h2" | "h3" | "p" | "quote") {
  const spacing = "letter-spacing:" + px(tk.letterSpacing);
  if (kind === "h1" || kind === "h2" || kind === "h3") {
    const h = kind === "h1" ? tk.h1 : kind === "h2" ? tk.h2 : tk.h3;
    return ["font-size:" + px(h.size), "font-weight:" + (h.weight || 700), "color:" + h.color, "line-height:1.5", spacing].join(";");
  }
  if (kind === "quote") return ["font-size:" + px(tk.bodySize), "line-height:" + tk.lineHeight, "color:" + tk.quote.color, spacing].join(";");
  return [
    "font-size:" + px(tk.bodySize),
    "line-height:" + tk.lineHeight,
    "color:" + tk.bodyColor,
    spacing,
    tk.indent ? "text-indent:2em" : "",
  ]
    .filter(Boolean)
    .join(";");
}

export function quoteStyle(tk: MpStyleTokens) {
  const q = tk.quote;
  return [
    "margin:1.2em 0",
    "padding:0.8em 1em",
    "background:" + q.bg,
    "border-left:4px solid " + q.borderColor,
    "border-radius:0 " + px(q.radius) + " " + px(q.radius) + " 0",
    "color:" + q.color,
    "font-size:" + px(tk.bodySize - 1),
    "line-height:" + tk.lineHeight,
  ].join(";");
}

export function listStyle(tk: MpStyleTokens) {
  return "margin:0.8em 0;padding-left:1.5em;font-size:" + px(tk.bodySize) + ";line-height:" + tk.lineHeight + ";color:" + tk.bodyColor;
}

export function listItemStyle(tk: MpStyleTokens) {
  return "margin:0 0 0.4em;color:" + tk.bodyColor + ";font-size:" + px(tk.bodySize) + ";line-height:" + tk.lineHeight;
}

export function tableStyle(tk: MpStyleTokens) {
  const b = tk.table;
  return "width:100%;border-collapse:separate;border-spacing:0;border:1px solid " + b.borderColor + ";border-radius:" + px(b.radius) + ";overflow:hidden;margin:1.2em 0;font-size:" + px(tk.bodySize - 2) + ";line-height:1.6";
}

export function thStyle(tk: MpStyleTokens) {
  const b = tk.table;
  return "background:" + b.headBg + ";color:" + b.headColor + ";font-weight:600;padding:0.6em 0.8em;text-align:left;border-right:1px solid rgba(255,255,255,0.16)";
}

export function tdStyle(tk: MpStyleTokens) {
  return "padding:0.6em 0.8em;border-top:1px solid " + tk.table.borderColor + ";color:" + tk.bodyColor;
}

export function codeBlockStyle(tk: MpStyleTokens) {
  const c = tk.code;
  return [
    "margin:1.2em 0",
    "padding:0.9em 1em",
    "background:" + c.blockBg,
    "color:" + c.blockColor,
    "border-radius:6px",
    "font-size:" + px(tk.bodySize - 3),
    "line-height:1.7",
    "overflow-x:auto",
    "font-family:" + MONO,
    "white-space:pre-wrap",
    "word-break:break-all",
  ].join(";");
}

export function codeInlineStyle(tk: MpStyleTokens) {
  return "background:" + tk.code.bg + ";color:" + tk.code.color + ";padding:0.15em 0.35em;border-radius:3px;font-size:0.9em;font-family:" + MONO;
}

export function imgStyle(tk: MpStyleTokens) {
  return "max-width:100%;height:auto;display:block;margin:1em auto;border-radius:" + px(tk.imgRadius);
}

export function imgBoxStyle(tk: MpStyleTokens) {
  return "text-align:center;margin:1em 0";
}

export function dividerStyle(tk: MpStyleTokens) {
  return tk.divider.dashed
    ? "border:none;border-top:1px dashed " + tk.divider.color + ";margin:2em 0"
    : "border:none;height:1px;background:linear-gradient(to right,transparent," + tk.divider.color + ",transparent);margin:2em 0";
}

/** 正文最外层包一层，把字体和底色统一住；公众号会保留外层 section 的样式 */
export function wrapperStyle(tk: MpStyleTokens) {
  return ["font-family:" + tk.fontFamily, "font-size:" + px(tk.bodySize), "color:" + tk.bodyColor, "line-height:" + tk.lineHeight, "letter-spacing:" + px(tk.letterSpacing)].join(";");
}

/** 模板列表里画小色卡用的几个主色 */
export function swatches(tk: MpStyleTokens) {
  return [tk.h1.color, tk.h2.color, tk.quote.borderColor, tk.table.headBg, tk.quote.bg];
}

/**
 * 把用户调过的几个值合并回一套完整令牌。
 * 界面只暴露少量旋钮（主色、字号、行高、段距、缩进），其余跟模板走。
 */
export function tuneStyle(base: MpStyleTokens, patch: Partial<Pick<MpStyleTokens, "bodySize" | "lineHeight" | "paraGap" | "indent" | "letterSpacing">> & { accent?: string }): MpStyleTokens {
  const accent = patch.accent;
  const next: MpStyleTokens = {
    ...base,
    ...(patch.bodySize === undefined ? {} : { bodySize: patch.bodySize }),
    ...(patch.lineHeight === undefined ? {} : { lineHeight: patch.lineHeight }),
    ...(patch.paraGap === undefined ? {} : { paraGap: patch.paraGap }),
    ...(patch.indent === undefined ? {} : { indent: patch.indent }),
    ...(patch.letterSpacing === undefined ? {} : { letterSpacing: patch.letterSpacing }),
  };
  if (!accent) return next;
  // 主色一动，标题、强调、链接、引用竖条、表头一起跟着走，避免花里胡哨的撞色
  return {
    ...next,
    h1: { ...next.h1, color: accent, bar: next.h1.bar === 0 && !next.h1.bg ? 0 : next.h1.bar },
    h2: { ...next.h2, color: accent },
    h3: { ...next.h3, color: accent },
    strongColor: accent,
    linkColor: accent,
    quote: { ...next.quote, borderColor: accent },
    table: { ...next.table, headBg: accent },
  };
}

export function parseStyleTokens(v: unknown): MpStyleTokens | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== "string" || typeof o.bodySize !== "number" || typeof o.bodyColor !== "string") return undefined;
  const base = MP_STYLES.find((s) => s.name === o.name) ?? DEFAULT_MP_STYLE;
  // 提取出来的模板字段可能不全，缺的用同名内置模板兜底，保证渲染时不缺值
  return {
    ...base,
    ...(o as Partial<MpStyleTokens>),
    h1: { ...base.h1, ...((o.h1 as Partial<MpHeadingStyle>) || {}) },
    h2: { ...base.h2, ...((o.h2 as Partial<MpHeadingStyle>) || {}) },
    h3: { ...base.h3, ...((o.h3 as Partial<MpHeadingStyle>) || {}) },
    quote: { ...base.quote, ...((o.quote as object) || {}) },
    table: { ...base.table, ...((o.table as object) || {}) },
    code: { ...base.code, ...((o.code as object) || {}) },
    divider: { ...base.divider, ...((o.divider as object) || {}) },
  };
}
