import { useState } from "react";
import { Button, Input, Modal, Popconfirm, Table, Tag, message } from "antd";
import { DeleteOutlined, EditOutlined, ImportOutlined, PlusOutlined } from "@ant-design/icons";
import type { AppData } from "../../shared/types";
import { BLANK_MP, type MpDraft } from "../../shared/mp-drafts";
import { MpEditor } from "./MpEditor";
import { PromoSlotView } from "./Promo";
import { ensureLicensed, handleQuota } from "./LicensePanel";

const errText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "").replace(/^QUOTA:/, "");
type Section = "edit" | "list";

export function MpPage({ data, setData }: { data: AppData; setData: (d: AppData) => void }) {
  const [section, setSection] = useState<Section>("edit");
  const [editing, setEditing] = useState<string>();
  const [key, setKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const draft = data.mpDrafts.find((d) => d.id === editing);
  const open = (id?: string) => {
    setEditing(id);
    setKey((k) => k + 1);
    setSection("edit");
  };
  const doImport = async (kind: "url" | "doc") => {
    if (!(await ensureLicensed())) return;
    setBusy(kind);
    try {
      const r = await window.fanpost.mpImport(kind, url.trim());
      if (!r) return;
      setData(r.data);
      setImportOpen(false);
      setUrl("");
      open(r.id);
      const parts = [r.sourceKind ? "识别为" + r.sourceKind : "", r.bodyImages ? "正文配图 " + r.bodyImages + " 张" : "", r.previewImages ? "转发 / 视频预览图 " + r.previewImages + " 张" : "", r.skippedImages ? r.skippedImages + " 张图没取到" : ""].filter(Boolean);
      message.success("已导入" + (parts.length ? "：" + parts.join("，") : "") + (r.note ? "。" + r.note : ""), 6);
    } catch (e) {
      if (!handleQuota(e)) message.error(errText(e));
    } finally {
      setBusy("");
    }
  };
  const remove = async (id: string) => {
    setData(await window.fanpost.mpRemove(id));
    if (id === editing) open(undefined);
  };
  const cols = [
    { title: "标题", key: "t", render: (_: unknown, d: MpDraft) => <button type="button" className="record-title" onClick={() => open(d.id)}>{d.title || "未命名"}</button> },
    { title: "图片", key: "i", width: 80, render: (_: unknown, d: MpDraft) => <span className="muted">{d.images.length} 张</span> },
    { title: "状态", key: "s", width: 150, render: (_: unknown, d: MpDraft) => (d.savedToMpAt ? <Tag color="success">已存公众号</Tag> : <Tag>只在本机</Tag>) },
    { title: "更新", key: "u", width: 160, render: (_: unknown, d: MpDraft) => <span className="muted num">{new Date(d.updatedAt).toLocaleString()}</span> },
    {
      title: "操作",
      key: "a",
      width: 120,
      render: (_: unknown, d: MpDraft) => (
        <span>
          <Button type="text" icon={<EditOutlined />} aria-label="编辑" onClick={() => open(d.id)} />
          <Popconfirm title="删除这篇？只删本机，不影响公众号草稿箱" okText="删除" cancelText="取消" onConfirm={() => void remove(d.id)}>
            <Button type="text" danger icon={<DeleteOutlined />} aria-label="删除" />
          </Popconfirm>
        </span>
      ),
    },
  ];
  return (
    <div className="publish">
      <div className="publish-bar">
        <div className="switcher" role="tablist">
          <button role="tab" aria-selected={section === "edit"} className={section === "edit" ? "active" : ""} onClick={() => setSection("edit")}>
            {draft ? "编辑文章" : "新建文章"}
          </button>
          <button role="tab" aria-selected={section === "list"} className={section === "list" ? "active" : ""} onClick={() => setSection("list")}>
            文章列表{data.mpDrafts.length > 0 && <b className="num is-soft">{data.mpDrafts.length}</b>}
          </button>
        </div>
        {draft && section === "edit" && (
          <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => open(undefined)}>新建文章</Button>
        )}
        <Button className="import-btn" icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>导入文章 / 文档</Button>
      </div>
      <PromoSlotView slot="mp" variant="strip" />
      {section === "edit" ? (
        <MpEditor key={key} initial={draft ?? BLANK_MP} draft={draft} setData={setData} onSaved={setEditing} />
      ) : (
        <section className="panel">
          <Table rowKey="id" dataSource={data.mpDrafts} columns={cols} pagination={{ pageSize: 20, hideOnSinglePage: true }} locale={{ emptyText: "还没有文章" }} />
        </section>
      )}
      <Modal title="导入到公众号" open={importOpen} onCancel={() => setImportOpen(false)} footer={null} destroyOnHidden>
        <div className="import-pane">
          <p className="muted">粘贴文章网址，或选 Word / Markdown / PDF / PPT / Excel / txt 文档（Word 和 Markdown 保留标题、加粗、列表和图片位置）。公众号文章按原排版取正文和配图（图片放在原来的位置），转发、视频号、小程序只取预览图并单独标出；名片、音频、广告不取。导入后在编辑器里改，再存到公众号。</p>
          <Input.Search placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} enterButton="采集网址" loading={busy === "url"} onSearch={() => url.trim() && void doImport("url")} />
          <Button loading={busy === "doc"} onClick={() => void doImport("doc")}>选择文档</Button>
          <p className="muted">采集别人的文章会记下来源，并默认打开「内容为转载」。和原文重合多时会提醒改写，不拦保存。请只转载你有权使用的内容。</p>
        </div>
      </Modal>
    </div>
  );
}
