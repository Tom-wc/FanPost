import { useEffect, useMemo, useState } from "react";
import { Button, Input, Modal, Popconfirm, Space, Table, Tag, message } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import type { AppData, ContentType, PublishDraft, PublishTask } from "../../shared/types";
import { platformMap } from "../../shared/platforms";
import { PlatformLogo } from "./PlatformLogo";
import { TaskCard } from "./TaskPreview";
import { accountWho } from "../../shared/accounts";
import type { Platform } from "../../shared/types";
import { countBuckets, groupByReason, taskBucket } from "../../shared/task-outcome";

const DONE = ["success", "failed", "dismissed"];
const RECORDS_PAGE_SIZE = 8;
const RUNNING: PublishTask["status"][] = ["opening", "uploading", "publishing"];
const STATUS_TEXT: Record<PublishTask["status"], string> = {
  pending: "排队中",
  opening: "填写中",
  uploading: "上传中",
  publishing: "填写中",
  manual_required: "待你点发布",
  success: "发布成功",
  failed: "失败",
  dismissed: "已忽略",
};
const STATUS_RANK: PublishTask["status"][] = ["failed", "manual_required", "uploading", "publishing", "opening", "pending", "dismissed", "success"];
const worstStatus = (ts: PublishTask[]) => STATUS_RANK.find((s) => ts.some((t) => t.status === s)) ?? "pending";
function groupTasks(ts: PublishTask[]) {
  const map = new Map<Platform, PublishTask[]>();
  for (const t of ts) map.set(t.platform, [...(map.get(t.platform) || []), t]);
  return Array.from(map.entries());
}

function StatusTag({ status }: { status: PublishTask["status"] }) {
  if (status === "success") return <Tag className="st st-ok">发布成功</Tag>;
  if (status === "failed") return <Tag className="st st-bad">失败</Tag>;
  if (status === "uploading") return <Tag className="st st-run">上传中</Tag>;
  if (status === "publishing" || status === "opening") return <Tag className="st st-run">填写中</Tag>;
  if (status === "manual_required") return <Tag className="st st-wait">待你点发布</Tag>;
  if (status === "dismissed") return <Tag className="st">已忽略</Tag>;
  return <Tag className="st">排队中</Tag>;
}

