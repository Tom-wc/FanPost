import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { App as AntApp, Button, ConfigProvider, Modal, Popover, message } from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  BgColorsOutlined,
  SettingOutlined,
  InfoCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  HomeOutlined,
  ImportOutlined,
  PictureOutlined,
  PlaySquareOutlined,
  TeamOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
  WechatOutlined,
} from "@ant-design/icons";
import type { Account, AppData, ContentType, Platform, PublishTask, SavedDraft } from "../../shared/types";
import { platformMap, platforms } from "../../shared/platforms";
import { PlatformLogo } from "./PlatformLogo";
import { PublishComposer, type LeaveGuard } from "./PublishComposer";
import { DraftList } from "./DraftList";
import { useLeaveConfirm } from "./LeaveConfirm";
import { draftLabel } from "../../shared/drafts";
import { PublishRecords } from "./PublishRecords";
import { ErrorBoundary } from "./ErrorBoundary";
import { AccountList } from "./AccountList";
import { SettingsPage } from "./SettingsPage";
import { UpgradeModal, handleQuota } from "./LicensePanel";
import { DEFAULT_SETTINGS, accountLabel, countByPlatform } from "../../shared/accounts";
import { NotificationBell, NotificationCenter } from "./NotificationCenter";
import { StatButton, StatPanel, type StatKind } from "./StatPanel";
import { BatchControl } from "./BatchControl";
import { ImportModal } from "./ImportModal";
import { MpPage } from "./MpPage";
import { AboutPage } from "./AboutPage";
import { NoticeBar, PromoSlotView, useAppInfo } from "./Promo";
import { HelpLink, TutorialHost } from "./Tutorial";
import type { TutorialTopic } from "../../shared/tutorial";
import { THEMES, antTheme, applyCssVars, findTheme, loadThemeId, saveThemeId, type ThemeId } from "./theme";
const brandUrl = new URL("./assets/brand.png", import.meta.url).href;

type Page = "accounts" | "image" | "video" | "mp" | "settings" | "about";
const STATS: Array<{ kind: StatKind; label: string; tone: (n: number) => "ok" | "warn" | "bad" | undefined }> = [
  { kind: "online", label: "在线账号", tone: () => "ok" },
  { kind: "offline", label: "已掉线", tone: (n) => (n ? "bad" : undefined) },
  { kind: "waiting", label: "待你点发布", tone: (n) => (n ? "warn" : undefined) },
  { kind: "done", label: "已发布", tone: () => undefined },
];
const empty: AppData = { accounts: [], drafts: [], savedDrafts: [], tasks: [], accountSelections: {}, notifications: [], settings: DEFAULT_SETTINGS, publishLog: [], mpDrafts: [] };
const mpLogoUrl = new URL("./assets/platforms/mp.png", import.meta.url).href;
const ALL_CHANNELS = platforms.length + 1;
const NAV: Array<{ key: Page; label: string; icon: React.ReactNode }> = [
  { key: "accounts", label: "账号", icon: <TeamOutlined /> },
  { key: "image", label: "图文", icon: <PictureOutlined /> },
  { key: "video", label: "视频", icon: <PlaySquareOutlined /> },
  { key: "mp", label: "公众号", icon: <WechatOutlined /> },
];
const PAGE_HELP: Record<Page, TutorialTopic> = { accounts: "accounts", image: "compose", video: "compose", mp: "mp", settings: "settings", about: "start" };
const PAGE_TITLE: Record<Page, { eyebrow: string; title: string }> = {
  accounts: { eyebrow: "ACCOUNTS", title: "账号工作台" },
  image: { eyebrow: "IMAGE · TEXT", title: "图文一键分发" },
  video: { eyebrow: "VIDEO", title: "视频一键分发" },
  mp: { eyebrow: "OFFICIAL ACCOUNT", title: "公众号文章" },
  settings: { eyebrow: "SETTINGS", title: "设置" },
  about: { eyebrow: "ABOUT", title: "关于与免责" },
};

function ThemePicker({ value, onChange, onOverlay }: { value: ThemeId; onChange: (id: ThemeId) => void; onOverlay: (open: boolean) => void }) {
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOverlay(next);
  };
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="rightBottom"
      content={
        <div className="theme-picker" role="listbox" aria-label="界面配色">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={value === t.id}
              className={"theme-option" + (value === t.id ? " active" : "")}
              onClick={() => { onChange(t.id); setOpen(false); }}
            >
              <span className="swatch" style={{ background: t.p.ink }}>
                <i style={{ background: t.p.panel }} />
                <b style={{ background: t.p.accent }} />
              </span>
              <span className="theme-text">
                <b>{t.name}</b>
                <small>{t.hint}</small>
              </span>
              {value === t.id && <CheckOutlined className="theme-check" />}
            </button>
          ))}
        </div>
      }
    >
      <button className="rail-item" aria-label="切换配色">
        <BgColorsOutlined className="glyph" />
        <span className="rail-label">配色</span>
      </button>
    </Popover>
  );
}

