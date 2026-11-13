/**
 * 纯文本 → 公众号排版块。
 *
 * 公众号作者的习惯和 Markdown 不完全一样：很多人写的是「一、背景」「（一）现状」「【重点】」，
 * 而不是 # / ##。这里两套都认，谁先匹配到算谁。
 */
import {
  MP_STYLES,
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
} from "./mp-style.ts";

export type MpBlock =
  | { type: "h1" | "h2" | "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "quote"; text: string }
  | { type: "ul" | "ol"; items: Array<{ text: string; level: number }> }
  | { type: "hr" }
  | { type: "img"; src: string; alt: string }
  | { type: "code"; lang: string; text: string }
  | { type: "table"; head: string[]; rows: string[][] };

const RE_MD_HEAD = /^(#{1,6})\s+(.+)$/;
const RE_CN_H1 = /^[一二三四五六七八九十]+\s*[、.．]\s*(.+)$/;
const RE_CN_H2 = /^[（(][一二三四五六七八九十]+[)）]\s*(.+)$/;
const RE_BRACKET = /^[【［]\s*(.+?)\s*[】］]$/;
const RE_UL = /^[-*•·]\s+(.+)$/;
const RE_OL = /^(\d+)\s*([.)、．])\s*(.+)$/;
/** 「1.5 亿」「3.14」这种以小数开头的正文，别被序号规则抢走 */
const isDecimal = (line: string) => /^\d+[.．]\d/.test(line);
const RE_QUOTE = /^>\s?(.*)$/;
const RE_HR = /^(?:-{3,}|\*{3,}|_{3,}|—{3,})$/;
const RE_IMG = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const RE_TABLE = /^\|(.+)\|$/;
const RE_TABLE_SEP = /^\|?[\s:|-]+\|?$/;
const RE_FENCE = /^```(\w*)\s*$/;

const indentOf = (line: string) => {
  const m = line.match(/^[\t ]*/);
  return m ? m[0].replace(/\t/g, "  ").length : 0;
};

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** 一行是什么。顺序有讲究：井号标题优先，其次中文序号，最后才是段落 */
export function classify(raw: string): MpBlock | undefined {
  const line = raw.trim();
  if (!line) return undefined;

  const head = line.match(RE_MD_HEAD);
  if (head) {
    const level = head[1]!.length;
    const text = head[2]!.trim();
    return { type: level <= 2 ? "h1" : level === 3 ? "h2" : "h3", text };
  }
  if (RE_HR.test(line)) return { type: "hr" };

  const img = line.match(RE_IMG);
  if (img) return { type: "img", src: img[2]!, alt: img[1]! };

  if (RE_TABLE.test(line) && line.length > 2) return { type: "table", head: cells(line), rows: [] };

  const quote = line.match(RE_QUOTE);
  if (quote) return { type: "quote", text: quote[1]!.trim() };

  const ul = line.match(RE_UL);
  if (ul) return { type: "ul", items: [{ text: ul[1]!.trim(), level: 0 }] };

  const ol = line.match(RE_OL);
  if (ol && !isDecimal(line)) return { type: "ol", items: [{ text: ol[3]!.trim(), level: 0 }] };

  const cn1 = line.match(RE_CN_H1);
  // 「一、」这类整行通常就是个标题；太长的话更可能是正文里的一句，不擅自提升。
  // 序号要留在标题里——中文排版里「一、」「（一）」本身就是层级的一部分，去掉读者会觉得少了东西
  if (cn1 && Array.from(cn1[1]!).length <= 24) return { type: "h1", text: line };

  const cn2 = line.match(RE_CN_H2);
  if (cn2 && Array.from(cn2[1]!).length <= 24) return { type: "h2", text: line };

  const br = line.match(RE_BRACKET);
  if (br) return { type: "h3", text: line };

  return { type: "p", text: line };
}

/** 把整段文本切块；围栏代码块和表格要先吃掉，不能让逐行规则抢走 */
export function parseBlocks(text: string): MpBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: MpBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    const fence = line.match(RE_FENCE);
    if (fence) {
      const lang = fence[1] || "";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !RE_FENCE.test(lines[i]!)) buf.push(lines[i++]!);
      i++; // 跳过收尾的 ```
      out.push({ type: "code", lang, text: buf.join("\n") });
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    if (RE_TABLE.test(line.trim()) && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]!.trim())) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && RE_TABLE.test(lines[i]!.trim())) rows.push(cells(lines[i++]!));
      out.push({ type: "table", head, rows });
      continue;
    }

    const block = classify(line);
    if (!block) {
      i++;
      continue;
    }

    // 连续的同类列表合并成一个 <ul>/<ol>
    if (block.type === "ul" || block.type === "ol") {
      const items = [...block.items];
      const same = block.type;
      let level0 = indentOf(line);
      i++;
      while (i < lines.length) {
        const next = lines[i]!;
        if (!next.trim()) break;
        const c = classify(next);
        if (!c || c.type !== same) break;
        const ind = indentOf(next);
        const level = ind - level0 >= 2 ? 1 : 0;
        if (ind < level0) level0 = ind;
        items.push({ ...c.items[0]!, level });
        i++;
      }
      out.push({ type: same, items });
      continue;
    }

    out.push(block);
    i++;
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CODE_OPEN = "\u0001";
const CODE_CLOSE = "\u0002";

