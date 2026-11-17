import { useMemo, useState } from "react";
import { Button, Popconfirm, Table, message } from "antd";
import { DeleteOutlined, EditOutlined, SendOutlined } from "@ant-design/icons";
import type { AppData, ContentType, SavedDraft } from "../../shared/types";
import { draftLabel } from "../../shared/drafts";
import { platformMap } from "../../shared/platforms";
import { PlatformLogo } from "./PlatformLogo";

export function DraftList({
  type,
  data,
  setData,
  onEdit,
}: {
  type: ContentType;
  data: AppData;
  setData: (d: AppData) => void;
  onEdit: (draft: SavedDraft) => void;
}) {
  const drafts = useMemo(() => data.savedDrafts.filter((d) => d.type === type), [data.savedDrafts, type]);
  const [picked, setPicked] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const ready = (d: SavedDraft) => d.mediaPaths.length > 0 && d.accountIds.length > 0 && !!d.title.trim();
  const publish = async (ids: string[]) => {
    setSending(true);
    try {
      const r = await window.fanpost.publishSaved(ids);
      setData(r.data);
      setPicked([]);
      message.success("已排入发布队列 " + r.queued + " 条，按顺序自动填写并发布，进度见顶栏和发布记录" + (r.skipped ? "；" + r.skipped + " 条缺素材/标题/账号已跳过" : ""), 6);
      if (r.failed.length) message.error("未能发布：" + r.failed.join("；"), 8);
    } catch (error) {
      message.error(error instanceof Error ? error.message.replace(/^Error invoking remote method [^:]+: (Error: )?/, "") : String(error));
    } finally {
      setSending(false);
    }
  };
  const remove = async (id: string) => {
    try {
      setData(await window.fanpost.removeDraft(id));
      message.success("草稿已删除");
    } catch (error) {
      message.error("删除草稿失败：" + (error instanceof Error ? error.message : String(error)));
    }
  };
  const platformsOf = (d: SavedDraft) =>
    Array.from(new Set(data.accounts.filter((a) => d.accountIds.includes(a.id)).map((a) => a.platform)));
  const cols = [
    {
      title: "草稿",
      key: "title",
      render: (_: unknown, d: SavedDraft) => (
        <button type="button" className="record-title" onClick={() => onEdit(d)} title="继续编辑">
          {draftLabel(d)}
        </button>
      ),
    },
    {
      title: "素材",
      key: "media",
      width: 110,
      render: (_: unknown, d: SavedDraft) => (
        <span className="muted">{d.mediaPaths.length ? (type === "video" ? "1 个视频" : d.mediaPaths.length + " 张图") : "未添加"}</span>
      ),
    },
    {
      title: "账号",
      key: "accounts",
      width: 200,
      render: (_: unknown, d: SavedDraft) => {
        const ps = platformsOf(d);
        return ps.length ? (
          <span className="draft-platforms" title={ps.map((p) => platformMap[p].name).join("、")}>
            {ps.map((p) => (
              <PlatformLogo key={p} platform={p} />
            ))}
            <span className="muted num">{d.accountIds.length} 个</span>
          </span>
        ) : (
          <span className="muted">未选</span>
        );
      },
    },
    {
      title: "保存时间",
      dataIndex: "updatedAt",
      width: 190,
      render: (x: string) => <span className="num muted">{new Date(x).toLocaleString("zh-CN", { hour12: false })}</span>,
    },
    {
      title: "操作",
      key: "ops",
      width: 170,
      render: (_: unknown, d: SavedDraft) => (
        <span className="draft-ops">
          <Button size="small" type="primary" ghost icon={<EditOutlined />} onClick={() => onEdit(d)}>
            继续编辑
          </Button>
          <Popconfirm title="删除这条草稿？" okText="删除" okButtonProps={{ danger: true }} cancelText="取消" onConfirm={() => remove(d.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} aria-label={"删除草稿 " + draftLabel(d)} />
          </Popconfirm>
        </span>
      ),
    },
  ];
  return (
    <section className="panel records">
      <header className="panel-head">
        <h3>草稿箱</h3>
        <span className="muted">勾选后可一键发布；点「继续编辑」回到发布页接着填</span>
        <span className="draft-bulk">
          <Button size="small" onClick={() => setPicked(picked.length ? [] : drafts.filter(ready).map((d) => d.id))} disabled={!drafts.some(ready)}>
            {picked.length ? "取消全选" : "全选"}
          </Button>
          <Popconfirm title={"一键发布选中的 " + picked.length + " 条草稿？"} description="按顺序逐条自动填写并发布，图文在前视频在后" okText="发布" cancelText="取消" disabled={!picked.length} onConfirm={() => publish(picked)}>
            <Button size="small" type="primary" icon={<SendOutlined />} loading={sending} disabled={!picked.length}>
              一键发布{picked.length ? " " + picked.length + " 条" : ""}
            </Button>
          </Popconfirm>
        </span>
      </header>
      <Table
        rowKey="id"
        rowSelection={{ selectedRowKeys: picked, onChange: (keys) => setPicked(keys as string[]), getCheckboxProps: (d: SavedDraft) => ({ disabled: !ready(d) }) }}
        dataSource={drafts}
        columns={cols}
        pagination={{ pageSize: 8, hideOnSinglePage: true }}
        locale={{ emptyText: <div className="empty-block">还没有草稿。在发布页填了内容后点「保存草稿」，会出现在这里。</div> }}
      />
    </section>
  );
}
