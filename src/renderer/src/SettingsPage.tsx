import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { Alert, Button, InputNumber, Select, message } from "antd";
import type { AppData, AppSettings } from "../../shared/types";
import { DEFAULT_SETTINGS, SETTING_LIMITS, SYSTEM_NOTIFY_OPTIONS } from "../../shared/accounts";
import { HISTORY_OPTIONS } from "../../shared/history";
import { LicensePanel } from "./LicensePanel";
import { MpPanel } from "./MpPanel";
import { IpPanel } from "./IpPanel";
import type { LeaveGuard } from "./PublishComposer";

function formatBytes(n: number) {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + " GB";
  if (n >= 1024 ** 2) return Math.round(n / 1024 ** 2) + " MB";
  return Math.round(n / 1024) + " KB";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-card panel">
      <h3>{title}</h3>
      <div className="settings-form">{children}</div>
    </section>
  );
}

export function SettingsPage({ data, setData, guard }: { data: AppData; setData: (d: AppData) => void; guard: RefObject<LeaveGuard | undefined> }) {
  const [form, setForm] = useState<AppSettings>(data.settings);
  const [confirmClear, setConfirmClear] = useState(false);
  const [cacheBytes, setCacheBytes] = useState<number>();
  const [cleaning, setCleaning] = useState(false);
  const loadCache = () => window.fanpost.cacheSize().then(setCacheBytes).catch(() => setCacheBytes(undefined));
  useEffect(() => {
    void loadCache();
  }, []);
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  const save = async () => {
    try {
      setData(await window.fanpost.updateSettings(form));
      message.success("设置已保存");
      return true;
    } catch (error) {
      message.error("保存失败：" + (error instanceof Error ? error.message : String(error)));
      return false;
    }
  };
  useEffect(() => {
    guard.current = {
      isDirty: () => dirty,
      save,
      text: { title: "是否保存设置？", body: "设置有改动还没保存，不保存的话改动会丢掉。", save: "保存设置" },
    };
    return () => {
      guard.current = undefined;
    };
  });
  const cleanCache = async () => {
    setCleaning(true);
    try {
      const r = await window.fanpost.clearCache();
      setCacheBytes(r.after);
      message.success("已清理浏览器缓存，释放约 " + formatBytes(Math.max(0, r.before - r.after)));
    } catch (error) {
      message.error("清理失败：" + (error instanceof Error ? error.message.replace(/^Error invoking remote method [^:]+: (Error: )?/, "") : String(error)));
    } finally {
      setCleaning(false);
    }
  };
  const set = (key: keyof AppSettings) => (v: number | null) => setForm((f) => ({ ...f, [key]: v ?? 0 }));
  const clear = async () => {
    try {
      const r = await window.fanpost.clearHistory();
      setData(r.data);
      setConfirmClear(false);
      message.success(r.removed ? "已清空 " + r.removed + " 条发布记录" : "没有可清空的记录");
    } catch (error) {
      message.error("清空失败：" + (error instanceof Error ? error.message : String(error)));
    }
  };
  const risky = form.samePlatformGapMin < 5;
  const retention = HISTORY_OPTIONS.find((o) => o.value === form.historyRetention) ?? HISTORY_OPTIONS[0];
  const notifyMode = SYSTEM_NOTIFY_OPTIONS.find((o) => o.value === form.systemNotify) ?? SYSTEM_NOTIFY_OPTIONS[0];
  const shrinking = form.historyRetention !== data.settings.historyRetention && form.historyRetention !== "forever";
  return (
    <div className={"settings-page" + (dirty ? " dirty" : "")}>
      <div className="settings-col">
        <Section title="发布">
          <label className="setting-row">
            <span>
              <b>图文同时填写</b>
              <small>不同平台同时填写的账号数，多了占内存</small>
            </span>
            <InputNumber min={SETTING_LIMITS.concurrency.min} max={SETTING_LIMITS.concurrency.max} value={form.imageConcurrency} onChange={set("imageConcurrency")} suffix="个" />
          </label>
          <label className="setting-row">
            <span>
              <b>视频同时填写</b>
              <small>视频要占上传带宽，网络慢时调小，避免上传超时</small>
            </span>
            <InputNumber min={SETTING_LIMITS.concurrency.min} max={SETTING_LIMITS.concurrency.max} value={form.videoConcurrency} onChange={set("videoConcurrency")} suffix="个" />
          </label>
          <label className="setting-row">
            <span>
              <b>同平台账号错开</b>
              <small>同一平台的多个账号，前后两次填写至少间隔这么久</small>
            </span>
            <InputNumber min={SETTING_LIMITS.samePlatformGapMin.min} max={SETTING_LIMITS.samePlatformGapMin.max} value={form.samePlatformGapMin} onChange={set("samePlatformGapMin")} suffix="分钟" />
          </label>
          {risky && <small className="setting-warn">错开太短，平台更容易把多个账号识别为同一人批量操作。是否调整由你决定。</small>}
          <button
            type="button"
            className="link-btn muted"
            onClick={() => setForm({ ...DEFAULT_SETTINGS, historyRetention: form.historyRetention, systemNotify: form.systemNotify })}
          >
            恢复默认（图文 {DEFAULT_SETTINGS.imageConcurrency} 个、视频 {DEFAULT_SETTINGS.videoConcurrency} 个同时填写，同平台错开 {DEFAULT_SETTINGS.samePlatformGapMin} 分钟）
          </button>
        </Section>
        <Section title="提醒">
          <label className="setting-row">
            <span>
              <b>系统通知</b>
              <small>{notifyMode.hint}。软件窗口在前台时不弹</small>
            </span>
            <Select className="setting-select" value={form.systemNotify} options={SYSTEM_NOTIFY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => setForm((f) => ({ ...f, systemNotify: v }))} />
          </label>
        </Section>
        <Section title="发布记录">
          <label className="setting-row">
            <span>
              <b>记录保留</b>
              <small>{retention.hint}</small>
            </span>
            <Select className="setting-select" value={form.historyRetention} options={HISTORY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => setForm((f) => ({ ...f, historyRetention: v }))} />
          </label>
          {shrinking && <Alert type="info" showIcon title="保存后会立即按新规则清理已有记录，正在填写的这一批不受影响。" />}
          <div className="setting-row">
            <span>
              <b>清空发布记录</b>
              <small>本机共 {data.drafts.length} 条。只删记录、自动截的封面和失败截图，不影响账号登录，也不会删你的视频和图片</small>
            </span>
            {confirmClear ? (
              <span className="setting-range">
                <Button size="small" onClick={() => setConfirmClear(false)}>取消</Button>
                <Button size="small" danger type="primary" onClick={() => void clear()}>确认清空</Button>
              </span>
            ) : (
              <Button danger disabled={!data.drafts.length} onClick={() => setConfirmClear(true)}>清空</Button>
            )}
          </div>
        </Section>
        <Section title="存储">
          <div className="setting-row">
            <span>
              <b>浏览器缓存</b>
              <small>
                {cacheBytes === undefined ? "正在统计…" : "当前约 " + formatBytes(cacheBytes)}。账号多了会占几个 GB，清理不会退出登录，也不删发布记录
              </small>
            </span>
            <Button loading={cleaning} disabled={!cacheBytes} onClick={() => void cleanCache()}>清理缓存</Button>
          </div>
        </Section>
      </div>
      <div className="settings-col">
        <Section title="授权">
          <LicensePanel />
        </Section>
        <Section title="公众号">
          <MpPanel />
        </Section>
        <Section title="本机 IP">
          <IpPanel />
        </Section>
      </div>
      {dirty && (
        <div className="settings-savebar">
          <span>设置有改动还没保存</span>
          <Button onClick={() => setForm(data.settings)}>撤销</Button>
          <Button type="primary" onClick={() => void save()}>保存</Button>
        </div>
      )}
    </div>
  );
}