/** 行内标记：先摘出代码片段，转义，再还原粗体/删除线/链接 */
export function inlineHtml(raw: string, tk: MpStyleTokens): string {
  const codes: string[] = [];
  const stripped = raw.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(c);
    return CODE_OPEN + (codes.length - 1) + CODE_CLOSE;
  });

  let html = esc(stripped);

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    const safe = /^(https?:|mailto:)/i.test(url) ? url : "#";
    return '<a href="' + safe + '" style="color:' + tk.linkColor + ';text-decoration:none;border-bottom:1px solid ' + tk.linkColor + '">' + text + "</a>";
  });
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:' + tk.strongColor + ';font-weight:700">$1</strong>');
  html = html.replace(/~~(.+?)~~/g, '<span style="color:#9aa0a6;text-decoration:line-through">$1</span>');
  html = html.replace(/(^|[^<])__(.+?)__/g, '$1<strong style="color:' + tk.strongColor + ';font-weight:700">$2</strong>');

  return html.replace(new RegExp(CODE_OPEN + "(\\d+)" + CODE_CLOSE, "g"), (_m, n: string) => '<code style="' + codeInlineStyle(tk) + '">' + esc(codes[Number(n)] ?? "") + "</code>");
}

export function blockHtml(b: MpBlock, tk: MpStyleTokens): string {
  switch (b.type) {
    case "h1":
    case "h2":
    case "h3":
      return "<h" + b.type.slice(1) + ' style="' + headingStyle(tk, Number(b.type.slice(1)) as 1 | 2 | 3) + '">' + inlineHtml(b.text, tk) + "</h" + b.type.slice(1) + ">";
    case "p":
      return '<p style="' + bodyStyle(tk) + '">' + inlineHtml(b.text, tk) + "</p>";
    case "quote":
      return '<blockquote style="' + quoteStyle(tk) + '">' + inlineHtml(b.text, tk).replace(/\n/g, "<br>") + "</blockquote>";
    case "hr":
      return '<hr style="' + dividerStyle(tk) + '">';
    case "img":
      return '<p style="' + imgBoxStyle(tk) + '"><img src="' + esc(b.src) + '" alt="' + esc(b.alt) + '" data-fp-kind="body" style="' + imgStyle(tk) + '"></p>';
    case "code":
      return '<pre style="' + codeBlockStyle(tk) + '"><code>' + esc(b.text) + "</code></pre>";
    case "ul":
    case "ol": {
      const tag = b.type;
      let html = "<" + tag + ' style="' + listStyle(tk) + '">';
      let level = 0;
      for (const it of b.items) {
        if (it.level > level) {
          html += "<" + tag + ' style="' + listStyle(tk) + "margin:0.3em 0\">";
          level = it.level;
        } else if (it.level < level) {
          while (level > it.level) {
            html += "</" + tag + "></li>";
            level--;
          }
        }
        html += '<li style="' + listItemStyle(tk) + '">' + inlineHtml(it.text, tk) + "</li>";
      }
      while (level >= 0) {
        html += "</" + tag + ">";
        level--;
      }
      return html;
    }
    case "table": {
      const b2 = tk.table;
      let html = '<section style="overflow-x:auto;margin:1.2em 0"><table style="' + tableStyle(tk) + '"><thead><tr>';
      html += b.head.map((c) => '<th style="' + thStyle(tk) + '">' + inlineHtml(c, tk) + "</th>").join("");
      html += "</tr></thead><tbody>";
      b.rows.forEach((row, ri) => {
        const bg = ri % 2 === 1 ? "background:" + b2.stripe + ";" : "";
        html += "<tr>";
        html += row.map((c) => '<td style="' + bg + tdStyle(tk) + '">' + inlineHtml(c, tk) + "</td>").join("");
        html += "</tr>";
      });
      return html + "</tbody></table></section>";
    }
  }
}

/** 纯文本/Markdown → 可直接发出去的整篇 HTML */
export function typesetText(text: string, tk: MpStyleTokens = MP_STYLES[0]!): string {
  const blocks = parseBlocks(text);
  if (!blocks.length) return "";
  return '<section style="' + wrapperStyle(tk) + '">' + blocks.map((b) => blockHtml(b, tk)).join("") + "</section>";
}

/** 段落是否「看起来已经排过版」——用来判断要不要重排整段纯文本 */
export function looksPlain(html: string) {
  const tags = html.match(/<([a-z][a-z0-9]*)/gi) ?? [];
  const styled = /style\s*=/i.test(html);
  const variety = new Set(tags.map((t) => t.toLowerCase())).size;
  return !styled || variety <= 2;
}

export { MP_STYLES };
export type { MpStyleTokens };
