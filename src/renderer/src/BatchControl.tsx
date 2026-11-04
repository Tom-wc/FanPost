import { useEffect, useState } from "react";
import { Button, Popconfirm, Popover, Tooltip } from "antd";
import { CaretRightOutlined, DownOutlined, PauseOutlined, StopOutlined } from "@ant-design/icons";
import type { AppData, TaskStatus } from "../../shared/types";
import type { BatchState } from "../../main/publish-control";
import { accountWho } from "../../shared/accounts";
import { PlatformLogo } from "./PlatformLogo";

const ACTIVE: TaskStatus[] = ["pending", "opening", "uploading", "publishing"];
const ORDER: TaskStatus[] = ["opening", "uploading", "publishing", "pending", "manual_required", "success", "failed", "dismissed"];
const STATUS: Record<TaskStatus, string> = {
  pending: "排队中",
  opening: "填写中",
  uploading: "上传中",
  publishing: "填写中",
  manual_required: "已填好",
  success: "已发布",
  failed: "失败",
  dismissed: "已忽略",
};

export function BatchControl({ data, onOverlay }: { data: AppData; onOverlay: (key: string) => (open: boolean) => void }) {
  const [state, setState] = useState<BatchState>("idle");
  useEffect(() => {
    void window.fanpost.getPublishState().then(setState);
    return window.fanpost.onPublishState(setState);
  }, []);
  if (state === "idle") return null;
  const running = data.tasks.filter((t) => ["opening", "uploading", "publishing"].includes(t.status)).length;
  const waiting = data.tasks.filter((t) => t.status === "pending").length;
  const label =
    state === "stopping" ? "正在停止…" : state === "paused" ? (running ? "暂停中（正在填的 " + running + " 个填完后停住）" : "已暂停") : running ? "正在填写 " + running + " 个" : "等待开始下一个";
  const active = data.tasks.filter((t) => ACTIVE.includes(t.status));
  const draftIds = new Set(active.map((t) => t.draftId));
  const batch = data.tasks
    .filter((t) => draftIds.has(t.draftId))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.createdAt.localeCompare(b.createdAt));
  const list = (
    <div className="batch-queue">
      <header>
        <b>本批填写顺序</b>
        <small className="muted num">{batch.length} 个账号</small>
      </header>
      <ol>
        {batch.map((t) => {
          const a = data.accounts.find((x) => x.id === t.accountId);
          return (
            <li key={t.id} className={"is-" + t.status}>
              <PlatformLogo platform={t.platform} />
              <span className="batch-queue-who">
                <b>{a ? accountWho(a) : "账号已删除"}</b>
                <small>{t.message}</small>
              </span>
              <span className="batch-queue-st">{STATUS[t.status]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
  return (
    <div className={"batch-control is-" + state} role="status" aria-live="polite">
      <span className="batch-dot" aria-hidden />
      <Popover onOpenChange={onOverlay("batch")} content={list} trigger="click" placement="bottomRight" arrow={false} rootClassName="stat-popover">
        <button type="button" className="batch-label" aria-haspopup="dialog">
          {label}
          {waiting > 0 && state !== "stopping" && <span className="muted num"> · 还剩 {waiting} 个</span>}
          <DownOutlined className="batch-caret" aria-hidden />
        </button>
      </Popover>
      {state === "running" && (
        <Tooltip title="正在填的账号会填完，不再开始新的">
          <Button size="small" icon={<PauseOutlined />} onClick={async () => setState(await window.fanpost.pausePublish())}>
            暂停
          </Button>
        </Tooltip>
      )}
      {state === "paused" && (
        <Button size="small" type="primary" icon={<CaretRightOutlined />} onClick={async () => setState(await window.fanpost.resumePublish())}>
          继续
        </Button>
      )}
      {(state === "running" || state === "paused") && (
        <Popconfirm
          onOpenChange={onOverlay("batch-stop")}
          title="停止这一批？"
          description="已填好的保留；还没开始的账号不再填写，标为「已停止」"
          okText="停止"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={async () => setState(await window.fanpost.stopPublish())}
        >
          <Button size="small" danger type="text" icon={<StopOutlined />}>
            停止
          </Button>
        </Popconfirm>
      )}
    </div>
  );
}
