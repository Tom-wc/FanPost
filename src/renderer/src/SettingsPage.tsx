import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { Alert, Button, InputNumber, Select, Switch, Tag, message } from "antd";
import type { AppData, AppSettings } from "../../shared/types";
import { DEFAULT_SETTINGS, SETTING_LIMITS, SYSTEM_NOTIFY_OPTIONS } from "../../shared/accounts";
import { HISTORY_OPTIONS } from "../../shared/history";
import { platformMap } from "../../shared/platforms";
import type { LeadsSettings } from "../../shared/leads";
import { SCAN_WINDOW_OPTIONS } from "../../shared/leads";
import { LicensePanel } from "./LicensePanel";
import { AddonPanel } from "./AddonPanel";
import { MpPanel } from "./MpPanel";
import { AiSettings } from "./AiSettings";
import { IpPanel } from "./IpPanel";
import { HelpLink } from "./Tutorial";
import type { TutorialTopic } from "../../shared/tutorial";
import type { LeaveGuard } from "./PublishComposer";

function formatBytes(n: number) {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + " GB";
  if (n >= 1024 ** 2) return Math.round(n / 1024 ** 2) + " MB";
  return Math.round(n / 1024) + " KB";
}

const errText = (e: unknown) =>
  String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

function Section({ title, help, children }: { title: string; help?: TutorialTopic; children: ReactNode }) {
  return (
    <section className="settings-card panel">
      <h3>
        {title}
        {help && <HelpLink topic={help} label="" />}
      </h3>
      <div className="settings-form">{children}</div>
    </section>
  );
}

/** 评论区自动回复的两项开关：只在这里改「发不发」，话术和规则仍在评论工作台里管。 */
function LeadsAutoCard({ onGo }: { onGo?: () => void }) {
  const [settings, setSettings] = useState<LeadsSettings>();
  const [saving, setSaving] = useState(false);
  const [counts, setCounts] = useState({ rules: 0, rulesOn: 0, pending: 0 });

  useEffect(() => {
    void window.fanpost
      .getLeads()
      .then((v) => {
        setSettings(v.settings);
        setCounts({
          rules: v.settings.rules.length,
          rulesOn: v.settings.rules.filter((r) => r.enabled).length,
          pending: v.stats.pending,
        });
      })
      .catch(() => undefined);
  }, []);

  const save = async (patch: Partial<LeadsSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    try {
      const r = await window.fanpost.saveLeadsSettings(next);
      setSettings(r.settings);
      message.success("已保存");
    } catch (e) {
      setSettings(settings);
      message.error("保存失败：" + errText(e));
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <small className="muted">正在读取…</small>;
  const windowHint = SCAN_WINDOW_OPTIONS.find((o) => o.value === settings.scanWindow)?.hint || "";
  return (
    <>
      <label className="setting-row">
        <span>
          <b>只收多久以内的评论</b>
          <small>{windowHint}。更早的旧评论抓的时候就挡掉了，回复已经没有意义</small>
        </span>
        <Select
          className="setting-select"
          value={settings.scanWindow}
          options={SCAN_WINDOW_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(v) => void save({ scanWindow: v })}
          disabled={saving}
        />
      </label>
      <label className="setting-row">
        <span>
          <b>允许自动发送</b>
          <small>
            关着的时候，软件只把话术填进回复框，发送按钮留给你点。这是默认状态，也最安全
          </small>
        </span>
        <Switch checked={settings.autoSend} loading={saving} onChange={(v) => void save({ autoSend: v })} />
      </label>
      <label className="setting-row">
        <span>
          <b>两条之间停多久</b>
          <small>同一个账号连续回复的间隔。太短容易被平台判成机器批量操作</small>
        </span>
        <InputNumber
          min={10}
          max={600}
          step={5}
          value={settings.perAccountGapSec}
          onChange={(v) => void save({ perAccountGapSec: v ?? 45 })}
          suffix="秒"
          disabled={saving}
        />
      </label>
      <label className="setting-row">
        <span>
          <b>换号多停多久</b>
          <small>一个号回完、换下一个号时，在上面的间隔之外再多等这么久。几个号轮着动作比一个号连着动作更像批量操作，填 0 表示不多停</small>
        </span>
        <InputNumber
          min={0}
          max={600}
          step={10}
          value={settings.switchAccountGapSec}
          onChange={(v) => void save({ switchAccountGapSec: v ?? 60 })}
          suffix="秒"
          disabled={saving}
        />
      </label>
      <div className="setting-row">
        <span>
          <b>规则与话术</b>
          <small>
            {counts.rules ? `共 ${counts.rules} 条规则，${counts.rulesOn} 条启用；当前 ${counts.pending} 条评论待回复` : "还没有规则，去评论工作台新建一条，命中后才会自动接话"}
          </small>
        </span>
        {onGo && <Button onClick={onGo}>打开评论工作台</Button>}
      </div>
    </>
  );
}

function PlatformCoverage() {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    void window.fanpost
      .getLeads()
      .then((v) => setList(v.available.map((p) => platformMap[p].name)))
      .catch(() => undefined);
  }, []);
  return (
    <>
      <div className="setting-row">
        <span>
          <b>已接入 {list.length} 个平台</b>
          <small>点「抓取评论」时这些平台会一起扫；话术按规则匹配，扫到的都会进待回复</small>
        </span>
      </div>
      <div className="cover-tags">
        {list.length ? list.map((name) => <Tag key={name}>{name}</Tag>) : <Tag>正在读取…</Tag>}
      </div>
      <div className="setting-row">
        <span>
          <b>暂未接入</b>
          <small>
            视频号后台页面渲染不出来、账号又容易掉线；公众号的评论走微信接口，需要先在公众号后台加 IP 白名单并开通留言权限，不在这套浏览器抓取里
          </small>
        </span>
        <Tag>暂不支持</Tag>
      </div>
    </>
  );
}

