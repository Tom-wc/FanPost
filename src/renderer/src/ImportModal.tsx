import { useState } from "react";
import { Alert, Button, Input, Modal, Tabs, message } from "antd";
import { DownloadOutlined, FileExcelOutlined, FolderOpenOutlined } from "@ant-design/icons";
import type { AppData, SavedDraft } from "../../shared/types";
import { ensureLicensed, handleQuota } from "./LicensePanel";

const errText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "").replace(/^QUOTA:/, "");

interface Props {
  open: boolean;
  onClose: () => void;
  setData: (d: AppData) => void;
  onOpenDraft: (d: SavedDraft) => void;
  onBatchDone: () => void;
}

const FIT_NOTE = "导入的草稿发往你上次在图文页选的账号。正文超过 1000 字会按段落截短，图片最多 18 张；某个平台的标题或正文超出上限，会在那个平台的标签页里自动生成缩短版。";

export function ImportModal({ open, onClose, setData, onOpenDraft, onBatchDone }: Props) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const list = (lines: string[]) => <ul className="confirm-issues">{lines.map((l) => <li key={l}>{l}</li>)}</ul>;
  const report = (head: string, lines: string[]) => (lines.length ? Modal.info({ title: head, content: list(lines), okText: "去检查" }) : message.success(head));
  const run = async (name: string, fn: () => Promise<void>) => {
    if (!(await ensureLicensed())) return;
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      if (!handleQuota(e)) message.error(errText(e));
    } finally {
      setBusy("");
    }
  };
  const openOne = (data: AppData, id: string) => {
    setData(data);
    const d = data.savedDrafts.find((x) => x.id === id);
    onClose();
    if (d) onOpenDraft(d);
  };
  const batch = (kind: "sheet" | "folder") =>
    run(kind, async () => {
      const r = await window.fanpost.importNotes(kind);
      if (!r) return;
      setData(r.data);
      onClose();
      onBatchDone();
      report("已导入 " + r.count + " 篇图文，都放进了草稿箱", r.problems);
    });
  const grab = () =>
    run("url", async () => {
      const r = await window.fanpost.grabUrl(url.trim());
      setUrl("");
      openOne(r.data, r.id);
      report("已取到 " + r.imageCount + " 张图" + (r.skippedImages ? "（" + r.skippedImages + " 张没取到或太小）" : ""), [...r.notes, ...(r.imageCount ? [] : ["没取到图片：图文平台至少要 1 张图，请在「图片素材」里添加"])]);
    });
  const doc = () =>
    run("doc", async () => {
      const r = await window.fanpost.importDoc();
      if (!r) return;
      openOne(r.data, r.id);
      report("已导入" + (r.imageCount ? "，带 " + r.imageCount + " 张图" : ""), [...(r.note ? [r.note] : []), ...r.notes, ...(r.imageCount ? [] : ["文档里没有图片：图文平台至少要 1 张图，请在「图片素材」里添加"])]);
    });
  const template = () =>
    run("tpl", async () => {
      const f = await window.fanpost.saveNoteTemplate();
      if (f) message.success("模板已保存：" + f);
    });
  const items = [
    {
      key: "sheet",
      label: "表格批量",
      children: (
        <div className="import-pane">
          <p className="muted">Excel 每行一篇：「标题」「正文」「话题」「图片」四列。图片填图片路径（多张用分号隔开）或一个图片文件夹，可以写相对表格所在文件夹的路径。一次最多 100 行。</p>
          <div className="import-actions">
            <Button type="primary" icon={<FileExcelOutlined />} loading={busy === "sheet"} onClick={() => void batch("sheet")}>选择表格</Button>
            <Button icon={<DownloadOutlined />} loading={busy === "tpl"} onClick={() => void template()}>下载模板</Button>
          </div>
        </div>
      ),
    },
    {
      key: "folder",
      label: "文件夹批量",
      children: (
        <div className="import-pane">
          <p className="muted">选一个总文件夹，里面每个子文件夹生成一篇：子文件夹里的图片按文件名顺序作为素材，txt 文件作为文案（第一行短于 30 字当标题，# 开头的行当话题）。没有子文件夹时，整个文件夹当一篇。</p>
          <div className="import-actions">
            <Button type="primary" icon={<FolderOpenOutlined />} loading={busy === "folder"} onClick={() => void batch("folder")}>选择文件夹</Button>
          </div>
        </div>
      ),
    },
    {
      key: "url",
      label: "网页取图文",
      children: (
        <div className="import-pane">
          <p className="muted">粘贴文章网址，取出图片和文字存成一篇图文草稿。别人的内容会记下来源，声明默认「内容为转载」，照搬太多不能发。</p>
          <Input.Search placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} enterButton="获取" loading={busy === "url"} onSearch={() => url.trim() && void grab()} />
        </div>
      ),
    },
    {
      key: "doc",
      label: "文档",
      children: (
        <div className="import-pane">
          <p className="muted">Word（docx）、PPT（pptx）里的文字和图片生成一篇草稿；也支持 Markdown、txt、PDF（只取文字）。</p>
          <div className="import-actions">
            <Button type="primary" loading={busy === "doc"} onClick={() => void doc()}>选择文件</Button>
          </div>
        </div>
      ),
    },
  ];
  return (
    <Modal title="导入图文" open={open} onCancel={() => !busy && onClose()} footer={null} width={640} destroyOnHidden>
      <Tabs items={items} />
      <Alert type="info" showIcon className="import-note" message={FIT_NOTE} />
    </Modal>
  );
}
