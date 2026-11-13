import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Empty, Input, Modal, Popconfirm, Popover, Progress, Select, Switch, Tag, Tooltip, message } from "antd";
import { FilterOutlined, ReloadOutlined, SettingOutlined, ThunderboltOutlined, WarningFilled } from "@ant-design/icons";
import type { CommentItem, LeadsAccountRef, LeadsSettings, LeadsView, ReplyRule, MatchMode } from "../../shared/leads";
import {
  INTENT_LABEL,
  DEFAULT_LEADS_SETTINGS,
  SCAN_WINDOW_LABEL,
  SCAN_WINDOW_OPTIONS,
  firstRuleFor,
  isStale,
  renderReply,
  pickReply,
  replyGapSec,
} from "../../shared/leads";
import type { Platform } from "../../shared/types";
import { platformMap } from "../../shared/platforms";
import { PlatformLogo } from "./PlatformLogo";

const errText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const INTENT_TONE: Record<string, string> = { ask: "blue", negative: "red", other: "default", spam: "orange" };

const pad2 = (n: number) => String(n).padStart(2, "0");

const exactTime = (t?: number) => {
  if (!t) return "";
  const d = new Date(t);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
};

const ago = (t: number) => {
  const d = Date.now() - t;
  if (d < 0) return "刚刚";
  if (d < 60000) return "刚刚";
  if (d < 3600000) return Math.floor(d / 60000) + " 分钟前";
  if (d < 86400000) return Math.floor(d / 3600000) + " 小时前";
  const days = Math.floor(d / 86400000);
  if (days <= 30) return days + " 天前";
  const dt = new Date(t);
  const sameYear = dt.getFullYear() === new Date().getFullYear();
  return (sameYear ? "" : dt.getFullYear() + "-") + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
};

const MODES: Array<{ value: MatchMode; label: string }> = [
  { value: "any", label: "包含任一关键词" },
  { value: "all", label: "同时包含所有关键词" },
  { value: "none", label: "不包含关键词" },
  { value: "exact", label: "完全等于" },
  { value: "always", label: "每条都回" },
];

const blankRule = (): ReplyRule => ({
  id: "r" + Date.now().toString(36),
  name: "",
  enabled: true,
  platforms: [],
  accounts: [],
  mode: "any",
  keywords: [],
  replies: [],
  delaySec: 0,
  dailyCap: 50,
  skipNegative: true,
});

const PRESETS: ReplyRule[] = [
  { id: "preset-price", name: "问价格 / 要链接", enabled: true, platforms: [], accounts: [], mode: "any", keywords: ["多少钱", "价格", "怎么买", "链接", "哪里买"], replies: ["{{author}}，看主页简介，或者私信我发你~"], delaySec: 0, dailyCap: 50, skipNegative: true },
  { id: "preset-how", name: "问怎么用", enabled: true, platforms: [], accounts: [], mode: "any", keywords: ["怎么用", "怎么弄", "教程", "下载"], replies: ["{{author}}，主页有安装包和教程，看不懂的地方可以再问我"], delaySec: 0, dailyCap: 50, skipNegative: true },
  { id: "preset-thanks", name: "通用致谢", enabled: false, platforms: [], accounts: [], mode: "always", keywords: [], replies: ["谢谢支持～", "感谢，后面还有更多内容", "有用就好，有问题随时问"], delaySec: 0, dailyCap: 30, skipNegative: true },
];

/**
 * 账号显示名。同平台同名的重复号（以前重复扫码留下的）补一段短 id，
 * 否则下拉里会并排两条「抖音 · @Jackie」，根本分不出选的是哪个。
 */
function accountLabeler(accounts: LeadsAccountRef[]) {
  const dup = new Map<string, number>();
  for (const a of accounts) {
    const key = a.platform + "|" + a.name;
    dup.set(key, (dup.get(key) || 0) + 1);
  }
  return (a: LeadsAccountRef) => {
    const suffix = (dup.get(a.platform + "|" + a.name) || 0) > 1 ? " #" + a.id.slice(0, 4) : "";
    return a.name + suffix + (a.online ? "" : "（离线）");
  };
}

