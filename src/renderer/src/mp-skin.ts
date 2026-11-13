/**
 * 把正文内容塞进模板骨架。
 *
 * 和 typesetHtml 的分工：typesetHtml 是「换皮」——不动结构，只把每个元素的 style 换成模板的；
 * 这里是「换骨架」——元素结构按模板来，内容按块搬进去。卡片式标题那种多层 section 才套得出来。
 *
 * 没带骨架的模板仍然走 typesetHtml，那条路更保真（图片、表格不会被打散）。
 */
import { bodyStyle, dividerStyle, headingStyle, quoteStyle, wrapperStyle, type MpStyleTokens } from "../../shared/mp-style.ts";
import { buildBuiltinSkins } from "../../shared/mp-builtin.ts";
import { classify } from "../../shared/mp-typeset.ts";
import { fillSkin, hasSkins, recolorSkin, type MpTemplate, type SkinKind } from "../../shared/mp-template.ts";
import { restyleNode } from "./mp-restyle.ts";

const BLOCK_TAGS = new Set(["SECTION", "DIV", "FIGURE", "ARTICLE"]);
/** 这些块没有骨架，直接套默认样式原样输出 */
const RAW_TAGS = new Set(["UL", "OL", "TABLE", "PRE"]);
const HEAD_TAGS: Record<string, SkinKind> = { H1: "h1", H2: "h2", H3: "h3", H4: "h3", H5: "h3", H6: "h3" };

const isBlock = (el: Element) => /^(P|SECTION|DIV|FIGURE|ARTICLE|BLOCKQUOTE|H[1-6]|UL|OL|TABLE|PRE|HR)$/.test(el.tagName);

function styleOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const piece of (el.getAttribute("style") || "").split(";")) {
    const i = piece.indexOf(":");
    if (i < 0) continue;
    const k = piece.slice(0, i).trim().toLowerCase();
    const v = piece.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

/**
 * 一条「线」：公众号作者很少用 <hr>，分割线一般是 height:1px 加个底色的小 section。
 * 这种块没有文字，不特殊认一下就会被当成空块丢掉。
 */
function looksLikeDivider(el: Element): boolean {
  if (el.tagName === "HR") return true;
  if (el.children.length) return false;
  const st = styleOf(el);
  const line = st["border-top"] || st["border-bottom"] || st["background"] || st["background-color"] || st["background-image"];
  if (!line) return false;
  const h = parseFloat(st["height"] || "0");
  return Number.isFinite(h) && h <= 4;
}

/** 正文根的直接子块；外面只包了一层大 section 时下钻，最多四层 */
function pickBlocks(root: Element): Element[] {
  let blocks = [...root.children];
  for (let i = 0; i < 4; i++) {
    if (blocks.length !== 1 || !BLOCK_TAGS.has(blocks[0]!.tagName)) break;
    const inner = [...blocks[0]!.children].filter(isBlock);
    if (!inner.length) break;
    blocks = inner;
  }
  return blocks;
}

/** 判断这一块该用哪种骨架：先看上次套模板留下的记号，再看标签，再看文字（「一、」「（一）」也算标题） */
function kindOf(el: Element, text: string): SkinKind {
  const hint = el.getAttribute("data-fp-kind") as SkinKind | null;
  if (hint && hint !== "hr") return hint;
  const byTag = HEAD_TAGS[el.tagName];
  if (byTag) return byTag;
  if (el.tagName === "BLOCKQUOTE") return "quote";
  if (el.tagName === "HR") return "hr";
  const b = classify(text);
  if (b && (b.type === "h1" || b.type === "h2" || b.type === "h3" || b.type === "quote" || b.type === "hr")) return b.type;
  return "p";
}

function defaultHtml(kind: SkinKind, tk: MpStyleTokens, content: string): string {
  switch (kind) {
    case "h1":
    case "h2":
    case "h3": {
      const level = Number(kind.slice(1)) as 1 | 2 | 3;
      return "<h" + level + ' style="' + headingStyle(tk, level) + '">' + content + "</h" + level + ">";
    }
    case "quote":
      return '<blockquote style="' + quoteStyle(tk) + '">' + content + "</blockquote>";
    case "hr":
      return '<hr style="' + dividerStyle(tk) + '">';
    default:
      return '<p style="' + bodyStyle(tk) + '">' + content + "</p>";
  }
}

/**
 * 取这一块的内容 HTML。
 * 骨架里已经有的装饰（竖条、圆点，通常是样式字符串完全一样的无字元素）要从内容里去掉，
 * 否则「用正文现在的版式」再套回去时，竖条会叠成两根。
 */
function contentOf(el: Element, skin: string): string {
  const holder = el.cloneNode(true) as Element;
  for (const node of [...holder.querySelectorAll("*")]) {
    const style = node.getAttribute("style");
    if (!style || !skin.includes(style)) continue;
    if (Array.from((node.textContent || "").replace(/\s+/g, "")).length <= 2) node.remove();
  }
  return holder.innerHTML;
}

/** 从一段 style 值里取第一个能解析的颜色（hex、rgb()、渐变里第一个色标都算） */
function colorOf(v: string): string | undefined {
  const hex = v.match(/#[0-9a-f]{3,8}\b/i);
  if (hex) return hex[0];
  const rgb = v.match(/rgba?\([^)]+\)/i);
  if (rgb) return rgb[0];
  return undefined;
}

/** 0 黑 1 白；解析不了返回 undefined */
function lumOf(c: string): number | undefined {
  const h = c.trim();
  let r: number;
  let g: number;
  let b: number;
  if (/^#[0-9a-f]{6}$/i.test(h)) {
    r = parseInt(h.slice(1, 3), 16);
    g = parseInt(h.slice(3, 5), 16);
    b = parseInt(h.slice(5, 7), 16);
  } else if (/^#[0-9a-f]{3}$/i.test(h)) {
    r = parseInt(h[1]! + h[1], 16);
    g = parseInt(h[2]! + h[2], 16);
    b = parseInt(h[3]! + h[3], 16);
  } else {
    const m = h.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (!m) return undefined;
    r = Number(m[1]);
    g = Number(m[2]);
    b = Number(m[3]);
  }
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * 找「正文文字实际压在什么底色上」。
 *
 * 不能取骨架里最深的那个底色：一套模板常有外框色、内层卡底色、角标色好几种，
 * 最深的是边框不是背景，按它算会把白字补到浅色卡片上。这里从文字节点往上找
 * 最近的那个有色祖先，那才是真正垫在字底下的颜色。
 */
function textLum(root: Element): number | undefined {
  const texts: Text[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3 && (n.textContent || "").trim()) texts.push(n as Text);
    for (const c of [...n.childNodes]) walk(c);
  };
  walk(root);
  if (!texts.length) return undefined;
  const host = texts.sort((a, b) => (b.textContent || "").length - (a.textContent || "").length)[0]!;
  let n: Element | null = host.parentElement;
  while (n) {
    const st = styleOf(n);
    const bg = st.background || st["background-color"] || st["background-image"];
    if (bg && !/^\s*(none|transparent|initial)\s*$/i.test(bg)) {
      const c = colorOf(bg);
      const lum = c ? lumOf(c) : undefined;
      if (lum !== undefined) return lum;
    }
    if (n === root) break;
    n = n.parentElement;
  }
  return undefined;
}

/**
 * 令牌该往骨架根节点上补哪些属性。
 *
 * 分工：字号和行高归旋钮（用户拖了就得变），颜色、字重、字距、缩进归设计
 * （骨架自己写了就听骨架的）。如果颜色也一律用令牌覆盖，「主色实心标题条」
 * 那种骨架会变成主色底配主色字，直接看不见；「公文」「文艺」写死的首行缩进
 * 也会被令牌的缩进开关抹掉。
 *
 * forcedColor 是「骨架压在有色底上」时算出来的字色：深底配白字、中等底配近黑。
 */
function textPatch(tk: MpStyleTokens, kind: SkinKind, st: Record<string, string>, forcedColor?: string): string[] {
  const out: string[] = [];
  if (kind === "p" || kind === "quote") {
    out.push("font-size:" + tk.bodySize + "px", "line-height:" + tk.lineHeight);
    if (!st.color) out.push("color:" + (forcedColor || (kind === "p" ? tk.bodyColor : tk.quote.color)));
    if (kind === "p" && tk.indent && !st["text-indent"]) out.push("text-indent:2em");
  } else {
    const level = kind === "h1" ? 1 : kind === "h2" ? 2 : 3;
    const h = level === 1 ? tk.h1 : level === 2 ? tk.h2 : tk.h3;
    out.push("font-size:" + h.size + "px");
    if (!st["line-height"]) out.push("line-height:1.5");
    if (!st.color) out.push("color:" + (forcedColor || h.color));
    if (!st["font-weight"]) out.push("font-weight:" + (h.weight || 700));
  }
  if (!st["letter-spacing"]) out.push("letter-spacing:" + tk.letterSpacing + "px");
  return out;
}

/**
 * 骨架只带结构，字号颜色由令牌决定。
 * 把令牌的字体样式并到骨架的根节点上——不额外包一层，避免反复套用时越套越深。
 * 骨架自己没写外边距的（多数删除线卡片就是这样），补一个默认段距，否则段落会粘在一起。
 */
function withTextStyle(html: string, kind: SkinKind, tk: MpStyleTokens): string {
  if (kind === "hr") return html;
  const doc = new DOMParser().parseFromString('<div id="s">' + html + "</div>", "text/html");
  const root = doc.getElementById("s")?.firstElementChild as Element | null;
  if (!root) return html;
  const own = root.getAttribute("style") || "";
  const st = styleOf(root);
  const hasMargin = st.margin || st["margin-top"] || st["margin-bottom"];
  const margin = hasMargin ? "" : kind === "p" ? "margin:0 0 " + tk.paraGap + "em 0" : kind === "quote" ? "margin:1.2em 0" : "margin:1.4em 0 0.7em";
  // 骨架里只要有明显的有色底，字色就得按底色定，不能照搬令牌
  const fill = textLum(root);
  const forced = fill === undefined || fill >= 0.85 ? undefined : fill < 0.55 ? "#ffffff" : "#1f1f1f";
  root.setAttribute("style", [own, margin, ...textPatch(tk, kind, st, forced)].filter(Boolean).join(";"));
  // 留个记号：换模板或重套时靠它把旧骨架拆掉，不然卡片会一层套一层
  root.setAttribute("data-fp", "skin");
  root.setAttribute("data-fp-kind", kind);
  return root.outerHTML;
}

/**
 * 把上一次套模板留下的骨架拆回「一块一块的正文」。
 * 一路往下找到「文字全都落在它身上」的最深一层，外层卡片、竖条、垫高的空壳统统丢掉；
 * 块的种类（标题 / 引用 / 段落）用 data-fp-kind 记住，拆完还认得出。
 */
function flattenPrev(root: Element) {
  const textLen = (el: Element) => (el.textContent || "").replace(/\s+/g, "").length;
  for (const el of [...root.querySelectorAll('[data-fp="skin"]')]) {
    if (!el.isConnected) continue;
    const kind = el.getAttribute("data-fp-kind") || "p";
    let host = el;
    for (let i = 0; i < 12; i++) {
      const total = textLen(host);
      const only = [...host.children].filter((k) => isBlock(k) && textLen(k) === total);
      if (only.length !== 1) break;
      host = only[0]!;
    }
    const fresh = el.ownerDocument.createElement("section");
    fresh.innerHTML = host === el ? el.innerHTML : host.innerHTML;
    fresh.setAttribute("data-fp-kind", kind);
    el.replaceWith(fresh);
  }
}

function renderBlock(el: Element, tpl: MpTemplate, skins: Partial<Record<SkinKind, string>>, tk: MpStyleTokens): string {
  // 容器里还嵌着块：继续拆，别把一整段包进一个段落骨架里
  if (BLOCK_TAGS.has(el.tagName)) {
    const inner = [...el.children].filter(isBlock);
    if (inner.length) return inner.map((c) => renderBlock(c, tpl, skins, tk)).join("");
  }

  if (RAW_TAGS.has(el.tagName)) {
    const node = el.cloneNode(true) as Element;
    restyleNode(node, tk);
    return node.outerHTML;
  }

  const text = (el.textContent || "").replace(/[\s\u00a0\u3000]+/g, " ").trim();
  const hasImg = Boolean(el.querySelector("img"));

  // 没有文字：分割线照模板画一条，其它空块（占位、空行）直接丢掉
  if (!text) {
    if (looksLikeDivider(el)) {
      const skin = skins.hr;
      return skin ? tintSkin(skin, tpl, tk) : defaultHtml("hr", tk, "");
    }
    if (!hasImg) return "";
  }

  // 只装图片的块原样留着，图片地址不能动
  if (!text && hasImg) {
    const node = el.cloneNode(true) as Element;
    restyleNode(node, tk);
    return node.outerHTML;
  }

  const kind = kindOf(el, text);
  const skin0 = skins[kind];
  if (skin0) {
    // 内容里的装饰是原色，比对要用没改色的骨架；改完色再填内容
    return withTextStyle(fillSkin(tintSkin(skin0, tpl, tk), contentOf(el, skin0)), kind, tk);
  }
  return defaultHtml(kind, tk, el.innerHTML);
}

/**
 * 同款样式的单层嵌套合并掉。
 * 内容和骨架都来自同一篇文章时，文字外面会套两层一模一样的 span，
 * 手机上看着没差别，但富文本里会越滚越深。
 */
function collapseSameStyle(root: Element) {
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const el of [...root.querySelectorAll("*")]) {
      // 原文标签之间的换行缩进会被解析成空白文本节点，判断层级时不算它们
      const kids = [...el.childNodes].filter((n) => n.nodeType !== 3 || (n.textContent || "").trim());
      if (kids.length !== 1 || kids[0]!.nodeType !== 1) continue;
      const only = kids[0] as Element;
      const a = el.getAttribute("style");
      const b = only.getAttribute("style");
      if (!a || !b || a !== b) continue;
      el.replaceWith(only);
      changed = true;
    }
    if (!changed) break;
  }
}

