import { useEffect, useState } from "react";
import { Button, Empty, Popconfirm, Popover, message } from "antd";
import { DownOutlined, ReloadOutlined } from "@ant-design/icons";
import type { Account, AppData, Platform, PublishTask } from "../../shared/types";
import { accountLabel, accountWho } from "../../shared/accounts";
import { platformMap } from "../../shared/platforms";
import { PlatformLogo } from "./PlatformLogo";
import { taskBucket } from "../../shared/task-outcome";

export type StatKind = "online" | "offline" | "waiting" | "done";
type PatrolState = "checking" | "online" | "offline" | "unknown";
const PATROL_ORDER: Array<PatrolState | "waiting"> = ["checking", "offline", "unknown", "online", "waiting"];
const PATROL_TEXT: Record<PatrolState | "waiting", string> = { checking: "检测中…", online: "在线", offline: "已掉线", unknown: "检测失败", waiting: "排队中" };
const RECENT_DONE_BATCHES = 10;

const TITLES: Record<StatKind, string> = {
  online: "在线账号",
  offline: "已掉线账号",
  waiting: "待你点发布",
  done: "最近已发布",
};

function AccountItem({ a, lost, child, onShowAccount }: { a: Account; lost?: boolean; child?: boolean; onShowAccount: (id: string) => void }) {
  return (
    <li>
      <button type="button" className={"stat-item" + (child ? " is-child" : "")} onClick={() => onShowAccount(a.id)}>
        {child ? <span className="account-avatar">{accountLabel(a).replace(/^@/, "").slice(0, 1)}</span> : <PlatformLogo platform={a.platform} />}
        <span className="stat-item-text">
          <b>{accountLabel(a)}</b>
          {!child && <small>{platformMap[a.platform].name}{a.remark ? " · " + a.name : ""}</small>}
        </span>
        <span className={"stat-item-go" + (lost ? " bad" : "")}>{lost ? "去登录" : "打开"}</span>
      </button>
    </li>
  );
}