export function LeadsPage({ accounts, onGoAccounts }: { accounts: Array<{ platform: Platform; loginStatus: string }>; onGoAccounts: () => void }) {
  const [view, setView] = useState<LeadsView>();
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [picked, setPicked] = useState<Platform[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 只看某几个号：同平台多号混在一个列表里根本看不过来 */
  const [accountFilter, setAccountFilter] = useState<string[]>([]);
  const [reply, setReply] = useState<{ item: CommentItem; text: string; send: boolean }>();
  const [busyReply, setBusyReply] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [settings, setSettings] = useState<LeadsSettings>(DEFAULT_LEADS_SETTINGS);
  const [bulk, setBulk] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPick, setBulkPick] = useState<string[]>([]);
  const [filter, setFilter] = useState<"pending" | "replied">("pending");
  const [showStale, setShowStale] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; author?: string }>();

  const refresh = async () => {
    try {
      const v = await window.fanpost.getLeads();
      setView(v);
      setSettings(v.settings);
    } catch (e) {
      message.error(errText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const offChanged = window.fanpost.onLeadsChanged(() => void refresh());
    const offProgress = window.fanpost.onLeadsProgress((p) => {
      setProgress(p.finished ? undefined : { done: p.done, total: p.total, author: p.author });
    });
    return () => {
      offChanged();
      offProgress();
    };
  }, []);

  const saveSettings = async (next: LeadsSettings) => {
    setSettings(next);
    try {
      await window.fanpost.saveLeadsSettings(next);
      await refresh();
    } catch (e) {
      message.error(errText(e));
    }
  };

  const scan = async () => {
    setScanning(true);
    try {
      const r = await window.fanpost.scanLeads({
        platforms: picked.length ? picked : undefined,
        // 账号筛选用着的时候只抓这几个号，别把别的号也翻一遍
        accountIds: accountFilter.length ? accountFilter : undefined,
      });
      if (!r.ok) {
        message.warning(r.error || "抓取失败");
        return;
      }
      const s = r.summary!;
      const failed = s.platforms.filter((p) => !p.ok);
      const head = "扫了 " + s.accounts + " 个账号，抓到 " + s.scanned + " 条，新增 " + s.added + " 条";
      const tails: string[] = [];
      if (s.skipped) tails.push("超期跳过 " + s.skipped + " 条（" + SCAN_WINDOW_LABEL[s.window ?? settings.scanWindow] + "）");
      if (s.unknownTime) tails.push(s.unknownTime + " 条页面没给时间，已照收");
      if (s.unfiltered?.length) tails.push(s.unfiltered.join("、") + " 没识别到时间，这次没按时间过滤");
      const tail = tails.length ? "；" + tails.join("；") : "";
      if (failed.length) message.warning(head + tail + "；" + failed.map((f) => platformMap[f.platform].name + "：" + (f.error || "没抓到")).join("；"), 8);
      else if (!s.scanned) message.info(head + "。页面都打开了，这些账号现在没有评论可回", 6);
      else if (s.skipped && !s.added) message.info(head + tail + "。没有新的可回复评论", 8);
      else message.success(head + tail, 8);
      await refresh();
    } catch (e) {
      message.error(errText(e));
    } finally {
      setScanning(false);
    }
  };

  const openReply = (item: CommentItem) => {
    // 必须按关键词命中来找规则，不能只看平台：否则会拿一条其实不匹配的内容话术预填进来
    const rule = firstRuleFor(settings.rules, item);
    const text = rule ? renderReply(pickReply(rule, 0), item) : "";
    setReply({ item, text, send: settings.autoSend });
  };

  const sendReply = async () => {
    if (!reply) return;
    if (!reply.text.trim()) {
      message.warning("先写一句回复");
      return;
    }
    setBusyReply(true);
    try {
      const r = await window.fanpost.replyLead({ id: reply.item.id, text: reply.text.trim(), send: reply.send && settings.autoSend });
      if (!r.ok) {
        message.error(r.error || "发送失败");
        return;
      }
      message.success(r.hint || "已处理");
      setReply(undefined);
      await refresh();
    } catch (e) {
      message.error(errText(e));
    } finally {
      setBusyReply(false);
    }
  };

  const accountFiltered = useMemo(() => {
    const all = view?.comments || [];
    return accountFilter.length ? all.filter((c) => accountFilter.includes(c.accountId)) : all;
  }, [view, accountFilter]);
  const pendingAll = useMemo(() => accountFiltered.filter((c) => c.status === "pending"), [accountFiltered]);
  // 超出时间范围的旧评论默认收起来：留着能查，但不再混在今天要回的队列里
  const staleIds = useMemo(() => pendingAll.filter((c) => isStale(c, settings.scanWindow)).map((c) => c.id), [pendingAll, settings.scanWindow]);
  const staleCount = staleIds.length;
  const pendingList = useMemo(
    () => (showStale ? pendingAll : pendingAll.filter((c) => !isStale(c, settings.scanWindow))),
    [pendingAll, settings.scanWindow, showStale],
  );
  const list = useMemo(() => (filter === "pending" ? pendingList : accountFiltered.filter((c) => c.status === "replied")), [accountFiltered, filter, pendingList]);
  // 能被规则自动回复的：命中某条规则，且规则要求跳过负评时不是负评。始终按待回复算，不受当前签页影响
  const autoTargets = useMemo(
    () =>
      pendingList.filter((c) => {
        const rule = firstRuleFor(settings.rules, c);
        return !!rule && !(rule.skipNegative && c.intent === "negative");
      }),
    [pendingList, settings.rules],
  );
  const previews = useMemo(
    () =>
      autoTargets.map((c) => {
        const rule = firstRuleFor(settings.rules, c);
        return { item: c, text: rule ? renderReply(pickReply(rule, 0), c) : "" };
      }),
    [autoTargets, settings.rules],
  );
  const ensureAutoSend = () =>
    new Promise<boolean>((resolve) => {
      if (settings.autoSend) return resolve(true);
      Modal.confirm({
        title: "批量回复需要打开「自动发送」",
        content: "批量回复会逐条在平台上点「发送」，真的发出去。现在「自动发送」是关着的，要打开它并继续吗？以后在右上角随时可以关掉。",
        okText: "打开并继续",
        cancelText: "先不发",
        onOk: async () => {
          await saveSettings({ ...settings, autoSend: true });
          message.success("已打开自动发送");
          resolve(true);
        },
        onCancel: () => resolve(false),
      });
    });
  const openBulk = async () => {
    if (!(await ensureAutoSend())) return;
    setBulkPick([]);
    setBulkOpen(true);
  };
  const runAll = async () => {
    if (!bulkPick.length) return;
    if (!(await ensureAutoSend())) return;
    setBulk(true);
    try {
      const r = await window.fanpost.replyAllLeads({ ids: bulkPick });
      if (!r.ok) {
        message.warning(r.error || "没有可回复的评论");
        return;
      }
      const failed = (r.results || []).filter((x) => !x.sent);
      if (failed.length) message.warning(`发出 ${r.sent} 条，${failed.length} 条没成功：` + failed.map((f) => (f.account ? f.account + " · " : "") + f.author + "（" + (f.error || "未确认发出") + "）").join("；"));
      else message.success(`已回复 ${r.sent} 条`);
      setBulkOpen(false);
      setBulkPick([]);
      await refresh();
    } catch (e) {
      message.error(errText(e));
    } finally {
      setBulk(false);
      setProgress(undefined);
    }
  };
  const stats = view?.stats;
  /** 超期评论一次清掉：这批已经超出自己设的时效，逐条点忽略太费事 */
  const ignoreStale = async () => {
    if (!staleIds.length) return;
    try {
      const r = await window.fanpost.ignoreLeads(staleIds);
      message.success("已忽略 " + r.ignored + " 条超期评论");
      await refresh();
    } catch (e) {
      message.error(errText(e));
    }
  };  // 头部的数按「当前可见队列」算，免得数字比列表多出一条也找不到
  const headStats = useMemo(
    () => ({
      pending: pendingList.length,
      ask: pendingList.filter((c) => c.intent === "ask").length,
      negative: pendingList.filter((c) => c.intent === "negative").length,
      replied: stats?.replied ?? 0,
    }),
    [pendingList, stats],
  );
  const allPlatforms = view?.available.length ? view.available : view?.platforms || [];
  const onlineCount = accounts.filter((a) => a.loginStatus === "logged_in").length;
  // 同平台同名多号（重复扫码留下的）用短 id 区分，否则下拉里两行一模一样没法选
  const accountLabel = useMemo(() => accountLabeler(view?.accounts || []), [view]);
  const accountOptions = useMemo(() => {
    const byPlatform = new Map<Platform, Array<{ label: string; value: string }>>();
    for (const a of view?.accounts || []) {
      const row = byPlatform.get(a.platform) || [];
      row.push({ label: accountLabel(a), value: a.id });
      byPlatform.set(a.platform, row);
    }
    return [...byPlatform.entries()].map(([p, options]) => ({ label: platformMap[p].name, options }));
  }, [view, accountLabel]);

  return (
    <div className="leads-page">
      <section className="panel leads-head">
        <div className="leads-stats">
          <Tooltip
            title={
              staleCount
                ? "这个数不含已超期的 " + staleCount + " 条，处理完超期的就会并进来"
                : undefined
            }
          >
            <span><b className="num">{headStats.pending}</b><em>待回复</em></span>
          </Tooltip>
          <span><b className="num">{headStats.ask}</b><em>咨询</em></span>
          <span><b className="num">{headStats.negative}</b><em>负评</em></span>
          <span><b className="num">{headStats.replied}</b><em>已回复</em></span>
        </div>
        <div className="leads-actions">
          <Select
            className="leads-window"
            value={settings.scanWindow}
            options={SCAN_WINDOW_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(v) => void saveSettings({ ...settings, scanWindow: v })}
          />
          <Select
            className="leads-accounts"
            mode="multiple"
            allowClear
            // antd 6 的 responsive 在窄容器里会多出「+ 0 …」这种假计数，固定成 1 个标签
            maxTagCount={1}
            placeholder="全部账号"
            value={accountFilter}
            // 默认按 value 过滤，而 value 是账号 UUID，搜「小红书」会一条都搜不到
            optionFilterProp="label"
            options={accountOptions}
            onChange={(v) => setAccountFilter(v as string[])}
          />
          <Popover
            trigger="click"
            placement="bottomRight"
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            content={
              <div className="leads-picker">
                <div className="leads-picker-head">
                  <b>只抓取这些平台</b>
                  <span>
                    <Button size="small" type="text" onClick={() => setPicked(allPlatforms)}>全选</Button>
                    <Button size="small" type="text" onClick={() => setPicked([])}>清空</Button>
                  </span>
                </div>
                <Checkbox.Group
                  value={picked}
                  onChange={(v) => setPicked(v as Platform[])}
                  options={allPlatforms.map((p) => ({ value: p, label: platformMap[p].name }))}
                />
                <small className="muted">一个都不选 = 全部在线平台</small>
              </div>
            }
          >
            <Button icon={<FilterOutlined />}>
              {picked.length ? "已选 " + picked.length + " 个平台" : "全部在线平台"}
            </Button>
          </Popover>
          <Button type="primary" icon={<ReloadOutlined />} loading={scanning} onClick={() => void scan()}>
            {scanning ? "抓取中…" : "抓取评论"}
          </Button>
          <Tooltip title={settings.autoSend ? "先逐条看一遍话术，勾哪条发哪条" : "会先请你打开「自动发送」，批量回复是真的发出去"}>
            <Button
              type="primary"
              ghost
              icon={<ThunderboltOutlined />}
              loading={bulk}
              disabled={!autoTargets.length || bulk}
              onClick={() => void openBulk()}
            >
              {bulk ? "回复中…" : "批量回复 " + autoTargets.length + " 条"}
            </Button>
          </Tooltip>
          <Button icon={<SettingOutlined />} onClick={() => setRulesOpen(true)}>回复规则</Button>
        </div>
      </section>

      <section className="panel leads-body">
        <div className="panel-head">
          <div className="leads-tabs">
            <button type="button" className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}>
              待回复 <b>{headStats.pending}</b>
            </button>
            <button type="button" className={filter === "replied" ? "active" : ""} onClick={() => setFilter("replied")}>
              已回复 <b>{headStats.replied}</b>
            </button>
          </div>
          <span className="leads-auto">
            <Tooltip title="开启后，「回复」会直接点平台发送；验证阶段建议先关着，人确认一遍">
              <span className="muted">自动发送</span>
            </Tooltip>
            <Switch size="small" checked={settings.autoSend} onChange={(v) => void saveSettings({ ...settings, autoSend: v })} />
          </span>
        </div>

        {progress && (
          <div className="leads-progress">
            <Progress percent={Math.round((progress.done / Math.max(1, progress.total)) * 100)} size="small" status="active" showInfo={false} />
            <span className="muted num">
              {progress.done + 1}/{progress.total} · 正在回复 {progress.author || "…"}
            </span>
          </div>
        )}

        {/* 超期提醒常驻：只要还有没处理完的旧评论就一直显示，回复/忽略掉之后自己消失 */}
        {filter === "pending" && staleCount > 0 && (
          <div className="leads-alert" role="status">
            <WarningFilled className="leads-alert-icon" />
            <div className="leads-alert-main">
              <b>{staleCount} 条评论超过「{SCAN_WINDOW_LABEL[settings.scanWindow]}」还没处理</b>
              <small>这个时候再回过去意义不大。展开处理掉（回复或忽略），或者把右上角的时间范围调宽，这条提醒才会消失。</small>
            </div>
            <div className="leads-alert-ops">
              <Button size="small" onClick={() => setShowStale((v) => !v)}>
                {showStale ? "收起" : "展开处理"}
              </Button>
              <Popconfirm
                title={"忽略这 " + staleCount + " 条超期评论？"}
                description="不再算待回复，也不会被自动回复。评论还在本地，不会被删掉。"
                okText="全部忽略"
                cancelText="取消"
                onConfirm={() => void ignoreStale()}
              >
                <Button size="small" type="text">全部忽略</Button>
              </Popconfirm>
            </div>
          </div>
        )}

        {!loading && list.length === 0 && (
          <div className="leads-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                filter === "replied" ? (
                  <span>还没有回复记录。回复成功的评论会留在这里，带平台确认的结果。</span>
                ) : staleCount > 0 ? (
                  <span>这个时间范围里没有新的评论。上面那 {staleCount} 条已经超期，点「展开处理」就能看到。</span>
                ) : accountFilter.length ? (
                  <span>
                    这些账号在这个时间范围里没有待回复的评论。
                    <br />
                    把右上角的账号筛选清掉，就能看到其他号的评论。
                  </span>
                ) : (
                  <span>
                    还没有抓到评论。先确认账号在线（当前 {onlineCount} 个），再点「抓取评论」。
                    <br />
                    第一次抓取每个平台要 4 秒左右，只读不改，不会动你的账号。
                  </span>
                )
              }
            />
            {filter === "pending" && onlineCount === 0 && <Button onClick={onGoAccounts}>去登录账号</Button>}
          </div>
        )}

        <div className="leads-list">
          {list.map((c) => (
            <div key={c.id} className="lead-row">
              <PlatformLogo platform={c.platform} />
              <div className="lead-main">
                <div className="lead-meta">
                  <b>{c.author}</b>
                  <Tag bordered={false} color={INTENT_TONE[c.intent]}>{INTENT_LABEL[c.intent]}</Tag>
                  <span className="muted">{platformMap[c.platform].name} · {c.accountName}</span>
                  <Tooltip title={c.postedAt ? "平台显示 " + exactTime(c.postedAt) : "这个平台的页面没给出时间，按抓取时间算"}>
                    <span className={"muted lead-age" + (isStale(c, settings.scanWindow) ? " stale" : "")}>
                      {c.timeUnknown ? "时间未知" : ago(c.postedAt ?? c.createdAt)}
                      {isStale(c, settings.scanWindow) ? " · 超期" : ""}
                    </span>
                  </Tooltip>
                  {c.itemTitle && <span className="muted lead-item-title">{c.itemTitle}</span>}
                </div>
                <p className="lead-content">{c.content}</p>
                {c.status === "replied" && c.replyText && (
                  <p className="lead-replied">
                    <span>已回复</span>
                    {c.replyText}
                    <em>{ago(c.repliedAt || c.createdAt)}</em>
                  </p>
                )}
              </div>
              <div className="lead-ops">
                <Button size="small" type="primary" ghost onClick={() => openReply(c)}>回复</Button>
                <Popconfirm title="忽略这条？" okText="忽略" cancelText="取消" onConfirm={() => void window.fanpost.ignoreLead(c.id).then(refresh)}>
                  <Button size="small" type="text">忽略</Button>
                </Popconfirm>
              </div>
            </div>
          ))}
        </div>

      </section>

      <Modal
        open={bulkOpen}
        width={720}
        title="批量回复"
        onCancel={() => setBulkOpen(false)}
        footer={
          <div className="ai-modal-footer">
            <span className="ai-modal-meta">
              已选 {bulkPick.length} / {previews.length} 条 · 同号停 {replyGapSec(settings, true)} 秒，换号停 {replyGapSec(settings, false)} 秒
            </span>
            <Button onClick={() => setBulkOpen(false)}>取消</Button>
            <Button type="primary" loading={bulk} disabled={!bulkPick.length} onClick={() => void runAll()}>
              发送所选
            </Button>
          </div>
        }
      >
        <Alert
          type="warning"
          showIcon
          title="没有「全选发送」，只能一条条勾"
          description="连续多条全自动回复，是最容易被平台判成机器操作的动作。一次建议不超过 5 条，中途别关窗口。负评不会出现在下面。"
        />
        <div className="bulk-list">
          {previews.map((p) => {
            const on = bulkPick.includes(p.item.id);
            return (
              <label key={p.item.id} className={"bulk-row" + (on ? " on" : "")}>
                <Checkbox
                  checked={on}
                  onChange={(e) => setBulkPick((prev) => (e.target.checked ? [...prev, p.item.id] : prev.filter((x) => x !== p.item.id)))}
                />
                <div className="bulk-main">
                  <div className="bulk-meta">
                    <b>{p.item.author}</b>
                    <span className="muted">{platformMap[p.item.platform].name} · {p.item.accountName}</span>
                    <Tag bordered={false} color={INTENT_TONE[p.item.intent]}>{INTENT_LABEL[p.item.intent]}</Tag>
                  </div>
                  <p className="bulk-quote">{p.item.content}</p>
                  <p className="bulk-text">
                    <em>将发送</em>
                    {p.text}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      </Modal>

      <Modal
        open={!!reply}
        width={560}
        title={"回复 " + (reply?.item.author || "")}
        onCancel={() => setReply(undefined)}
        footer={
          <div className="ai-modal-footer">
            <span className="ai-modal-meta">{reply ? platformMap[reply.item.platform].name + " · " + reply.item.accountName : ""}</span>
            <Button onClick={() => setReply(undefined)}>取消</Button>
            <Button type="primary" loading={busyReply} onClick={() => void sendReply()}>
              {settings.autoSend && reply?.send ? "填入并发送" : "填入输入框"}
            </Button>
          </div>
        }
      >
        {reply && (
          <div className="lead-reply">
            <div className="lead-reply-quote">{reply.item.content}</div>
            <Input.TextArea
              value={reply.text}
              autoSize={{ minRows: 3, maxRows: 6 }}
              maxLength={reply.item.platform === "douyin" ? 100 : undefined}
              showCount={reply.item.platform === "douyin"}
              placeholder="写一句回复，可以带 {{author}} 自动替换成对方名字"
              onChange={(e) => setReply({ ...reply, text: e.target.value })}
            />
            <Checkbox checked={reply.send} disabled={!settings.autoSend} onChange={(e) => setReply({ ...reply, send: e.target.checked })}>
              填完自动点「发送」{!settings.autoSend && "（先在右上角打开自动发送）"}
            </Checkbox>
            <Alert
              type="info"
              showIcon
              title="会给这个账号填一条回复，不会碰别人的作品"
              description="回复会填进你自己的后台评论框。关着自动发送时，到账号窗口确认内容再点发送；平台如果要求验证码，按提示过一次就行。"
            />
          </div>
        )}
      </Modal>

      <Modal open={rulesOpen} width={720} title="回复规则" onCancel={() => setRulesOpen(false)} footer={null}>
        <RulesEditor settings={settings} accounts={view?.accounts || []} onChange={(next) => void saveSettings(next)} />
      </Modal>
    </div>
  );
}

function RulesEditor({
  settings,
  accounts,
  onChange,
}: {
  settings: LeadsSettings;
  accounts: LeadsAccountRef[];
  onChange: (next: LeadsSettings) => void;
}) {
  const [editing, setEditing] = useState<ReplyRule>();
  const [keywords, setKeywords] = useState("");
  const [replies, setReplies] = useState("");

  const label = accountLabeler(accounts);
  const accountText = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? label(a) : id;
  };
  // 选了平台就只能挑那个平台的号；没选平台就是全部号
  const accountChoices = (editing?.platforms.length ? accounts.filter((a) => editing.platforms.includes(a.platform)) : accounts).map(
    (a) => ({ value: a.id, label: platformMap[a.platform].name + " · " + label(a) }),
  );

  const start = (rule?: ReplyRule) => {
    const base = rule || blankRule();
    setEditing(base);
    setKeywords(base.keywords.join("，"));
    setReplies(base.replies.join("\n"));
  };

  const commit = () => {
    if (!editing) return;
    const words = keywords.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
    const lines = replies.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!lines.length) {
      message.warning("至少写一条回复话术");
      return;
    }
    const rule: ReplyRule = {
      ...editing,
      name: editing.name.trim() || words[0] || "未命名规则",
      keywords: words,
      replies: lines,
      mode: words.length ? editing.mode : "always",
    };
    const exists = settings.rules.some((r) => r.id === rule.id);
    const rules = exists ? settings.rules.map((r) => (r.id === rule.id ? rule : r)) : [...settings.rules, rule];
    onChange({ ...settings, rules });
    setEditing(undefined);
  };

  return (
    <div className="rules-editor">
      <div className="rules-toolbar">
        <Button size="small" type="primary" onClick={() => start()}>添加规则</Button>
        <Button size="small" onClick={() => onChange({ ...settings, rules: [...settings.rules, ...PRESETS.filter((p) => !settings.rules.some((r) => r.id === p.id))] })}>
          加常用模板
        </Button>
        <span className="muted">按顺序匹配，命中第一条就停</span>
      </div>

      {settings.rules.length === 0 && <p className="muted">还没有规则。规则决定「哪类评论用什么话术回」，也可以只用手动回复。</p>}

      <div className="rules-list">
        {settings.rules.map((r) => (
          <div key={r.id} className="rule-row">
            <Switch size="small" checked={r.enabled} onChange={(v) => onChange({ ...settings, rules: settings.rules.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)) })} />
            <div className="rule-main">
              <b>{r.name}</b>
              <small className="muted">
                {MODES.find((m) => m.value === r.mode)?.label}
                {r.keywords.length ? "：" + r.keywords.join(" / ") : ""} · {r.replies.length} 条话术 · 每日上限 {r.dailyCap}
                {r.platforms.length ? " · 仅 " + r.platforms.map((p) => platformMap[p].name).join("、") : " · 全平台"}
                {r.accounts.length ? " · 仅 " + r.accounts.map(accountText).join("、") : ""}
              </small>
            </div>
            <Button size="small" type="text" onClick={() => start(r)}>编辑</Button>
            <Button size="small" type="text" danger onClick={() => onChange({ ...settings, rules: settings.rules.filter((x) => x.id !== r.id) })}>删除</Button>
          </div>
        ))}
      </div>

      <div className="rules-foot">
        <span className="muted">同一账号两次回复至少间隔</span>
        <Select
          size="small"
          className="rules-gap"
          value={settings.perAccountGapSec}
          options={[0, 15, 30, 45, 60, 120, 300].map((v) => ({ value: v, label: v ? v + " 秒" : "不限" }))}
          onChange={(v) => onChange({ ...settings, perAccountGapSec: v })}
        />
        <span className="muted">换到另一个号再多停</span>
        <Select
          size="small"
          className="rules-gap"
          value={settings.switchAccountGapSec}
          options={[0, 30, 45, 60, 90, 120, 180, 300].map((v) => ({ value: v, label: v ? v + " 秒" : "不多停" }))}
          onChange={(v) => onChange({ ...settings, switchAccountGapSec: v })}
        />
      </div>
      <small className="muted">太密容易被判机械互动，建议同号 30 秒以上、换号 60 秒以上。批量回复按账号分组，一个号连着回完再换下一个。</small>

      <Modal open={!!editing} width={600} title={editing && settings.rules.some((r) => r.id === editing.id) ? "编辑规则" : "添加规则"} onCancel={() => setEditing(undefined)} footer={
        <div className="ai-modal-footer">
          <Button onClick={() => setEditing(undefined)}>取消</Button>
          <Button type="primary" onClick={commit}>保存规则</Button>
        </div>
      }>
        {editing && (
          <div className="rule-form">
            <label>
              <span>规则名</span>
              <Input value={editing.name} placeholder="比如：问价格" onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
            <label>
              <span>匹配方式</span>
              <Select value={editing.mode} options={MODES} onChange={(v) => setEditing({ ...editing, mode: v })} />
            </label>
            <label>
              <span>关键词（逗号分隔，匹配方式选「每条都回」可留空）</span>
              <Input value={keywords} placeholder="多少钱，价格，怎么买，链接" onChange={(e) => setKeywords(e.target.value)} />
            </label>
            <label>
              <span>回复话术（一行一条，会轮换；{"{{author}}"} 会替换成对方名字）</span>
              <Input.TextArea value={replies} autoSize={{ minRows: 4, maxRows: 8 }} onChange={(e) => setReplies(e.target.value)} />
            </label>
            <div className="rule-form-row">
              <label>
                <span>单账号每日上限</span>
                <Input type="number" value={editing.dailyCap} onChange={(e) => setEditing({ ...editing, dailyCap: Number(e.target.value) || 0 })} />
              </label>
              <label className="rule-form-check">
                <Checkbox checked={editing.skipNegative} onChange={(e) => setEditing({ ...editing, skipNegative: e.target.checked })}>
                  负评不自动回（转人工）
                </Checkbox>
              </label>
            </div>
            <label>
              <span>适用平台（不选=全部）</span>
              <Select
                mode="multiple"
                value={editing.platforms}
                options={Object.keys(platformMap).map((p) => ({ value: p, label: platformMap[p as Platform].name }))}
                onChange={(v) => {
                  // 平台改了就把不在新平台里的号摘掉，免得留下永远匹配不上的死条件
                  const keep = v.length
                    ? editing.accounts.filter((id) => {
                        const a = accounts.find((x) => x.id === id);
                        return a ? v.includes(a.platform) : false;
                      })
                    : editing.accounts;
                  setEditing({ ...editing, platforms: v, accounts: keep });
                }}
              />
            </label>
            <label>
              <span>适用账号（不选=该平台全部账号）</span>
              <Select
                mode="multiple"
                allowClear
                value={editing.accounts}
                options={accountChoices}
                optionFilterProp="label"
                placeholder={accounts.length ? "全部账号" : "还没有登录的账号"}
                onChange={(v) => setEditing({ ...editing, accounts: v as string[] })}
              />
            </label>
            <small className="muted">日上限按「账号 + 这条规则」各算各的，多条规则不会互相挤占额度。</small>
          </div>
        )}
      </Modal>
    </div>
  );
}