/** 套用带骨架的模板 */
function tintSkin(skin: string, tpl: MpTemplate, tk: MpStyleTokens): string {
  if (tk.h1.color.toLowerCase() === tpl.tokens.h1.color.toLowerCase()) return skin;
  return recolorSkin(skin, tpl.skinAccent || tpl.tokens.h1.color, tk.h1.color);
}

export function applyTemplateHtml(html: string, tpl: MpTemplate, tk: MpStyleTokens = tpl.tokens): string {
  const trimmed = html.trim();
  if (!trimmed) return "";
  const skins = tpl.builtin ? buildBuiltinSkins(tpl.builtin, tk) : tpl.skins;
  if (!Object.values(skins).some((s) => typeof s === "string" && s.trim())) return "";
  const doc = new DOMParser().parseFromString("<div id=r>" + trimmed + "</div>", "text/html");
  const root = doc.getElementById("r")!;
  flattenPrev(root);
  const blocks = pickBlocks(root);
  const parts = blocks.map((el) => renderBlock(el, tpl, skins, tk)).filter(Boolean);
  if (!parts.length) return "";

  const out = new DOMParser().parseFromString('<div id=w><section style="' + wrapperStyle(tk) + '">' + parts.join("") + "</section></div>", "text/html");
  const holder = out.getElementById("w")!;
  collapseSameStyle(holder);
  return holder.innerHTML;
}

/** 模板和正文一起决定用哪条渲染路径 */
export function renderWithTemplate(html: string, tpl: MpTemplate, tk: MpStyleTokens, fallback: (h: string, t: MpStyleTokens) => string): string {
  return hasSkins(tpl) ? applyTemplateHtml(html, tpl, tk) : fallback(html, tk);
}