export function PublishRecords({
  type,
  data,
  setData,
  openTask,
  openTasks,
}: {
  type: ContentType;
  data: AppData;
  setData: (d: AppData) => void;
  openTask: (task: PublishTask) => Promise<void>;
  openTasks: (list: PublishTask[], published?: boolean) => Promise<void>;
}) {
  const [detail, setDetail] = useState<PublishDraft>(),
    [checking, setChecking] = useState<string>(),
    [failTask, setFailTask] = useState<PublishTask>(),
    [reason, setReason] = useState(""),
    [page, setPage] = useState(1);
  const drafts = useMemo(() => data.drafts.filter((d) => d.type === type), [data, type]);
  const newest = drafts[0]?.createdAt || "";
  const [seenNewest, setSeenNewest] = useState(newest);
  useEffect(() => {
    if (newest > seenNewest) setPage(1);
    setSeenNewest(newest);
  }, [newest]);
  const lastPage = Math.max(1, Math.ceil(drafts.length / RECORDS_PAGE_SIZE));
  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [page, lastPage]);
  const tasksFor = (id: string) => data.tasks.filter((t) => t.draftId === id);
  const isRunning = (id: string) => tasksFor(id).some((t) => RUNNING.includes(t.status));
  const finished = drafts.filter((d) => !isRunning(d.id) && tasksFor(d.id).every((t) => DONE.includes(t.status)));
  const removable = drafts.filter((d) => !isRunning(d.id) && !tasksFor(d.id).some((t) => t.status === "pending"));
  const running = drafts.length - removable.length;
  const waitingTotal = removable.reduce((n, d) => n + tasksFor(d.id).filter((t) => t.status === "manual_required").length, 0);
  const remove = async (ids: string[]) => {
    try {
      const r = await window.fanpost.removeHistory(ids);
      setData(r.data);
      if (r.removed) message.success("已删除 " + r.removed + " 条发布记录");
      else message.info("这批正在填写，填完后再删除");
    } catch (error) {
      message.error("删除失败：" + (error instanceof Error ? error.message : String(error)));
    }
  };
  const check = async (t: PublishTask) => {
    setChecking(t.id);
    try {
      const r = await window.fanpost.checkTask(t.id);
      setData(r.data);
      if (r.ok) message.success("后台已找到该作品，已标记发布成功");
      else message.info("暂未找到：" + (r.reason || "作品管理里没有该标题"));
    } catch (error) {
      message.error("检查失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setChecking(undefined);
    }
  };
  const cols = [
    {
      title: type === "video" ? "视频标题" : "图文标题",
      dataIndex: "title",
      render: (title: string, d: PublishDraft) => (
        <button className="record-title" onClick={() => setDetail(d)}>
          {title}
        </button>
      ),
    },
    {
      title: "平台",
      width: 220,
      render: (_: unknown, d: PublishDraft) => (
        <div className="logo-stack">
          {groupTasks(tasksFor(d.id)).map(([platform, ts]) => (
            <span
              key={platform}
              className={"logo-chip is-" + worstStatus(ts)}
              title={ts.map((t) => {
                const a = data.accounts.find((x) => x.id === t.accountId);
                return (a ? accountWho(a) : platformMap[platform].name) + "：" + STATUS_TEXT[t.status];
              }).join("\n")}
            >
              <PlatformLogo platform={platform} />
              {ts.length > 1 && <em className="num">×{ts.length}</em>}
            </span>
          ))}
        </div>
      ),
    },
    {
      title: "进度",
      width: 300,
      render: (_: unknown, d: PublishDraft) => {
        const ts = tasksFor(d.id);
        const n = countBuckets(ts);
        const ok = n.ok;
        const filled = n.needs_you + n.confirming + n.dismissed;
        const run = ts.filter((t) => RUNNING.includes(t.status)).length;
        const bad = n.failed;
        const w = (x: number) => (ts.length ? (x / ts.length) * 100 : 0) + "%";
        const done = ok + filled + bad;
        const needs = groupByReason(ts.filter((t) => taskBucket(t) === "needs_you"), (p) => platformMap[p].name);
        return (
          <div className="progress-cell">
            <div className="bar">
              <i style={{ width: w(ok) }} />
              <i className="is-filled" style={{ width: w(filled) }} />
              <i className="is-run" style={{ width: w(run) }} />
              {bad > 0 && <em style={{ width: w(bad) }} />}
            </div>
            <span className="num">
              {done}/{ts.length}
              {run > 0 && <span> · 填写中 {run}</span>}
              {ok > 0 && <span> · 已发布 {ok}</span>}
              {n.confirming > 0 && <span> · 等后台确认 {n.confirming}</span>}
              {n.needs_you > 0 && <b className="needs-you" title={needs.join("\n")}> · 待你处理 {n.needs_you}</b>}
              {bad > 0 && <b> · 失败 {bad}</b>}
            </span>
            {d.autoSubmit && run === 0 && n.needs_you > 0 && <span className="needs-you-why">{needs.join("；")}</span>}
          </div>
        );
      },
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      width: 170,
      render: (x: string) => <span className="num muted">{new Date(x).toLocaleString("zh-CN", { hour12: false })}</span>,
    },
    {
      title: "",
      width: 56,
      render: (_: unknown, d: PublishDraft) => {
        if (isRunning(d.id))
          return <Button size="small" type="text" icon={<DeleteOutlined />} disabled title="正在填写，完成后才能删除" aria-label="删除记录" />;
        const waiting = tasksFor(d.id).filter((t) => t.status === "manual_required").length;
        return (
          <Popconfirm
            title="删除这条发布记录？"
            description={waiting ? "还有 " + waiting + " 个账号待你点发布，删除后这里不再提醒；平台上已填好的内容不受影响" : "只删除本机记录，不影响平台上已发布的作品"}
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => remove([d.id])}
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} title="删除记录" aria-label="删除记录" />
          </Popconfirm>
        );
      },
    },
  ];
  const whoOf = (t: PublishTask) => {
    const a = data.accounts.find((x) => x.id === t.accountId);
    return (
      <span className="who">
        <PlatformLogo platform={t.platform} />
        {a ? accountWho(a) : "账号已删除"}
      </span>
    );
  };
  const openPublished = async (t: PublishTask) => {
    try {
      await window.fanpost.openPublished(t.id);
      setDetail(undefined);
      await openTask(t);
    } catch (error) {
      message.error("打开失败：" + (error instanceof Error ? error.message : String(error)));
    }
  };
  const taskActions = (t: PublishTask) => (
    <Space wrap size={6}>
      {t.status !== "success" && (
        <Button size="small" type="primary" onClick={() => openTask(t)}>
          {t.status === "failed" ? "打开发布页看原因" : t.status === "dismissed" ? "重新打开发布页" : t.openedAt ? "再打开（已打开过）" : "打开发布页"}
        </Button>
      )}
      {t.status === "success" && t.publishedUrl && (
        <Button size="small" onClick={() => void openPublished(t)}>
          打开作品管理
        </Button>
      )}
      {t.status !== "success" && (
        <Button size="small" loading={checking === t.id} onClick={() => void check(t)}>
          检查是否已发布
        </Button>
      )}
      {!DONE.includes(t.status) && (
        <Button size="small" onClick={async () => setData(await window.fanpost.completeTask(t.id))}>
          标记成功
        </Button>
      )}
      {t.status === "manual_required" && (
        <Button size="small" type="text" onClick={async () => setData(await window.fanpost.dismissTasks([t.id]))}>
          忽略
        </Button>
      )}
      {!DONE.includes(t.status) && (
        <Button size="small" danger type="text" onClick={() => { setFailTask(t); setReason(""); }}>
          标记失败
        </Button>
      )}
    </Space>
  );
  return (
    <section className="panel records">
      <header className="panel-head">
        <h3>发布记录</h3>
        <span className="muted">点标题查看每个平台的状态</span>
        {drafts.length > 0 && (
          <Space size={6} className="records-clear">
            <Popconfirm
              title={"清除 " + finished.length + " 条已完成的记录？"}
              description="只清全部账号都已发布、失败或已忽略的批次，待你点发布的保留"
              okText="清除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              disabled={!finished.length}
              onConfirm={() => remove(finished.map((d) => d.id))}
            >
              <Button size="small" icon={<DeleteOutlined />} disabled={!finished.length}>
                清除已完成{finished.length ? " " + finished.length : ""}
              </Button>
            </Popconfirm>
            <Popconfirm
              title={"清除全部 " + removable.length + " 条" + (type === "video" ? "视频" : "图文") + "记录？"}
              description={(waitingTotal ? "其中 " + waitingTotal + " 个账号还在待你点发布，清除后不再提醒；" : "") + "只删除本机记录，平台上已填好或已发布的内容不受影响" + (running ? "；正在填写的这批会保留" : "")}
              okText="全部清除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              disabled={!removable.length}
              onConfirm={() => remove(removable.map((d) => d.id))}
            >
              <Button size="small" danger disabled={!removable.length}>
                全部清除
              </Button>
            </Popconfirm>
          </Space>
        )}
      </header>
      <Table
        rowKey="id"
        dataSource={drafts}
        columns={cols}
        pagination={{ pageSize: RECORDS_PAGE_SIZE, hideOnSinglePage: true, current: Math.min(page, lastPage), onChange: setPage }}
        locale={{ emptyText: <div className="empty-block">还没有发布记录。填好内容点「一键填写」后，进度会出现在这里。</div> }}
        onRow={(d) => ({ onDoubleClick: () => setDetail(d) })}
      />
      <Modal title={detail?.title} width={1120} open={!!detail} footer={null} onCancel={() => setDetail(undefined)} className="detail-modal">
        {detail && (
          <Space wrap className="bulk-open">
            <Button
              type="primary"
              disabled={!tasksFor(detail.id).some((t) => !DONE.includes(t.status))}
              onClick={() => { setDetail(undefined); void openTasks(tasksFor(detail.id).filter((t) => !DONE.includes(t.status))); }}
            >
              一键打开待你处理（{tasksFor(detail.id).filter((t) => !DONE.includes(t.status)).length}）
            </Button>
            <Button
              disabled={!tasksFor(detail.id).some((t) => t.status === "success" && t.publishedUrl)}
              onClick={() => { setDetail(undefined); void openTasks(tasksFor(detail.id).filter((t) => t.status === "success" && t.publishedUrl), true); }}
            >
              一键打开已发布（{tasksFor(detail.id).filter((t) => t.status === "success" && t.publishedUrl).length}）
            </Button>
          </Space>
        )}
        {detail && (
          <div className="task-grid">
            {tasksFor(detail.id).map((t) => (
              <TaskCard key={t.id} task={t} draft={detail} who={whoOf(t)} status={<StatusTag status={t.status} />} actions={taskActions(t)} />
            ))}
          </div>
        )}
      </Modal>
      <Modal
        title="填写失败原因"
        open={!!failTask}
        okText="确认失败"
        cancelText="取消"
        onCancel={() => setFailTask(undefined)}
        onOk={async () => {
          if (!failTask) return;
          setData(await window.fanpost.failTask(failTask.id, reason));
          setFailTask(undefined);
        }}
      >
        <Input.TextArea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：登录过期、平台审核拦截、上传超时" />
      </Modal>
    </section>
  );
}
