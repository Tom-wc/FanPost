/**
 * 内置「结构模板」。
 *
 * 和 mp-style.ts 里那 8 套的分工要分清楚：那 8 套只是 8 组数值（字号、颜色、竖条粗细），
 * 套上去整篇还是原来那个样子，只换了件颜色——所以看上去像没做排版。
 * 这里的每套都带 h1/h2/h3/p/quote/hr 六类 HTML 骨架（标题卡、引用卡、分割线），
 * 套上去是**版式结构整个变**，这才是排版模板该给人的直接感受。
 *
 * 骨架按当前令牌实时生成，所以主色一动，卡片底色、边框、装饰一起跟着变，
 * 不用再靠字符串替换去猜哪个颜色是主色。
 */
import { DEFAULT_MP_STYLE, KAI, SANS, SERIF, type MpStyleTokens } from "./mp-style.ts";
import { CONTENT_SLOT, type SkinKind } from "./mp-template.ts";

/** 主色带透明度：直接拼 #rrggbbaa 在老安卓上不认，统一转 rgba */
function fade(hex: string, alpha: number): string {
  const h = (hex || "").trim();
  if (!/^#[0-9a-f]{6}$/i.test(h)) return h;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
}

const sec = (style: string, inner: string) => '<section style="' + style + '">' + inner + "</section>";
const C = CONTENT_SLOT;

type SkinSet = Partial<Record<SkinKind, string>>;

/**
 * 每套模板一个生成函数。参数是当前令牌（用户可能已经改过主色和字号），
 * 所以生成的骨架永远跟主色一致。
 */
type Builder = (tk: MpStyleTokens) => SkinSet;

/* ── 一、墨线：杂志编辑风。细线夹标题、字距拉大、衬线正文 ── */
const ink: Builder = (tk) => {
  const a = tk.h1.color;
  const line = fade(a, 0.28);
  return {
    h1: sec(
      "margin:2.2em 0 1.3em;text-align:center",
      sec(
        "display:inline-block;border-top:1px solid " + a + ";border-bottom:1px solid " + a + ";padding:0.5em 1.6em",
        sec("font-weight:700;color:" + a + ";letter-spacing:5px;line-height:1.7", C),
      ),
    ),
    h2: sec(
      "margin:2em 0 0.9em",
      sec(
        "border-left:3px solid " + a + ";padding-left:11px",
        sec("font-weight:700;color:" + a + ";letter-spacing:2px;line-height:1.6", C),
      ),
    ),
    h3: sec("margin:1.6em 0 0.7em", sec("font-weight:700;color:" + a + ";letter-spacing:1px", "◆ " + C)),
    p: sec("margin:0 0 1.15em", sec("color:" + tk.bodyColor + ";line-height:" + tk.lineHeight, C)),
    quote: sec(
      "margin:2em 0;padding:1em 0;border-top:1px solid " + line + ";border-bottom:1px solid " + line + ";text-align:center",
      sec("color:#6b6b6b;font-family:" + SERIF + ";letter-spacing:0.5px;line-height:1.9", "「" + C + "」"),
    ),
    hr: sec("margin:2.4em 0;text-align:center", sec("color:" + fade(a, 0.5) + ";letter-spacing:8px", "— ✦ —")),
  };
};

/* ── 二、卡片：主色实心标题条 + 浅底引用卡，最「像设计过」的一套 ── */
const card: Builder = (tk) => {
  const a = tk.h1.color;
  const soft = fade(a, 0.07);
  return {
    h1: sec(
      "margin:2em 0 1.2em",
      sec(
        "display:inline-block;background:" + a + ";border-radius:5px;padding:0.38em 0.95em",
        sec("font-weight:700;color:#ffffff;letter-spacing:1.5px;line-height:1.6", C),
      ),
    ),
    h2: sec(
      "margin:1.9em 0 0.9em",
      sec(
        "background:" + soft + ";border-left:4px solid " + a + ";border-radius:0 5px 5px 0;padding:0.5em 0.8em",
        sec("font-weight:700;color:" + a + ";letter-spacing:1px;line-height:1.6", C),
      ),
    ),
    h3: sec(
      "margin:1.5em 0 0.7em",
      sec("font-weight:700;color:" + a, sec("border-bottom:2px solid " + fade(a, 0.35) + ";padding-bottom:3px", C)),
    ),
    p: sec(
      "margin:0 0 1em;border-left:2px solid " + fade(a, 0.22) + ";padding-left:0.8em",
      sec("color:" + tk.bodyColor + ";line-height:" + tk.lineHeight, C),
    ),
    quote: sec(
      "margin:1.8em 0;background:" + soft + ";border-radius:8px;padding:1em 1.1em",
      sec("color:#5b5b5b;line-height:1.9", '<span style="color:' + fade(a, 0.45) + ';font-weight:700">“</span>' + C),
    ),
    hr: sec("margin:2.2em 0;text-align:center", sec("width:36px;height:3px;background:" + fade(a, 0.35) + ";border-radius:2px;display:inline-block", "")),
  };
};

/* ── 三、公文：黑体居中、红头双线、首行缩进，政务号最常见 ── */
const gov: Builder = (tk) => {
  const a = tk.h1.color;
  return {
    h1: sec(
      "margin:2em 0 1.4em;text-align:center",
      sec("font-weight:700;color:" + a + ";letter-spacing:2px;line-height:1.7", C) +
        sec("margin-top:0.5em;border-top:2px solid " + a + ";border-bottom:1px solid " + fade(a, 0.45) + ";height:3px", ""),
    ),
    h2: sec(
      "margin:1.8em 0 0.8em",
      sec("font-weight:700;color:" + a + ";letter-spacing:1px;line-height:1.7", "【" + C + "】"),
    ),
    h3: sec("margin:1.5em 0 0.7em", sec("font-weight:700;color:" + tk.bodyColor, C)),
    p: sec("margin:0 0 0.9em", sec("color:" + tk.bodyColor + ";line-height:" + tk.lineHeight + ";text-indent:2em;text-align:justify", C)),
    quote: sec(
      "margin:1.6em 0;background:#f7f7f7;border-left:3px solid " + a + ";padding:0.9em 1em",
      sec("color:#5a5a5a;line-height:1.85", C),
    ),
    hr: sec("margin:2em 0", sec("border-top:1px solid " + fade(a, 0.3) + ";height:1px", "")),
  };
};

/* ── 四、便签：荧光笔标题 + 圆点段落 + 虚线框引用，手账感 ── */
const note: Builder = (tk) => {
  const a = tk.h1.color;
  const dot = fade(a, 0.85);
  return {
    h1: sec(
      "margin:2em 0 1.1em",
      sec(
        "background:linear-gradient(to top," + fade(a, 0.28) + " 42%,transparent 42%)",
        sec("display:inline-block;padding:0 0.15em;font-weight:700;color:" + a + ";letter-spacing:1px;line-height:1.7", C),
      ),
    ),
    h2: sec(
      "margin:1.8em 0 0.9em",
      sec(
        "display:inline-block;background:" + a + ";border-radius:3px;padding:0.3em 0.7em 0.35em;box-shadow:2px 2px 0 " + fade(a, 0.25),
        sec("font-weight:700;color:#ffffff;letter-spacing:1px;line-height:1.5", C),
      ),
    ),
    h3: sec(
      "margin:1.5em 0 0.7em",
      sec("font-weight:700;color:" + a + ";border-bottom:2px dashed " + fade(a, 0.45) + ";display:inline-block;padding-bottom:2px", C),
    ),
    p: sec(
      "margin:0 0 1em",
      '<table style="width:100%;border-collapse:collapse"><tbody><tr>' +
        '<td style="width:13px;vertical-align:top;padding-top:0.62em"><section style="width:6px;height:6px;border-radius:50%;background:' + dot + '"></section></td>' +
        '<td style="color:' + tk.bodyColor + ';line-height:' + tk.lineHeight + '">' + C + "</td>" +
        "</tr></tbody></table>",
    ),
    quote: sec(
      "margin:1.8em 0;border:1px dashed " + fade(a, 0.55) + ";border-radius:6px;padding:0.9em 1em;background:#fffdf8",
      sec("color:#6b5f4b;line-height:1.85", C),
    ),
    hr: sec("margin:2.2em 0;text-align:center", sec("color:" + fade(a, 0.6) + ";letter-spacing:7px;font-size:18px;line-height:1", "· · ·")),
  };
};

/* ── 五、科技：编号胶囊标题 + 左侧渐变条引用 ── */
const tech: Builder = (tk) => {
  const a = tk.h1.color;
  return {
    h1: sec(
      "margin:2em 0 1.2em;border-bottom:2px solid " + fade(a, 0.2),
      sec(
        "display:inline-block;border-bottom:2px solid " + a + ";margin-bottom:-2px;padding-bottom:0.35em",
        sec("font-weight:700;color:" + a + ";letter-spacing:1.5px;line-height:1.6", C),
      ),
    ),
    h2: sec(
      "margin:1.9em 0 0.9em",
      '<table style="border-collapse:collapse"><tbody><tr>' +
        '<td style="vertical-align:middle;padding-right:9px"><section style="background:' + a + ";color:#fff;border-radius:4px;padding:1px 8px;font-size:12px;line-height:1.7\">" + "▍" + "</section></td>" +
        '<td style="vertical-align:middle;font-weight:700;color:' + a + ';letter-spacing:1px;line-height:1.6">' + C + "</td>" +
        "</tr></tbody></table>",
    ),
    h3: sec(
      "margin:1.5em 0 0.7em",
      sec("border-left:3px solid " + a + ";padding-left:9px;font-weight:700;color:" + a + ";line-height:1.6", C),
    ),
    p: sec(
      "margin:0 0 1em;border-left:2px solid " + fade(a, 0.16) + ";padding-left:0.75em",
      sec("color:" + tk.bodyColor + ";line-height:" + tk.lineHeight, C),
    ),
    quote: sec(
      "margin:1.8em 0;background:" + fade(a, 0.06) + ";border-left:3px solid " + a + ";border-radius:0 6px 6px 0;padding:0.9em 1.05em",
      sec("color:#4a5568;line-height:1.85", C),
    ),
    hr: sec("margin:2.2em 0", sec("height:2px;border-radius:1px;background:linear-gradient(to right," + fade(a, 0.05) + "," + fade(a, 0.5) + "," + fade(a, 0.05) + ")", "")),
  };
};

/* ── 六、文艺：楷体、三角装饰、米色引用，文化类账号 ── */
const literary: Builder = (tk) => {
  const a = tk.h1.color;
  return {
    h1: sec(
      "margin:2.2em 0 1.3em;text-align:center",
      sec("color:" + fade(a, 0.55) + ";letter-spacing:4px;line-height:1", "◆　◆　◆") +
        sec("margin:0.7em 0 0.6em;font-weight:700;color:" + a + ";letter-spacing:3px;line-height:1.7", C) +
        sec("color:" + fade(a, 0.4) + ";letter-spacing:3px;line-height:1", "——　——"),
    ),
    h2: sec(
      "margin:1.9em 0 0.9em",
      sec("font-weight:700;color:" + a + ";letter-spacing:2px;line-height:1.7", "◆ " + C),
    ),
    h3: sec("margin:1.5em 0 0.7em", sec("font-weight:700;color:" + a + ";letter-spacing:1px", "❖ " + C)),
    p: sec("margin:0 0 1.05em", sec("color:" + tk.bodyColor + ";line-height:" + tk.lineHeight + ";text-indent:2em;letter-spacing:1px", C)),
    quote: sec(
      "margin:1.9em 0;background:#faf6ee;border-radius:4px;padding:1em 1.2em;text-align:center",
      sec("color:#6b5a45;line-height:1.95;letter-spacing:1px", "「" + C + "」"),
    ),
    hr: sec("margin:2.3em 0;text-align:center", sec("color:" + fade(a, 0.55) + ";letter-spacing:6px", "❉　❉　❉")),
  };
};

const BUILDERS: Record<string, Builder> = { ink, card, gov, note, tech, literary };

export const BUILTIN_IDS = ["ink", "card", "gov", "note", "tech", "literary"] as const;

/** 按当前令牌生成六类骨架。builtin 为未知值时返回空，调用方会退回纯样式路径 */
export function buildBuiltinSkins(id: string, tk: MpStyleTokens): SkinSet {
  const fn = BUILDERS[id];
  return fn ? fn(tk) : {};
}

const base = DEFAULT_MP_STYLE;

/** 合并一套模板自己的令牌；缺的字段用默认值兜底，保证渲染时不缺值 */
const tk = (p: Partial<MpStyleTokens> & { name: string }): MpStyleTokens => ({
  ...base,
  ...p,
  h1: { ...base.h1, ...(p.h1 || {}) },
  h2: { ...base.h2, ...(p.h2 || {}) },
  h3: { ...base.h3, ...(p.h3 || {}) },
  quote: { ...base.quote, ...(p.quote || {}) },
  table: { ...base.table, ...(p.table || {}) },
  code: { ...base.code, ...(p.code || {}) },
  divider: { ...base.divider, ...(p.divider || {}) },
});

export interface BuiltinTemplate {
  /** 内部 id，同时是骨架生成器名 */
  id: string;
  tokens: MpStyleTokens;
}

/**
 * 六套内置模板。
 * 名字短（列表里一行放得下），描述写清「套上去哪里会变」，方便挑。
 */
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: "ink",
    tokens: tk({
      name: "墨线",
      fontFamily: SERIF,
      bodySize: 16,
      bodyColor: "#2b2b2b",
      lineHeight: 2,
      paraGap: 1.15,
      letterSpacing: 1.1,
      h1: { size: 21, color: "#1a1a1a", weight: 700, bar: 0 },
      h2: { size: 18, color: "#1a1a1a", weight: 700, bar: 0 },
      h3: { size: 16, color: "#3a3a3a", weight: 700, bar: 0 },
      strongColor: "#1a1a1a",
      linkColor: "#7a6247",
      quote: { bg: "#ffffff", borderColor: "#1a1a1a", color: "#6b6b6b", radius: 0 },
      table: { headBg: "#1a1a1a", headColor: "#ffffff", borderColor: "#e2ded8", stripe: "#faf9f7", radius: 0 },
      divider: { color: "#cfcac3", dashed: false },
    }),
  },
  {
    id: "card",
    tokens: tk({
      name: "卡片",
      fontFamily: SANS,
      bodySize: 16,
      bodyColor: "#333333",
      lineHeight: 1.9,
      paraGap: 1.15,
      letterSpacing: 0.6,
      h1: { size: 20, color: "#e0553d", weight: 700, bar: 0 },
      h2: { size: 18, color: "#e0553d", weight: 700, bar: 0 },
      h3: { size: 16, color: "#e0553d", weight: 700, bar: 0 },
      strongColor: "#e0553d",
      linkColor: "#e0553d",
      quote: { bg: "#fdf2ef", borderColor: "#e0553d", color: "#5b5b5b", radius: 8 },
      table: { headBg: "#e0553d", headColor: "#ffffff", borderColor: "#f2ddd7", stripe: "#fdf6f4", radius: 8 },
      divider: { color: "#f0c8bd", dashed: false },
    }),
  },
  {
    id: "gov",
    tokens: tk({
      name: "公文",
      fontFamily: SANS,
      bodySize: 16,
      bodyColor: "#1a1a1a",
      lineHeight: 1.9,
      paraGap: 0.9,
      letterSpacing: 0.3,
      h1: { size: 20, color: "#b01c24", weight: 700, bar: 0, center: true },
      h2: { size: 17, color: "#b01c24", weight: 700, bar: 0 },
      h3: { size: 16, color: "#1a1a1a", weight: 700, bar: 0 },
      strongColor: "#b01c24",
      linkColor: "#b01c24",
      quote: { bg: "#f7f7f7", borderColor: "#b01c24", color: "#5a5a5a", radius: 0 },
      table: { headBg: "#b01c24", headColor: "#ffffff", borderColor: "#e6e6e6", stripe: "#fafafa", radius: 0 },
      divider: { color: "#d9d9d9", dashed: false },
    }),
  },
  {
    id: "note",
    tokens: tk({
      name: "便签",
      fontFamily: SANS,
      bodySize: 16,
      bodyColor: "#4a4030",
      lineHeight: 1.9,
      paraGap: 1,
      letterSpacing: 0.5,
      h1: { size: 20, color: "#c9781a", weight: 700, bar: 0 },
      h2: { size: 17, color: "#c9781a", weight: 700, bar: 0 },
      h3: { size: 16, color: "#a5651a", weight: 700, bar: 0 },
      strongColor: "#c9781a",
      linkColor: "#c9781a",
      quote: { bg: "#fffdf8", borderColor: "#e0b083", color: "#6b5f4b", radius: 6 },
      table: { headBg: "#c9781a", headColor: "#ffffff", borderColor: "#f0dfc8", stripe: "#fffdf8", radius: 6 },
      divider: { color: "#e8d3b8", dashed: true },
    }),
  },
  {
    id: "tech",
    tokens: tk({
      name: "科技",
      fontFamily: SANS,
      bodySize: 15,
      bodyColor: "#2a3242",
      lineHeight: 1.9,
      paraGap: 1.1,
      letterSpacing: 0.4,
      h1: { size: 20, color: "#3b6ef0", weight: 700, bar: 0 },
      h2: { size: 17, color: "#3b6ef0", weight: 700, bar: 0 },
      h3: { size: 16, color: "#3b6ef0", weight: 700, bar: 0 },
      strongColor: "#3b6ef0",
      linkColor: "#3b6ef0",
      quote: { bg: "#f2f5ff", borderColor: "#3b6ef0", color: "#4a5568", radius: 6 },
      table: { headBg: "#3b6ef0", headColor: "#ffffff", borderColor: "#dbe3f7", stripe: "#f7f9ff", radius: 6 },
      divider: { color: "#c3d0f0", dashed: false },
    }),
  },
  {
    id: "literary",
    tokens: tk({
      name: "文艺",
      fontFamily: KAI,
      bodySize: 17,
      bodyColor: "#3a3226",
      lineHeight: 1.95,
      paraGap: 1.05,
      letterSpacing: 1,
      h1: { size: 21, color: "#8a6a3f", weight: 700, bar: 0, center: true },
      h2: { size: 18, color: "#8a6a3f", weight: 700, bar: 0 },
      h3: { size: 16, color: "#9c7a4c", weight: 700, bar: 0 },
      strongColor: "#8a6a3f",
      linkColor: "#9c7a4c",
      quote: { bg: "#faf6ee", borderColor: "#d8c3a0", color: "#6b5a45", radius: 4 },
      table: { headBg: "#8a6a3f", headColor: "#faf6ee", borderColor: "#e6d9c4", stripe: "#fdfaf4", radius: 4 },
      divider: { color: "#ddcdb4", dashed: false },
    }),
  },
];

export const BUILTIN_BY_ID = new Map(BUILTIN_TEMPLATES.map((b) => [b.id, b]));
