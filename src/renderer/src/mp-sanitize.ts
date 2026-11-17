import DOMPurify from "dompurify";
import { CONTENT_SLOT, type MpAsset, type MpTemplate, type SkinKind } from "../../shared/mp-template";

const ALLOWED_TAGS = [
  "section", "div", "p", "span", "strong", "b", "em", "i", "u", "s", "del", "mark", "small", "sup", "sub", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li", "figure", "figcaption", "pre", "code", "center", "font",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "colgroup", "col", "caption", "img",
];
const ALLOWED_ATTR = ["style", "src", "alt", "width", "height", "colspan", "rowspan", "referrerpolicy"];

export function sanitizeSkinHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false });
}

function cleanSkin(kind: SkinKind, html: string): string | undefined {
  const out = sanitizeSkinHtml(html);
  if (!out.trim()) return undefined;
  if (kind !== "hr" && !out.includes(CONTENT_SLOT)) return undefined;
  return out;
}

export function sanitizeTemplate(t: MpTemplate): MpTemplate {
  const skins: Partial<Record<SkinKind, string>> = {};
  for (const [kind, html] of Object.entries(t.skins || {}) as [SkinKind, string][]) {
    const out = typeof html === "string" ? cleanSkin(kind, html) : undefined;
    if (out) skins[kind] = out;
  }
  const assets = (t.assets || [])
    .map((a): MpAsset | undefined => {
      const out = cleanSkin(a.kind, a.html);
      return out ? { ...a, html: out } : undefined;
    })
    .filter((a): a is MpAsset => Boolean(a));
  const { assets: _drop, ...rest } = t;
  return { ...rest, skins, ...(assets.length ? { assets } : {}) };
}
