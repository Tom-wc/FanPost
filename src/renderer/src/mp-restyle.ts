/**
 * 给「已经有内容的正文」套模板。
 *
 * 和 typesetText 的分工：那个是从纯文本造结构，这个是不动结构、只换皮。
 * 抓来的公众号文章、用户在编辑器里手打的内容都走这里，图片和数据属性一个都不能丢。
 */
import {
  bodyStyle,
  codeBlockStyle,
  codeInlineStyle,
  dividerStyle,
  headingStyle,
  imgBoxStyle,
  imgStyle,
  listItemStyle,
  listStyle,
  quoteStyle,
  tableStyle,
  tdStyle,
  thStyle,
  wrapperStyle,
  type MpStyleTokens,
} from "../../shared/mp-style.ts";
import { parseBlocks, blockHtml } from "../../shared/mp-typeset.ts";

const H_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
/** 这些元素内部有自己的一套块级排版，别进去乱改 */
const SKIP = new Set(["SCRIPT", "STYLE", "IFRAME", "VIDEO", "AUDIO", "TABLE", "PRE", "CODE"]);

/** 从旧 style 里挑出要保留的：文字对齐和图片宽度是作者的决定，不该被模板抹掉 */
function keepFrom(old: string, props: string[]) {
  const out: string[] = [];
  for (const piece of old.split(";")) {
    const [k, ...rest] = piece.split(":");
    const key = (k || "").trim().toLowerCase();
    if (!key || !props.includes(key)) continue;
    const v = rest.join(":").trim();
    if (v) out.push(key + ":" + v);
  }
  return out;
}

function restyleImage(img: HTMLImageElement, tk: MpStyleTokens) {
  const old = img.getAttribute("style") || "";
  const keep = keepFrom(old, ["width", "height", "max-width", "transform"]);
  img.setAttribute("style", [...keep, "border-radius:" + tk.imgRadius + "px", "height:auto"].join(";"));
  if (!img.getAttribute("data-fp-kind")) img.setAttribute("data-fp-kind", "body");
}

/** 裸在容器里的图片，套一层居中段，免得贴着左边缘 */
function wrapLooseImages(root: HTMLElement, tk: MpStyleTokens) {
  for (const img of [...root.querySelectorAll("img")]) {
    const parent = img.parentElement;
    if (!parent || parent === root) {
      const p = root.ownerDocument.createElement("p");
      p.setAttribute("style", imgBoxStyle(tk));
      img.replaceWith(p);
      p.appendChild(img);
      continue;
    }
    // 父级里除了这张图什么都没有（可能带 <br>），也包一层，保证居中一致
    const left = (parent.textContent || "").replace(/[\s\u00a0]/g, "");
    if (!left && parent.tagName !== "P" && parent.tagName !== "A" && parent.children.length <= 1) {
      parent.setAttribute("style", imgBoxStyle(tk));
    }
  }
}

/** <p>a<br>b<br><br>c</p> 拆成多个段，公众号里空行靠段落间距，不靠 <br> */
function splitBrs(root: HTMLElement, tk: MpStyleTokens) {
  const doc = root.ownerDocument;
  for (const p of [...root.querySelectorAll("p")]) {
    if (!p.querySelector("br")) continue;
    if (p.querySelector("img")) continue;
    const groups: Node[][] = [[]];
    for (const node of [...p.childNodes]) {
      if (node.nodeName === "BR") {
        groups.push([]);
        continue;
      }
      groups[groups.length - 1]!.push(node);
    }
    // 只有真拆出两段以上才动，否则白白重建一遍
    const filled = groups.filter((g) => g.some((n) => (n.textContent || "").trim() || n.nodeName === "IMG"));
    if (filled.length < 2) continue;
    for (const group of groups) {
      if (!group.some((n) => (n.textContent || "").trim() || n.nodeName === "IMG")) continue;
      const next = doc.createElement("p");
      next.setAttribute("style", bodyStyle(tk));
      for (const n of group) next.appendChild(n); // 搬原节点，别重建，粗体和链接才不丢
      p.before(next);
    }
    p.remove();
  }
}

