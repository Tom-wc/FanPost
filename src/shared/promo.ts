export type PromoSlot = "home" | "about" | "mp";

export const PROMO_SLOTS: Record<PromoSlot, string> = {
  home: "账号页空白处",
  about: "关于页",
  mp: "公众号页",
};

export interface PromoItem {
  id: string;
  slot: PromoSlot;
  title: string;
  desc?: string;
  url: string;
  image?: string;
  ad: boolean;
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  level: "info" | "warning";
  url?: string;
  until?: string;
}

export const DEFAULT_PROMOS: PromoItem[] = [
  { id: "lcofo", slot: "about", title: "发票打印助手", desc: "电子发票批量合并、自动统计、一键打印，免费在线使用", url: "https://lcofo.cn", ad: false },
];

const MAX_ITEMS = 20;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined);
const https = (v: unknown) => {
  const s = str(v, 300);
  if (!s) return undefined;
  try {
    return new URL(s).protocol === "https:" ? s : undefined;
  } catch {
    return undefined;
  }
};

export function parsePromos(raw: unknown): PromoItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PromoItem[] = [];
  for (const r of raw.slice(0, MAX_ITEMS)) {
    if (!isRecord(r)) continue;
    const id = str(r.id, 40);
    const title = str(r.title, 40);
    const url = https(r.url);
    const slot = r.slot === "home" || r.slot === "about" || r.slot === "mp" ? r.slot : undefined;
    if (!id || !title || !url || !slot) continue;
    const desc = str(r.desc, 80);
    const image = https(r.image);
    out.push({ id, slot, title, url, ad: r.ad === true, ...(desc ? { desc } : {}), ...(image ? { image } : {}) });
  }
  return out;
}

export function parseNotices(raw: unknown, now: number): Notice[] {
  if (!Array.isArray(raw)) return [];
  const out: Notice[] = [];
  for (const r of raw.slice(0, MAX_ITEMS)) {
    if (!isRecord(r)) continue;
    const id = str(r.id, 40);
    const title = str(r.title, 60);
    const body = str(r.body, 600) ?? "";
    if (!id || !title) continue;
    const until = str(r.until, 30);
    if (until && !Number.isNaN(Date.parse(until)) && Date.parse(until) < now) continue;
    const url = https(r.url);
    out.push({ id, title, body, level: r.level === "warning" ? "warning" : "info", ...(url ? { url } : {}), ...(until ? { until } : {}) });
  }
  return out;
}

export const promosFor = (list: PromoItem[], slot: PromoSlot) => list.filter((p) => p.slot === slot);
