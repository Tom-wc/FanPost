import { useMemo, useState } from "react";
import { Badge, Button, Drawer, Empty, List, Popconfirm, Segmented, Space, Tag, Typography, message } from "antd";
import {
  BellOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import type { AppData, AppNotification, PublishTask } from "../../shared/types";
import { PlatformLogo } from "./PlatformLogo";
import { accountWho } from "../../shared/accounts";
import { splitCheck } from "../../shared/content-check";
import { CheckBadge } from "./TaskMessage";
import { taskBucket } from "../../shared/task-outcome";

type Filter = "todo" | "all" | "unread";
const levelIcon = {
  success: <CheckCircleOutlined className="lv-success" />,
  error: <CloseCircleOutlined className="lv-error" />,
  warning: <ExclamationCircleOutlined className="lv-warning" />,
  info: <InfoCircleOutlined className="lv-info" />,
};

export function NotificationBell({ data, onOpen }: { data: AppData; onOpen: () => void }) {
  const unread = data.notifications.filter((n) => !n.read).length;
  const todo =
    data.accounts.filter((a) => a.loginStatus === "logged_out").length +
    data.tasks.filter((t) => t.status === "manual_required").length;
  return (
    <button className={"rail-item bell" + (todo ? " has-todo" : "")} onClick={onOpen} aria-label={"通知中心，未读 " + unread + "，待办 " + todo}>
      <Badge count={unread} overflowCount={99} size="small" offset={[4, -2]}>
        <BellOutlined className="glyph" />
      </Badge>
      <span className="rail-label">{todo ? "待办 " + todo : "通知"}</span>
    </button>
  );
}

export function NotificationCenter({
  open,
  onClose,
  data,
  setData,
  onShowAccount,
  onOpenTask,
  onOpenTasks,
}: {
  open: boolean;
  onClose: () => void;
  data: AppData;
  setData: (d: AppData) => void;
  onShowAccount: (accountId: string) => void;
  onOpenTask: (task: PublishTask) => Promise<void>;
  onOpenTasks: (list: PublishTask[], published?: boolean) => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>("todo"),
    [patrolling, setPatrolling] = useState(false),
    [checking, setChecking] = useState<string>();
  const offline = data.accounts.filter((a) => a.loginStatus === "logged_out");
  const manual = data.tasks.filter((t) => t.status === "manual_required").sort((a, b) => Number(!!a.openedAt) - Number(!!b.openedAt));
  const running = data.tasks.filter((t) => ["pending", "opening", "uploading", "publishing"].includes(t.status));
  const list = useMemo(
    () => (filter === "unread" ? data.notifications.filter((n) => !n.read) : data.notifications),
    [data.notifications, filter],
  );
  const accountLabel = (id?: string) => {
    const a = data.accounts.find((x) => x.id === id);
    return a ? accountWho(a) : "";
  };
  const patrol = async () => {
    setPatrolling(true);
    try {
      const r = await window.fanpost.patrolAccounts();
      setData(r.data);
      if (r.skipped) message.info("巡检正在进行中，请稍候");
      else message.success("已检测 " + r.checked + " 个账号，掉线 " + r.offline + " 个");
    } catch (error) {
      message.error("巡检失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setPatrolling(false);
    }
  };
  const check = async (task: PublishTask) => {
    setChecking(task.id);
    try {
      const r = await window.fanpost.checkTask(task.id);
      setData(r.data);
      if (r.ok) message.success("后台已找到该作品，已标记发布成功");
      else message.info("暂未找到：" + (r.reason || "作品管理里没有该标题"));
    } catch (error) {
      message.error("检查失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setChecking(undefined);
    }
  };
  const failedTask = (n: AppNotification) =>
    n.kind === "publish_failed" && n.taskId ? data.tasks.find((t) => t.id === n.taskId && t.status === "failed") : undefined;
  const markRead = async (n: AppNotification) => {
    if (!n.read) setData(await window.fanpost.readNotifications([n.id]));
  };
  return (
    <Drawer
      title="通知中心"
      open={open}
      onClose={onClose}
      size={460}
      extra={
        <Space>
          <Button size="small" onClick={async () => setData(await window.fanpost.readNotifications("all"))}>
            全部已读
          </Button>
          <Button size="small" onClick={async () => setData(await window.fanpost.clearNotifications())}>
            清除已读
          </Button>
        </Space>
      }
    >
      <Segmented
        block
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        options={[
          { value: "todo", label: "待处理 " + (offline.length + manual.length) },
          { value: "unread", label: "未读 " + data.notifications.filter((n) => !n.read).length },
          { value: "all", label: "全部" },
        ]}
      />
      {filter === "todo" ? (
        <div className="todo-panel">
          <div className="todo-section">
            <div className="todo-head">
              <b>账号登录状态</b>
              <Button size="small" icon={<SyncOutlined spin={patrolling} />} loading={patrolling} onClick={() => void patrol()}>
                立即检测全部账号
              </Button>
            </div>
            <Typography.Text type="secondary" className="todo-note">
              每 30 分钟自动巡检一次（发布进行中时跳过），掉线会弹系统通知。
            </Typography.Text>
            {offline.length === 0 ? (
              <div className="todo-ok">全部 {data.accounts.length} 个账号在线</div>
            ) : (
              offline.map((a) => (
                <div className="todo-item" key={a.id}>
                  <PlatformLogo platform={a.platform} />
                  <span>{accountWho(a)}</span>
                  <Tag color="error">已掉线</Tag>
                  <Button size="small" type="primary" onClick={() => { onShowAccount(a.id); onClose(); }}>
                    去登录
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className="todo-section">
            <div className="todo-head">
              <b>待你点发布 {manual.length}</b>
              {manual.length > 1 && (
                <Button size="small" type="primary" onClick={() => { void onOpenTasks(manual); onClose(); }}>
                  一键全部打开
                </Button>
              )}
              {manual.length > 0 && (
                <Popconfirm
                  title={"忽略全部 " + manual.length + " 条待发布？"}
                  description="不再提醒，内容仍在草稿和发布记录里，可随时重新打开发布页"
                  okText="全部忽略"
                  cancelText="取消"
                  onConfirm={async () => setData(await window.fanpost.dismissAllTasks())}
                >
                  <Button size="small">全部清空</Button>
                </Popconfirm>
              )}
            </div>
            {manual.length > 0 && (
              <Typography.Text type="secondary" className="todo-note">
                点「打开发布页」去发布，离开页面后会自动去后台确认，找到作品就自动消失。
              </Typography.Text>
            )}
            {manual.length === 0 ? (
              <div className="todo-ok">没有待处理的发布</div>
            ) : (
              manual.map((t) => (
                <div className={"todo-task" + (t.openedAt ? " is-opened" : "")} key={t.id}>
                  <div className="todo-item">
                    <PlatformLogo platform={t.platform} />
                    <span title={t.title}>{accountLabel(t.accountId)} · {t.title}</span>
                    {taskBucket(t) === "confirming" && <span className="opened-tag">等后台确认</span>}
                    {/^自动发布未/.test(t.message) && <span className="opened-tag is-warn">自动发布没成功</span>}
                    {t.openedAt && <span className="opened-tag">已打开{new Date(t.openedAt).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" })}</span>}
                  </div>
                  <Typography.Paragraph type="secondary" ellipsis={{ rows: 2, expandable: true }} className="todo-msg">
                    {t.message && splitCheck(t.message).text}
                  </Typography.Paragraph>
                  <CheckBadge message={t.message} />
                  <Space wrap>
                    <Button size="small" type="primary" onClick={() => { void onOpenTask(t); onClose(); }}>
                      {t.openedAt ? "再打开" : "打开发布页"}
                    </Button>
                    <Button size="small" loading={checking === t.id} onClick={() => void check(t)}>
                      检查是否已发布
                    </Button>
                    <Button size="small" onClick={async () => setData(await window.fanpost.completeTask(t.id))}>
                      标记成功
                    </Button>
                    <Button size="small" type="text" onClick={async () => setData(await window.fanpost.dismissTasks([t.id]))}>
                      忽略
                    </Button>
                  </Space>
                </div>
              ))
            )}
          </div>
          {running.length > 0 && (
            <div className="todo-section">
              <div className="todo-head">
                <b>进行中 {running.length}</b>
              </div>
              {running.map((t) => (
                <div className="todo-item" key={t.id}>
                  <PlatformLogo platform={t.platform} />
                  <span>{accountLabel(t.accountId)}</span>
                  <Typography.Text type="secondary" ellipsis className="todo-running">{t.message}</Typography.Text>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : list.length === 0 ? (
        <Empty className="todo-empty" description="暂无通知" />
      ) : (
        <List
          className="notify-list"
          dataSource={list}
          renderItem={(n) => (
            <List.Item
              className={n.read ? "read" : "unread"}
              onClick={() => void markRead(n)}
              actions={
                n.accountId && n.kind === "account_offline" && n.level === "error"
                  ? [<Button key="go" size="small" type="link" onClick={() => { onShowAccount(n.accountId!); onClose(); }}>去登录</Button>]
                  : failedTask(n)
                    ? [<Button key="open" size="small" type="link" onClick={() => { void onOpenTask(failedTask(n)!); onClose(); }}>打开发布页看原因</Button>]
                    : undefined
              }
            >
              <List.Item.Meta
                avatar={levelIcon[n.level]}
                title={n.title}
                description={
                  <>
                    <Typography.Paragraph type="secondary" ellipsis={{ rows: 2, expandable: true }} className="todo-msg">
                      {n.message}
                    </Typography.Paragraph>
                    <small>{new Date(n.createdAt).toLocaleString("zh-CN")}</small>
                  </>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Drawer>
  );
}