export function SettingsPage({
  data,
  setData,
  guard,
  onGoLead,
}: {
  data: AppData;
  setData: (d: AppData) => void;
  guard: RefObject<LeaveGuard | undefined>;
  onGoLead?: () => void;
}) {
  const [form, setForm] = useState<AppSettings>(data.settings);
  const [group, setGroup] = useState<"system" | "feature">("system");
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
      message.error("清理失败：" + errText(error));
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
      <div className="settings-switch" role="tablist">
        <button type="button" role="tab" aria-selected={group === "system"} className={group === "system" ? "active" : ""} onClick={() => setGroup("system")}>
          <b>系统设置</b>
          <small>发布节奏 · 提醒 · 记录 · 存储 · 授权</small>
        </button>
        <button type="button" role="tab" aria-selected={group === "feature"} className={group === "feature" ? "active" : ""} onClick={() => setGroup("feature")}>
          <b>功能设置</b>
          <small>AI 写作 · 公众号 · 评论回复</small>
        </button>
      </div>

      {group === "system" ? (
        <div className="settings-grid">
          <div className="settings-col">
            <Section title="发布" help="settings">
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

            <Section title="提醒" help="notify">
              <label className="setting-row">
                <span>
                  <b>系统通知</b>
                  <small>{notifyMode.hint}</small>
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
          </div>

          <div className="settings-col">
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

            <Section title="本机 IP">
              <IpPanel />
            </Section>

            <Section title="授权" help="license">
              <LicensePanel />
            </Section>
          </div>
        </div>
      ) : (
        <div className="settings-grid tiles">
          <Section title="AI 写作">
            <AiSettings />
          </Section>

          <Section title="评论与私信">
            <LeadsAutoCard onGo={onGoLead} />
          </Section>

          <Section title="公众号" help="mp">
            <MpPanel />
          </Section>

          <Section title="平台覆盖">
            <PlatformCoverage />
          </Section>

          <Section title="扩展功能">
            <AddonPanel />
          </Section>
        </div>
      )}

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
