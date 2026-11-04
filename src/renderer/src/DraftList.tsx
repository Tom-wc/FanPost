import { useMemo } from "react";
import { Button, Popconfirm, Table, message } from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
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
      width: 170,
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
        <span className="muted">点「继续编辑」回到发布页接着填；一键填写后草稿自动移出</span>
      </header>
      <Table
        rowKey="id"
        dataSource={drafts}
        columns={cols}
        pagination={{ pageSize: 8, hideOnSinglePage: true }}
        locale={{ emptyText: <div className="empty-block">还没有草稿。在发布页填了内容后点「保存草稿」，会出现在这里。</div> }}
      />
    </section>
  );
}