/** 给单个元素套样式。骨架模板渲染时也走这里，保证列表、表格、代码块不会两种长相 */
export function restyleNode(node: Element, tk: MpStyleTokens) {
  const tag = node.tagName;

  if (SKIP.has(tag)) {
    if (tag === "TABLE") restyleTable(node as HTMLTableElement, tk);
    if (tag === "PRE") node.setAttribute("style", codeBlockStyle(tk));
    if (tag === "CODE") node.setAttribute("style", codeInlineStyle(tk));
    return;
  }

  if (H_TAGS.has(tag)) {
    const level = tag === "H1" ? 1 : tag === "H2" ? 2 : 3;
    const keep = keepFrom(node.getAttribute("style") || "", ["text-align"]);
    node.setAttribute("style", [...keep, headingStyle(tk, level)].join(";"));
    return;
  }

  if (tag === "P") {
    const keep = keepFrom(node.getAttribute("style") || "", ["text-align"]);
    // 只装图片的段落用图片容器的样式，别给它加段间距那套
    node.setAttribute("style", node.querySelector("img") && !(node.textContent || "").trim() ? imgBoxStyle(tk) : [...keep, bodyStyle(tk)].join(";"));
    for (const img of [...node.querySelectorAll("img")]) restyleImage(img, tk);
    return;
  }

  if (tag === "BLOCKQUOTE") {
    node.setAttribute("style", quoteStyle(tk));
    return;
  }

  if (tag === "UL" || tag === "OL") {
    node.setAttribute("style", listStyle(tk));
    for (const li of [...node.children]) if (li.tagName === "LI") li.setAttribute("style", listItemStyle(tk));
    return;
  }

  if (tag === "HR") {
    node.setAttribute("style", dividerStyle(tk));
    return;
  }

  if (tag === "A") {
    const keep = keepFrom(node.getAttribute("style") || "", ["text-decoration"]);
    node.setAttribute("style", [...keep, "color:" + tk.linkColor, "border-bottom:1px solid " + tk.linkColor + ";text-decoration:none"].join(";"));
    return;
  }

  if (tag === "STRONG" || tag === "B") {
    node.setAttribute("style", "color:" + tk.strongColor + ";font-weight:700");
    return;
  }

  if (tag === "IMG") {
    restyleImage(node as HTMLImageElement, tk);
    return;
  }

  if (tag === "SECTION" || tag === "DIV" || tag === "FIGURE" || tag === "ARTICLE") {
    // 容器只兜字体，不设间距，否则嵌套几层就空了
    node.setAttribute("style", wrapperStyle(tk));
    walk(node, tk);
    return;
  }

  // span 之类：不动它自己的强调色，只补字号继承
  walk(node, tk);
}

function walk(el: Element, tk: MpStyleTokens) {
  for (const node of [...el.children]) restyleNode(node, tk);
}

function restyleTable(table: HTMLTableElement, tk: MpStyleTokens) {
  table.setAttribute("style", tableStyle(tk));
  for (const th of [...table.querySelectorAll("th")]) th.setAttribute("style", thStyle(tk));
  const rows = [...table.querySelectorAll("tbody tr")];
  rows.forEach((tr, ri) => {
    for (const td of [...tr.querySelectorAll("td")]) {
      const bg = ri % 2 === 1 ? "background:" + tk.table.stripe + ";" : "";
      td.setAttribute("style", bg + tdStyle(tk));
    }
  });
}

/** 正文里有没有值得保留的结构（有就不走纯文本重排，免得丢图） */
export function hasStructure(html: string) {
  return /<(h[1-6]|ul|ol|table|blockquote|pre|img|section|figure)\b/i.test(html);
}

/** 把 HTML 抹成纯文本，一行一段；用于「纯段落内容按标题规则重新起结构」 */
export function plainLines(html: string) {
  const doc = new DOMParser().parseFromString("<div id=r>" + html + "</div>", "text/html");
  const root = doc.getElementById("r")!;
  for (const el of [...root.querySelectorAll("p,div,section,li,br,h1,h2,h3,h4")]) el.append("\n");
  return (root.textContent || "")
    .split("\n")
    .map((l) => l.replace(/[\s\u00a0\u3000]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * 主入口：套模板。
 * - 有结构（标题/列表/表格/图）→ 保结构换皮
 * - 纯粹一堆段落 → 先按文本解析出标题层级再排，这样「一、」「（一）」也能自动成标题
 */
export function typesetHtml(html: string, tk: MpStyleTokens): string {
  const trimmed = html.trim();
  if (!trimmed) return "";
  if (!hasStructure(trimmed)) {
    const text = plainLines(trimmed);
    if (!text) return "";
    const blocks = parseBlocks(text);
    if (!blocks.length) return "";
    return '<section style="' + wrapperStyle(tk) + '">' + blocks.map((b) => blockHtml(b, tk)).join("") + "</section>";
  }

  const doc = new DOMParser().parseFromString("<div id=r>" + trimmed + "</div>", "text/html");
  const root = doc.getElementById("r")!;
  walk(root, tk);
  wrapLooseImages(root, tk);
  splitBrs(root, tk);

  // 已经排过一次的内容，外层就是个 section；复用它，别越套越深
  const only = root.children.length === 1 ? root.firstElementChild : null;
  if (only && only.tagName === "SECTION") {
    only.setAttribute("style", wrapperStyle(tk));
    return only.outerHTML;
  }
  return '<section style="' + wrapperStyle(tk) + '">' + root.innerHTML + "</section>";
}
