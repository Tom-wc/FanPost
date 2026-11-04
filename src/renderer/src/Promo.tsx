import { useEffect, useState } from "react";
import { Alert, Button, message } from "antd";
import { LinkOutlined } from "@ant-design/icons";
import type { AppInfoView } from "../../shared/app-info";
import { DEFAULT_PROMOS, promosFor, type Notice, type PromoItem, type PromoSlot } from "../../shared/promo";

let cached: AppInfoView | undefined;
let loadedAt = 0;
const listeners = new Set<(v: AppInfoView) => void>();
const STALE_MS = 10 * 60 * 1000;

function reload(force = false) {
  if (!force && cached && Date.now() - loadedAt < STALE_MS) return;
  loadedAt = Date.now();
  void window.fanpost
    .getAppInfo()
    .then(publishAppInfo)
    .catch(() => undefined);
}

if (typeof window !== "undefined") {
  window.addEventListener("focus", () => reload());
  setInterval(() => reload(), STALE_MS);
}

export function useAppInfo() {
  const [info, setInfo] = useState<AppInfoView | undefined>(cached);
  useEffect(() => {
    listeners.add(setInfo);
    reload(!cached);
    return () => void listeners.delete(setInfo);
  }, []);
  return info;
}

export function publishAppInfo(v: AppInfoView) {
  cached = v;
  for (const l of listeners) l(v);
}

export const openUrl = (url: string) => window.fanpost.openUrl(url).catch((e) => message.error(String(e instanceof Error ? e.message : e)));

const promosOf = (info: AppInfoView | undefined) => info?.promos ?? DEFAULT_PROMOS;

export function PromoSlotView({ slot, variant = "list" }: { slot: PromoSlot; variant?: "list" | "strip" }) {
  const list = promosFor(promosOf(useAppInfo()), slot);
  if (!list.length) return null;
  return (
    <div className={"promo promo-" + variant}>
      {list.map((p) => (
        <PromoCard key={p.id} p={p} />
      ))}
    </div>
  );
}

function PromoCard({ p }: { p: PromoItem }) {
  return (
    <button type="button" className="promo-card" onClick={() => void openUrl(p.url)} title={p.url}>
      {p.image ? <img src={p.image} alt="" referrerPolicy="no-referrer" /> : <LinkOutlined className="promo-icon" />}
      <span>
        <b>{p.title}</b>
        {p.desc && <small>{p.desc}</small>}
      </span>
      {p.ad && <em className="promo-tag">推广</em>}
    </button>
  );
}

const DISMISS_KEY = "fp-notice-dismissed";
const readDismissed = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]") as string[];
  } catch {
    return [];
  }
};

export function NoticeBar({ onUpdate }: { onUpdate: () => void }) {
  const info = useAppInfo();
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const notices = (info?.notices ?? []).filter((n) => !dismissed.includes(n.id));
  const showUpdate = !!info?.hasUpdate && !dismissed.includes("update-" + info.latestVersion);
  if (!notices.length && !showUpdate) return null;
  const close = (n: Notice) => {
    const next = [...dismissed, n.id].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      return;
    }
  };
  return (
    <div className="notice-bar">
      {info?.hasUpdate && !dismissed.includes("update-" + info.latestVersion) && (
        <Alert
          type="success"
          showIcon
          closable={{ onClose: () => close({ id: "update-" + info.latestVersion, title: "", body: "", level: "info" }) }}
          title={"新版本 " + info.latestVersion + " 可以更新了"}
          description={info.releaseNotes ? info.releaseNotes.split("\n").filter((l) => l.trim()).slice(0, 2).join("；") : undefined}
          action={<Button size="small" type="primary" onClick={onUpdate}>查看更新</Button>}
        />
      )}
      {notices.map((n) => (
        <Alert
          key={n.id}
          type={n.level}
          showIcon
          closable={{ onClose: () => close(n) }}
          title={n.title}
          description={n.body || undefined}
          action={n.url ? <Button size="small" onClick={() => void openUrl(n.url!)}>查看</Button> : undefined}
        />
      ))}
    </div>
  );
}