function AccountRows({ list, onShowAccount, lost }: { list: Account[]; onShowAccount: (id: string) => void; lost?: boolean }) {
  const [opened, setOpened] = useState<Platform[]>([]);
  const groups = new Map<Platform, Account[]>();
  for (const a of list) groups.set(a.platform, [...(groups.get(a.platform) || []), a]);
  const flip = (p: Platform) => setOpened((o) => (o.includes(p) ? o.filter((x) => x !== p) : [...o, p]));
  return (
    <ul className="stat-list">
      {Array.from(groups.entries()).map(([p, items]) => {
        if (items.length === 1) return <AccountItem key={items[0].id} a={items[0]} lost={lost} onShowAccount={onShowAccount} />;
        const open = opened.includes(p);
        return (
          <li key={p} className={"stat-group" + (open ? " is-open" : "")}>
            <button type="button" className="stat-item stat-group-head" aria-expanded={open} onClick={() => flip(p)}>
              <PlatformLogo platform={p} />
              <span className="stat-item-text">
                <b>{platformMap[p].name}<em className="stat-group-count num">{items.length}</em></b>
                <small>{items.map(accountLabel).join("、")}</small>
              </span>
              <DownOutlined className="stat-group-caret" aria-hidden />
            </button>
            {open && (
              <ul className="stat-list stat-group-body">
                {items.map((a) => <AccountItem key={a.id} a={a} lost={lost} child onShowAccount={onShowAccount} />)}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString("zh-CN", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function TaskItem({ t, data, done, child, onOpenTask }: { t: PublishTask; data: AppData; done?: boolean; child?: boolean; onOpenTask: (t: PublishTask) => Promise<void> }) {
  const a = data.accounts.find((x) => x.id === t.accountId);
  const who = a ? (child ? platformMap[a.platform].name + " · " + accountLabel(a) : accountWho(a)) : "账号已删除";
  const opened = !done && !!t.openedAt;
  const bucket = taskBucket(t);
  return (
    <li>
      <button type="button" className={"stat-item" + (child ? " is-child" : "") + (opened ? " is-opened" : "")} onClick={() => void onOpenTask(t)}>
        <PlatformLogo platform={t.platform} />
        <span className="stat-item-text">
          <b>{child ? who : t.title || "（无标题）"}</b>
          <small>{opened ? when(t.openedAt as string) + " 打开过" : child ? when(t.updatedAt) : who + " · " + when(t.updatedAt)}</small>
        </span>
        {!done && bucket === "confirming" && <span className="opened-tag">等后台确认</span>}
        {!done && bucket === "needs_you" && /^自动发布未/.test(t.message) && <span className="opened-tag is-warn">自动发布没成功</span>}
        {opened && <span className="opened-tag">已打开</span>}
        <span className="stat-item-go">{done ? "查看" : opened ? "再打开" : "去发布"}</span>
      </button>
    </li>
  );
}

function TaskRows({ list, data, onOpenTask, done }: { list: PublishTask[]; data: AppData; onOpenTask: (t: PublishTask) => Promise<void>; done?: boolean }) {
  const [opened, setOpened] = useState<string[]>([]);
  const batches = new Map<string, PublishTask[]>();
  for (const t of list) batches.set(t.draftId, [...(batches.get(t.draftId) || []), t]);
  const flip = (id: string) => setOpened((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  return (
    <ul className="stat-list">
      {Array.from(batches.entries()).slice(0, done ? RECENT_DONE_BATCHES : undefined).map(([draftId, items]) => {
        if (items.length === 1) return <TaskItem key={items[0].id} t={items[0]} data={data} done={done} onOpenTask={onOpenTask} />;
        const open = opened.includes(draftId);
        const draft = data.drafts.find((d) => d.id === draftId);
        const platforms = Array.from(new Set(items.map((t) => t.platform)));
        const unopened = items.filter((t) => !t.openedAt).length;
        return (
          <li key={draftId} className={"stat-group" + (open ? " is-open" : "")}>
            <button type="button" className="stat-item stat-group-head" aria-expanded={open} onClick={() => flip(draftId)}>
              <span className="stat-logos">
                {platforms.slice(0, 3).map((p) => <PlatformLogo key={p} platform={p} />)}
              </span>
              <span className="stat-item-text">
                <b>{draft?.title || items[0].title || "（无标题）"}<em className="stat-group-count num">{items.length}</em></b>
                <small>{done ? platforms.length + " 个平台" + (platforms.length > 3 ? "（显示前 3 个）" : "") + " · " + when(items[0].updatedAt) : unopened ? unopened + " 个还没打开 · 已打开 " + (items.length - unopened) + " 个" : "全部已打开过，等你点发布"}</small>
              </span>
              <DownOutlined className="stat-group-caret" aria-hidden />
            </button>
            {open && (
              <ul className="stat-list stat-group-body">
                {items.map((t) => <TaskItem key={t.id} t={t} data={data} done={done} child onOpenTask={onOpenTask} />)}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function StatPanel({
  kind,
  data,
  setData,
  onShowAccount,
  onOpenTask,
  onClose,
}: {
  kind: StatKind;
  data: AppData;
  setData: (d: AppData) => void;
  onShowAccount: (id: string) => void;
  onOpenTask: (t: PublishTask) => Promise<void>;
  onClose: () => void;
}) {
  const [patrolling, setPatrolling] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [checks, setChecks] = useState<Record<string, PatrolState>>({});
  useEffect(
    () =>
      window.fanpost.onPatrolProgress((p) => {
        setProgress({ done: p.done, total: p.total });
        if (p.accountId && p.state) setChecks((c) => ({ ...c, [p.accountId as string]: p.state as PatrolState }));
      }),
    [],
  );
  const go = (id: string) => {
    onClose();
    onShowAccount(id);
  };
  const open = async (t: PublishTask) => {
    onClose();
    await onOpenTask(t);
  };
  const patrol = async () => {
    setPatrolling(true);
    setProgress(undefined);
    setChecks({});
    try {
      const r = await window.fanpost.patrolAccounts();
      setData(r.data);
      if (r.skipped) message.info("巡检正在进行中，请稍候");
      else message.success("已检测 " + r.checked + " 个账号，掉线 " + r.offline + " 个");
    } catch (error) {
      message.error("巡检失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setPatrolling(false);
      setProgress(undefined);
    }
  };
  const accounts = data.accounts.filter((a) => a.loginStatus === (kind === "online" ? "logged_in" : "logged_out"));
  const latestFirst = (a: PublishTask, b: PublishTask) => b.updatedAt.localeCompare(a.updatedAt);
  const waiting = data.tasks.filter((t) => t.status === "manual_required").sort((a, b) => Number(!!a.openedAt) - Number(!!b.openedAt) || latestFirst(a, b));
  const done = data.tasks.filter((t) => t.status === "success").sort(latestFirst);
  const summary = () => {
    if (kind === "online" || kind === "offline") return accounts.length ? accounts.length + " 个 · " + new Set(accounts.map((a) => a.platform)).size + " 个平台" : "";
    const list = kind === "waiting" ? waiting : done;
    if (!list.length) return "";
    const n = new Set(list.map((t) => t.draftId)).size;
    return list.length + " 条 · " + (kind === "done" && n > RECENT_DONE_BATCHES ? "最近 " + RECENT_DONE_BATCHES + " 批" : n + " 批");
  };
  const patrolList = () => (
    <ol className="patrol-list">
      {[...data.accounts]
        .sort((a, b) => PATROL_ORDER.indexOf(checks[a.id] || "waiting") - PATROL_ORDER.indexOf(checks[b.id] || "waiting"))
        .map((a) => {
          const st = checks[a.id] || "waiting";
          return (
            <li key={a.id} className={"is-" + st}>
              <PlatformLogo platform={a.platform} />
              <span className="patrol-who">{accountWho(a)}</span>
              <span className="patrol-st">{PATROL_TEXT[st]}</span>
            </li>
          );
        })}
    </ol>
  );
  const body = () => {
    if ((kind === "online" || kind === "offline") && (patrolling || Object.keys(checks).length)) return patrolList();
    if (kind === "online" || kind === "offline")
      return accounts.length ? <AccountRows list={accounts} onShowAccount={go} lost={kind === "offline"} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={kind === "online" ? "没有在线账号" : "所有账号都在线"} />;
    const list = kind === "waiting" ? waiting : done;
    return list.length ? <TaskRows list={list} data={data} onOpenTask={open} done={kind === "done"} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={kind === "waiting" ? "没有待你处理的发布" : "还没有已发布记录"} />;
  };
  return (
    <div className="stat-panel">
      <header>
        <b>{TITLES[kind]}{summary() && <small className="stat-sum">{summary()}</small>}</b>
        {(kind === "online" || kind === "offline") && (
          <Button size="small" type="text" icon={<ReloadOutlined />} loading={patrolling} onClick={() => void patrol()}>
            {patrolling ? "检测中" + (progress ? " " + progress.done + "/" + progress.total : "") : "立即检测"}
          </Button>
        )}
        {kind === "waiting" && waiting.length > 0 && (
          <Popconfirm
            title={"忽略全部 " + waiting.length + " 条待发布？"}
            description="不再提醒，内容仍在草稿和发布记录里"
            okText="全部忽略"
            cancelText="取消"
            onConfirm={async () => setData(await window.fanpost.dismissAllTasks())}
          >
            <Button size="small" type="text">全部清空</Button>
          </Popconfirm>
        )}
      </header>
      {body()}
    </div>
  );
}

export function StatButton({
  kind,
  value,
  label,
  tone,
  open,
  onOpenChange,
  children,
}: {
  kind: StatKind;
  value: number;
  label: string;
  tone?: "ok" | "warn" | "bad";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} trigger="click" placement="bottomRight" arrow={false} content={children} rootClassName="stat-popover" destroyOnHidden>
      <button type="button" className={"stat" + (tone ? " is-" + tone : "") + (open ? " is-open" : "")} aria-haspopup="dialog" aria-expanded={open} data-kind={kind}>
        <b className="num">{value}</b>
        <span>{label}</span>
      </button>
    </Popover>
  );
}