function Main({ themeId, setThemeId }: { themeId: ThemeId; setThemeId: (id: ThemeId) => void }) {
  const [data, setData] = useState(empty),
    [page, setPage] = useState<Page>("accounts"),
    [active, setActive] = useState<string>(),
    [tabs, setTabs] = useState<string[]>([]),
    [addOpen, setAddOpen] = useState(false),
    [notifyOpen, setNotifyOpen] = useState(false),
    [statOpen, setStatOpen] = useState<StatKind>(),
    [overlays, setOverlays] = useState<string[]>([]),
    host = useRef<HTMLDivElement>(null),
    guard = useRef<LeaveGuard | undefined>(undefined);
  const leave = useLeaveConfirm(guard);
  const go = async (next: Page) => {
    if (next === page) return true;
    if (!(await leave.confirm())) return false;
    setPage(next);
    return true;
  };
  useEffect(
    () =>
      window.fanpost.onCloseRequest(async () => {
        if (await leave.confirm()) await window.fanpost.confirmClose();
      }),
    [],
  );
  const refresh = () => window.fanpost.getData().then(setData);
  useEffect(() => {
    refresh();
    return window.fanpost.onDataChanged(refresh);
  }, []);
  useEffect(() => window.fanpost.onNotificationOpen(() => setNotifyOpen(true)), []);
  const hasUpdate = !!useAppInfo()?.hasUpdate;
  useEffect(
    () =>
      window.fanpost.onNotification((n) => {
        const show = n.level === "error" ? message.error : n.level === "warning" ? message.warning : n.level === "success" ? message.success : message.info;
        show(n.title, 4);
      }),
    [],
  );
  useEffect(() => {
    if (notifyOpen || statOpen || overlays.length) window.fanpost.hideBrowser();
    else if (page === "accounts" && active) window.fanpost.showBrowser(active);
  }, [notifyOpen, statOpen, overlays.length]);
  const overlay = (key: string) => (open: boolean) => setOverlays((o) => (open ? (o.includes(key) ? o : [...o, key]) : o.filter((x) => x !== key)));
  useEffect(() => {
    window.fanpost
      .getRecovery()
      .then((status) => {
        if (status.warning) message.warning(status.warning, 8);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (page !== "accounts") {
      window.fanpost.hideBrowser();
      setActive(undefined);
    }
  }, [page]);
  useLayoutEffect(() => {
    if (page !== "accounts" || !active) return;
    const update = () => {
      const r = host.current?.getBoundingClientRect();
      if (r) window.fanpost.setBrowserBounds({ x: r.x, y: r.y, width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    if (host.current) ro.observe(host.current);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [page, active]);
  async function choose(a: Account) {
    if (!tabs.includes(a.id)) setTabs([...tabs, a.id]);
    setActive(a.id);
    await window.fanpost.showBrowser(a.id);
  }
  async function closeTab(id: string) {
    await window.fanpost.closeBrowser(id);
    const next = tabs.filter((x) => x !== id);
    setTabs(next);
    if (active === id) {
      const id2 = next.at(-1);
      setActive(id2);
      if (id2) await window.fanpost.showBrowser(id2);
      else await window.fanpost.hideBrowser();
    }
  }
  async function openTask(task: PublishTask) {
    await openTasks([task]);
  }
  async function openTasks(list: PublishTask[], published = false) {
    const picked = list.filter((t, i) => list.findIndex((x) => x.accountId === t.accountId) === i);
    if (!picked.length || !(await go("accounts"))) return;
    for (const t of picked) {
      if (published) await window.fanpost.openPublished(t.id).catch(() => undefined);
      else setData(await window.fanpost.openTask(t.id));
    }
    const ids = picked.map((t) => t.accountId);
    setTabs((cur) => [...cur, ...ids.filter((id) => !cur.includes(id))]);
    setPage("accounts");
    setActive(ids[0]);
    setTimeout(() => window.fanpost.showBrowser(ids[0], "reveal"), 80);
    if (picked.length > 1) message.info("已打开 " + picked.length + " 个账号的页面，点上方标签逐个切换");
  }
  async function add(platform: Platform) {
    let result: AppData;
    try {
      result = await window.fanpost.addAccount({ platform });
    } catch (e) {
      setAddOpen(false);
      if (!handleQuota(e)) message.error(String(e instanceof Error ? e.message : e));
      return;
    }
    const account = result.accounts.at(-1)!;
    setData(result);
    setAddOpen(false);
    await choose(account);
    message.info("请在平台官方页面扫码登录，登录后会自动读取账号名称");
  }
  const showAccount = async (id: string) => {
    const a = data.accounts.find((x) => x.id === id);
    if (!a || !(await go("accounts"))) return;
    void choose(a);
  };
  const online = data.accounts.filter((a) => a.loginStatus === "logged_in").length;
  const offline = data.accounts.filter((a) => a.loginStatus === "logged_out").length;
  const waiting = data.tasks.filter((t) => t.status === "manual_required").length;
  const done = data.tasks.filter((t) => t.status === "success").length;
  const head = PAGE_TITLE[page];
  const statValue: Record<StatKind, number> = { online, offline, waiting, done };
  const accountCounts = countByPlatform(data.accounts);
  const activeAccount = data.accounts.find((a) => a.id === active);
  return (
    <div className="shell">
      <div className="grain" aria-hidden />
      <nav className="rail" aria-label="主导航">
        <div className="rail-brand">
          <img src={brandUrl} alt="浪叉" />
        </div>
        {NAV.map((n) => (
          <button key={n.key} className={"rail-item" + (page === n.key ? " active" : "")} onClick={() => void go(n.key)} aria-current={page === n.key ? "page" : undefined}>
            <span className="glyph" aria-hidden>{n.icon}</span>
            <span className="rail-label">{n.label}</span>
          </button>
        ))}
        <div className="rail-foot">
          <ThemePicker value={themeId} onChange={setThemeId} onOverlay={overlay("theme")} />
          <NotificationBell data={data} onOpen={() => setNotifyOpen(true)} />
          <button className={"rail-item" + (page === "settings" ? " active" : "")} aria-label="设置" aria-current={page === "settings" ? "page" : undefined} onClick={() => void go("settings")}>
            <SettingOutlined className="glyph" />
            <span className="rail-label">设置</span>
          </button>
          <button className={"rail-item" + (page === "about" ? " active" : "")} aria-label="关于" title={hasUpdate ? "有新版本" : undefined} aria-current={page === "about" ? "page" : undefined} onClick={() => void go("about")}>
            <InfoCircleOutlined className="glyph" />
            {hasUpdate && <span className="rail-dot" aria-hidden />}
            <span className="rail-label">关于</span>
          </button>
        </div>
      </nav>
      <main className="stage">
        <header className="masthead">
          <div className="masthead-title">
            <span className="eyebrow">{head.eyebrow}</span>
            <h1>{head.title}</h1>
            <HelpLink topic={PAGE_HELP[page]} label="本页教程" />
          </div>
          <BatchControl data={data} onOverlay={overlay} />
          <div className="stats">
            {STATS.map((st) => (
              <StatButton
                key={st.kind}
                kind={st.kind}
                value={statValue[st.kind]}
                label={st.label}
                tone={st.tone(statValue[st.kind])}
                open={statOpen === st.kind}
                onOpenChange={(o) => setStatOpen(o ? st.kind : undefined)}
              >
                <StatPanel kind={st.kind} data={data} setData={setData} onShowAccount={showAccount} onOpenTask={openTask} onClose={() => setStatOpen(undefined)} />
              </StatButton>
            ))}
          </div>
        </header>
        <NoticeBar onUpdate={() => void go("about")} />
        <div className="stage-body" key={page}>
          {page === "accounts" ? (
            <div className="accounts">
              <aside className="account-side panel">
                <div className="panel-head">
                  <h3>平台账号</h3>
                  <span className="muted num">{data.accounts.length}</span>
                </div>
                <Button type="primary" icon={<PlusOutlined />} block onClick={async () => { await window.fanpost.hideBrowser(); setAddOpen(true); }}>
                  添加账号
                </Button>
                <AccountList
                  data={data}
                  active={active}
                  onChoose={(a) => void choose(a)}
                  onRemoved={closeTab}
                  setData={setData}
                  hideBrowser={() => window.fanpost.hideBrowser()}
                  restoreBrowser={async () => {
                    if (active && data.accounts.some((a) => a.id === active)) await window.fanpost.showBrowser(active);
                  }}
                />
              </aside>
              <section className="browser-shell panel">
                {tabs.length > 0 && (
                  <div className="browser-tabs" role="tablist">
                    {tabs.map((id) => {
                      const a = data.accounts.find((x) => x.id === id);
                      return a ? (
                        <div key={id} role="tab" aria-selected={active === id} className={"browser-tab" + (active === id ? " active" : "")} onClick={() => choose(a)}>
                          <PlatformLogo platform={a.platform} />
                          <span>{accountLabel(a)}</span>
                          <CloseOutlined aria-label="关闭标签" onClick={(e) => { e.stopPropagation(); closeTab(id); }} />
                        </div>
                      ) : null;
                    })}
                  </div>
                )}
                {active && activeAccount ? (
                  <>
                    <div className="browser-bar">
                      <div className="nav-btns">
                        <Button type="text" icon={<ArrowLeftOutlined />} aria-label="后退" onClick={() => window.fanpost.browserNavigate("back", active)} />
                        <Button type="text" icon={<ArrowRightOutlined />} aria-label="前进" onClick={() => window.fanpost.browserNavigate("forward", active)} />
                        <Button type="text" icon={<ReloadOutlined />} aria-label="刷新" onClick={() => window.fanpost.browserNavigate("reload", active)} />
                        <Button type="text" icon={<HomeOutlined />} aria-label="首页" onClick={() => window.fanpost.browserNavigate("home", active)} />
                      </div>
                      <span className="url num">{platformMap[activeAccount.platform].homeUrl}</span>
                      <Button type="primary" icon={<UploadOutlined />} onClick={() => window.fanpost.showBrowser(active, "publish")}>
                        进入发布页
                      </Button>
                    </div>
                    <div ref={host} className="browser-host" />
                  </>
                ) : (
                  <div className="hero-empty">
                    <div className="orbit" aria-hidden>
                      {platforms.map((p, i) => (
                        <span key={p.id} style={{ ["--i" as string]: i, ["--n" as string]: ALL_CHANNELS }}>
                          <PlatformLogo platform={p.id} />
                        </span>
                      ))}
                      <span style={{ ["--i" as string]: platforms.length, ["--n" as string]: ALL_CHANNELS }}>
                        <i className="platform-logo"><img src={mpLogoUrl} alt="公众号" title="公众号" draggable={false} /></i>
                      </span>
                      <img className="orbit-core" src={brandUrl} alt="" />
                    </div>
                    <h2>
                      一次填写，<em>{ALL_CHANNELS}</em> 个平台同步就绪
                    </h2>
                    <PromoSlotView slot="home" variant="strip" />
                    {data.accounts.length ? (
                      <p>从左侧选一个账号，在这里打开它的官方后台。掉线的账号点开后直接扫码即可恢复。</p>
                    ) : (
                      <>
                        <p>先添加一个平台账号，扫码登录后会自动识别名称。</p>
                        <Button type="primary" size="large" icon={<PlusOutlined />} onClick={async () => { await window.fanpost.hideBrowser(); setAddOpen(true); }}>
                          添加第一个账号
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </section>
            </div>
          ) : page === "mp" ? (
            <ErrorBoundary>
              <MpPage data={data} setData={setData} />
            </ErrorBoundary>
          ) : page === "settings" ? (
            <SettingsPage data={data} setData={setData} guard={guard} />
          ) : page === "about" ? (
            <AboutPage />
          ) : (
            <ErrorBoundary>
              <Publish type={page === "video" ? "video" : "image_text"} data={data} setData={setData} openTask={openTask} openTasks={openTasks} guard={guard} confirmLeave={leave.confirm} />
            </ErrorBoundary>
          )}
        </div>
      </main>
      <UpgradeModal />
      <TutorialHost onOverlay={overlay("tutorial")} />
      {leave.modal}
      <NotificationCenter open={notifyOpen} onClose={() => setNotifyOpen(false)} data={data} setData={setData} onShowAccount={showAccount} onOpenTask={openTask} onOpenTasks={openTasks} />
      <Modal
        title="添加账号"
        width={760}
        open={addOpen}
        footer={null}
        onCancel={async () => {
          setAddOpen(false);
          if (active) await window.fanpost.showBrowser(active);
        }}
      >
        <p className="muted">选择平台后直接进入官方扫码登录页。同一平台可添加多个账号，每个账号的登录数据独立保存、互不影响。</p>
        <div className="platform-picker">
          {platforms.map((p) => (
            <button key={p.id} onClick={() => add(p.id)}>
              <PlatformLogo platform={p.id} />
              <span>{p.name}</span>
              {p.publishMode === "assisted" && <small>辅助</small>}
              {accountCounts[p.id] ? <em className="num">已有 {accountCounts[p.id]}</em> : null}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

type Section = "compose" | "drafts" | "records";
const lastSection: Partial<Record<ContentType, Section>> = {};

function Publish({
  type,
  data,
  setData,
  openTask,
  openTasks,
  guard,
  confirmLeave,
}: {
  type: ContentType;
  data: AppData;
  setData: (d: AppData) => void;
  openTask: (task: PublishTask) => Promise<void>;
  openTasks: (list: PublishTask[], published?: boolean) => Promise<void>;
  guard: React.RefObject<LeaveGuard | undefined>;
  confirmLeave: () => Promise<boolean>;
}) {
  const [section, setSectionState] = useState<Section>(() => lastSection[type] || "compose"),
    [editing, setEditing] = useState<SavedDraft>(),
    [composerKey, setComposerKey] = useState(0),
    [importOpen, setImportOpen] = useState(false);
  const pending = data.tasks.filter((t) => t.status === "manual_required" && data.drafts.find((d) => d.id === t.draftId)?.type === type).length;
  const draftCount = data.savedDrafts.filter((d) => d.type === type).length;
  const kind = type === "video" ? "视频" : "图文";
  const setSection = (next: Section) => {
    lastSection[type] = next;
    setSectionState(next);
  };
  const switchTo = async (next: Section) => {
    if (next === section) return;
    if (section === "compose" && !(await confirmLeave())) return;
    setSection(next);
  };
  const startNew = async () => {
    if (section === "compose" && !(await confirmLeave())) return;
    setEditing(undefined);
    setComposerKey((k) => k + 1);
    setSection("compose");
  };
  const edit = (draft: SavedDraft) => {
    setEditing(draft);
    setComposerKey((k) => k + 1);
    setSection("compose");
  };
  return (
    <div className="publish">
      <div className="publish-bar">
        <div className="switcher" role="tablist">
          <button role="tab" aria-selected={section === "compose"} className={section === "compose" ? "active" : ""} onClick={() => void switchTo("compose")}>
            {editing ? "编辑草稿" : "新建" + kind}
          </button>
          <button role="tab" aria-selected={section === "drafts"} className={section === "drafts" ? "active" : ""} onClick={() => void switchTo("drafts")}>
            草稿箱{draftCount > 0 && <b className="num is-soft">{draftCount}</b>}
          </button>
          <button role="tab" aria-selected={section === "records"} className={section === "records" ? "active" : ""} onClick={() => void switchTo("records")}>
            发布记录{pending > 0 && <b className="num">{pending}</b>}
          </button>
        </div>
        {section === "compose" && editing && (
          <span className="editing-note">
            正在编辑：<b>{draftLabel(editing)}</b>
            <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => void startNew()}>
              新建{kind}
            </Button>
          </span>
        )}
        {type === "image_text" && (
          <Button className="import-btn" icon={<ImportOutlined />} onClick={async () => { if (section !== "compose" || (await confirmLeave())) setImportOpen(true); }}>
            导入图文
          </Button>
        )}
      </div>
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} setData={setData} onOpenDraft={edit} onBatchDone={() => setSection("drafts")} />
      {section === "compose" ? (
        <PublishComposer
          key={composerKey}
          type={type}
          data={data}
          setData={setData}
          initial={editing}
          guard={guard}
          onSaved={setEditing}
          onStarted={() => {
            setEditing(undefined);
            setComposerKey((k) => k + 1);
            setSection("records");
          }}
        />
      ) : section === "drafts" ? (
        <DraftList type={type} data={data} setData={setData} onEdit={edit} />
      ) : (
        <PublishRecords type={type} data={data} setData={setData} openTask={openTask} openTasks={openTasks} />
      )}
    </div>
  );
}

export default function App() {
  const [themeId, setThemeIdState] = useState<ThemeId>(loadThemeId);
  const def = findTheme(themeId);
  useLayoutEffect(() => applyCssVars(def), [def]);
  const config = useMemo(() => antTheme(def), [def]);
  const setThemeId = (id: ThemeId) => {
    setThemeIdState(id);
    saveThemeId(id);
  };
  return (
    <ConfigProvider theme={config} locale={zhCN}>
      <AntApp>
        <Main themeId={themeId} setThemeId={setThemeId} />
      </AntApp>
    </ConfigProvider>
  );
}
