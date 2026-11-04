export const NOTE_TEXT_MAX = 1000;
export const NOTE_IMAGE_MAX = 18;
export const BATCH_ROWS_MAX = 100;
export const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
export const TEXT_EXT = /\.(txt|md)$/i;

export interface NoteRow {
  title: string;
  text: string;
  topics: string[];
  images: string[];
}

const HEADERS: Record<keyof NoteRow, string[]> = {
  title: ["标题", "title"],
  text: ["正文", "文案", "内容", "描述", "text", "content"],
  topics: ["话题", "标签", "topics", "tags"],
  images: ["图片", "图片路径", "图片文件夹", "images", "image"],
};

const pickColumn = (header: string[], keys: string[]) => header.findIndex((h) => keys.includes(h.trim().toLowerCase()));

export function splitTopics(raw: string) {
  return Array.from(new Set(raw.split(/[#\s,，、;；]+/).map((t) => t.trim()).filter(Boolean))).slice(0, 10);
}

export function splitPaths(raw: string) {
  return raw.split(/[\n;；|]+/).map((p) => p.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

export interface SheetParse {
  rows: Array<Omit<NoteRow, "images"> & { imageRefs: string[] }>;
  error?: string;
}

export const TEMPLATE_ROWS = [
  ["标题", "正文", "话题", "图片"],
  ["周末露营清单", "第一次露营带这几样就够了。\n帐篷选速开款，十分钟搭好。", "露营 户外 周末去哪儿", "露营图片"],
  ["早餐三明治做法", "五分钟搞定的早餐。\n吐司、鸡蛋、生菜就行。", "早餐 快手菜", "早餐/1.jpg;早餐/2.jpg"],
];

const sampleKey = (title: string, text: string) => title.trim() + "|" + text.replace(/\s+/g, "");
const SAMPLE_KEYS = new Set(TEMPLATE_ROWS.slice(1).map((r) => sampleKey(r[0], r[1])));

export function parseSheetRows(table: unknown[][]): SheetParse {
  const header = (table[0] || []).map((c) => String(c ?? ""));
  const col = Object.fromEntries(Object.entries(HEADERS).map(([k, keys]) => [k, pickColumn(header, keys)])) as Record<keyof NoteRow, number>;
  if (col.title < 0 && col.text < 0) return { rows: [], error: "表格第一行要有「标题」或「正文」列" };
  const cell = (row: unknown[], i: number) => (i >= 0 ? String(row[i] ?? "").trim() : "");
  const rows = table
    .slice(1)
    .map((r) => ({ title: cell(r, col.title), text: cell(r, col.text), topics: splitTopics(cell(r, col.topics)), imageRefs: splitPaths(cell(r, col.images)) }))
    .filter((r) => (r.title || r.text) && !SAMPLE_KEYS.has(sampleKey(r.title, r.text)));
  if (!rows.length) return { rows: [], error: "表格里没有内容行" };
  if (rows.length > BATCH_ROWS_MAX) return { rows: [], error: "一次最多导入 " + BATCH_ROWS_MAX + " 行" };
  return { rows };
}

export function noteFromText(raw: string, fallbackTitle: string): Omit<NoteRow, "images"> {
  const lines = raw.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const body = lines.filter(Boolean);
  const first = body[0] || "";
  const hasTitle = first.length <= 30 && body.length > 1;
  const tagLine = body.filter((l) => /^#\S/.test(l)).join(" ");
  const text = (hasTitle ? body.slice(1) : body).filter((l) => !/^#\S/.test(l)).join("\n");
  return { title: hasTitle ? first : fallbackTitle, text, topics: splitTopics(tagLine) };
}

const PARA_SPLIT = /\n+/;

export function shortenForNote(text: string, max = NOTE_TEXT_MAX) {
  const paras = text.split(PARA_SPLIT).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let len = 0;
  for (const p of paras) {
    const n = Array.from(p).length + (out.length ? 1 : 0);
    if (len + n > max) break;
    out.push(p);
    len += n;
  }
  if (!out.length && paras[0]) return Array.from(paras[0]).slice(0, max - 1).join("") + "…";
  return out.join("\n");
}
