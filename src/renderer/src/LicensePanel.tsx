import { useEffect, useState } from "react";
import { Alert, Button, Input, Modal, Popconfirm, Space, Tag, Typography, message } from "antd";
import { QUOTA_ERROR, TIER_LABELS, TIER_LIMITS, TIER_PRICES, YEAR_PRICES, isPermanent, type LicenseView } from "../../shared/license";
import { platformMap } from "../../shared/platforms";
import type { AppInfoView, AppLinkKey } from "../../shared/app-info";

const UPGRADE_EVENT = "fanpost:upgrade";

const errText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

export function quotaReason(e: unknown) {
  const t = errText(e);
  const i = t.indexOf(QUOTA_ERROR);
  return i >= 0 ? t.slice(i + QUOTA_ERROR.length) : "";
}

export const NEED_LICENSE = "还没有激活授权。激活卡密后才能使用全部功能（添加账号、一键填写和发布、公众号、采集导入）。";

export function requestUpgrade(reason = NEED_LICENSE) {
  window.dispatchEvent(new CustomEvent(UPGRADE_EVENT, { detail: reason }));
}

export async function ensureLicensed() {
  const v = await window.fanpost.getLicense().catch(() => undefined);
  if (v && v.tier !== "none") return true;
  requestUpgrade();
  return false;
}

export function handleQuota(e: unknown) {
  const reason = quotaReason(e);
  if (!reason) return false;
  window.dispatchEvent(new CustomEvent(UPGRADE_EVENT, { detail: reason }));
  return true;
}

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const TRIAL_EXPIRED = "体验已到期，暂时不能使用。购买正式版卡密后在下面输入，点「激活」即可继续，账号和发布记录都还在。";
const YEAR_EXPIRED = "年卡已到期，暂时不能使用。购买新卡密后在下面输入，点「激活」即可续用，账号和发布记录都还在。";

const REASON_TEXT: Record<string, string> = {
  expired: "授权已到期，暂时不能使用。",
  machine: "授权文件和本机不匹配（可能是从别的电脑复制来的），暂时不能使用。请在本机输入卡密激活。",
  stale: "超过 7 天没连上授权服务器，暂时不能使用。联网后点「重新验证」即可恢复。",
  invalid: "授权文件已损坏或被改动，暂时不能使用。请重新输入卡密激活。",
};

export function LicensePanel({ onChanged }: { onChanged?: (v: LicenseView) => void }) {
  const [view, setView] = useState<LicenseView>();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState("");
  const update = (v: LicenseView) => {
    setView(v);
    onChanged?.(v);
  };
  const [links, setLinks] = useState<AppInfoView>();
  const [rules, setRules] = useState<{ ok: boolean; version: string }>();
  const loadRules = () => void window.fanpost.getSafetyRules().then(setRules).catch(() => undefined);
  useEffect(() => {
    void window.fanpost.getLicense().then(update);
    loadRules();
    void window.fanpost.getAppInfo().then(setLinks).catch(() => undefined);
  }, []);
  const open = (k: AppLinkKey) => window.fanpost.openAppLink(k).catch((e) => message.error(errText(e)));
  const act = async (name: string, fn: () => Promise<LicenseView>, ok: string) => {
    setBusy(name);
    try {
      update(await fn());
      loadRules();
      message.success(ok);
    } catch (e) {
      message.error(errText(e));
    } finally {
      setBusy("");
    }
  };
  if (!view) return <Typography.Text type="secondary">正在读取授权…</Typography.Text>;
  const paid = view.tier !== "none";
  const timed = !!view.expiresAt && !isPermanent(view.expiresAt);
  const trial = timed && view.term !== "year";
  const year = timed && view.term === "year";
  const ms = timed ? Math.max(0, Date.parse(view.expiresAt!) - Date.now()) : 0;
  const left = Math.ceil(ms / DAY_MS);
  const leftText = trial && ms <= DAY_MS ? "还剩 " + Math.max(1, Math.ceil(ms / HOUR_MS)) + " 小时" : "还剩 " + left + " 天";
  const reason = view.reason === "expired" && timed ? (year ? YEAR_EXPIRED : TRIAL_EXPIRED) : view.reason && REASON_TEXT[view.reason];
  const activate = () => void act("activate", () => window.fanpost.activateLicense(key), paid ? "已更换卡密" : "激活成功");
  return (
    <div className="license-panel">
      <div className="license-head">
        <b>{paid && trial ? "体验版" : TIER_LABELS[view.tier] + (paid && year ? "（年卡）" : "")}</b>
        <span>{paid ? "每个平台最多 " + view.limit + " 个账号" : "激活卡密后才能添加账号、填写和发布"}</span>
        {paid && <Tag color={view.reason ? "error" : trial || (year && left <= 30) ? "warning" : "success"}>{view.reason ? "暂不可用" : timed ? leftText : "已激活"}</Tag>}
        {paid && timed && <span>到期 {trial ? new Date(view.expiresAt!).toLocaleString("zh-CN", { hour12: false }).slice(0, -3) : view.expiresAt!.slice(0, 10)}</span>}
      </div>
      {reason && <Alert type="warning" showIcon message={reason} />}
      {view.over.length > 0 && (
        <Alert
          type="error"
          showIcon
          message={"当前账号数超出额度：" + view.over.map((o) => platformMap[o.platform].name + " " + o.count + " 个").join("、") + "。超出期间不能填写和发布。"}
        />
      )}
      <div className="license-row">
        <span>本机机器码</span>
        <Typography.Text copyable code>{view.machine}</Typography.Text>
      </div>
      {paid && rules && (
        <div className="license-row">
          <span>安全规则</span>
          {rules.ok ? <Tag color="success">已更新 {rules.version}</Tag> : <Tag color="error">未下载，联网后点「重新验证」</Tag>}
        </div>
      )}
      <Space.Compact className="license-activate">
        <Input placeholder={paid ? "升级时输入新卡密，如 ABCD-EFGH-JKLM-NPQR" : "输入卡密，如 ABCD-EFGH-JKLM-NPQR"} value={key} onChange={(e) => setKey(e.target.value)} onPressEnter={activate} />
        <Button type={paid ? "default" : "primary"} loading={busy === "activate"} disabled={!key.trim()} onClick={activate}>
          {paid ? "更换卡密" : "激活"}
        </Button>
      </Space.Compact>
      <Space wrap>
        {view.keyId && (
          <Button loading={busy === "refresh"} onClick={() => void act("refresh", () => window.fanpost.refreshLicense(), "已重新验证")}>
            重新验证
          </Button>
        )}
        {paid && !trial && (
          <Popconfirm
            title="解绑本机？"
            description="解绑后本机不能再填写和发布，卡密可以拿到新电脑上激活。每个卡密每月最多解绑 2 次。"
            okText="解绑"
            cancelText="取消"
            onConfirm={() => void act("unbind", () => window.fanpost.unbindLicense(), "已解绑本机")}
          >
            <Button danger loading={busy === "unbind"}>解绑本机</Button>
          </Popconfirm>
        )}
      </Space>
      {view.tier !== "studio" && (links?.buyBasicUrl || links?.buyStudioUrl) && (
        <div className="license-buy">
          {(!paid || trial) && links.buyBasicUrl && <Button onClick={() => void open("buyBasicUrl")}>购买基础版卡密</Button>}
          {links.buyStudioUrl && <Button onClick={() => void open("buyStudioUrl")}>{paid && !trial ? "升级到工作室版" : "购买工作室版卡密"}</Button>}
        </div>
      )}
      <Typography.Text type="secondary" className="license-tiers">
        基础版每个平台 {TIER_LIMITS.basic} 个号，{TIER_PRICES.basic} 元永久或 {YEAR_PRICES.basic} 元一年；工作室版每个平台 {TIER_LIMITS.studio} 个号，{TIER_PRICES.studio} 元永久或 {YEAR_PRICES.studio} 元一年。一个卡密只能绑定一台电脑。
      </Typography.Text>
    </div>
  );
}

export function UpgradeModal() {
  const [reason, setReason] = useState("");
  useEffect(() => {
    const on = (e: Event) => setReason((e as CustomEvent<string>).detail);
    window.addEventListener(UPGRADE_EVENT, on);
    return () => window.removeEventListener(UPGRADE_EVENT, on);
  }, []);
  return (
    <Modal title={reason.startsWith("还没有激活") ? "激活后才能使用" : "需要升级授权"} open={!!reason} footer={null} onCancel={() => setReason("")} destroyOnClose>
      <Alert type="error" showIcon message={reason} className="upgrade-reason" />
      <LicensePanel onChanged={(v) => { if (!v.over.length && v.tier !== "none") setReason(""); }} />
    </Modal>
  );
}
