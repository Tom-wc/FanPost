import { useEffect, useRef, useState } from "react";
import { Button, Divider, Tooltip, message } from "antd";
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BoldOutlined,
  ClearOutlined,
  DeleteOutlined,
  EyeOutlined,
  ItalicOutlined,
  OrderedListOutlined,
  PictureOutlined,
  RedoOutlined,
  UnderlineOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { imageTag } from "../../shared/mp-html";

interface Props {
  html: string;
  onChange: (html: string) => void;
}

type Cmd = [string, string?];

const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value);

export function MpRichEditor({ html, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const [picked, setPicked] = useState<HTMLImageElement | null>(null);
  const [counts, setCounts] = useState({ body: 0, preview: 0 });
  const recount = () => {
    const imgs = [...(ref.current?.querySelectorAll("img") ?? [])];
    setCounts({ body: imgs.filter((i) => i.dataset.fpKind !== "preview").length, preview: imgs.filter((i) => i.dataset.fpKind === "preview").length });
  };
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== html) ref.current.innerHTML = html;
    recount();
  }, [html]);
  const emit = () => {
    if (!ref.current) return;
    recount();
    onChange(ref.current.innerHTML);
  };
  const keepRange = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount && ref.current?.contains(sel.getRangeAt(0).commonAncestorContainer)) range.current = sel.getRangeAt(0).cloneRange();
  };
  const restore = () => {
    ref.current?.focus();
    const sel = window.getSelection();
    if (range.current && sel) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    }
  };
  const run = ([cmd, value]: Cmd) => {
    restore();
    exec(cmd, value);
    keepRange();
    emit();
  };
  const insertImages = async () => {
    keepRange();
    const files = await window.fanpost.pickFiles("images");
    if (!files.length) return;
    restore();
    if (!range.current) {
      const r = document.createRange();
      r.selectNodeContents(ref.current!);
      r.collapse(false);
      range.current = r;
      restore();
    }
    exec("insertHTML", files.map((f) => imageTag(f)).join(""));
    keepRange();
    emit();
    message.success("已在光标处插入 " + files.length + " 张图");
  };
  const selectImage = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    setPicked(t.tagName === "IMG" ? (t as HTMLImageElement) : null);
  };
  const removePicked = () => {
    if (!picked) return;
    const box = picked.parentElement;
    picked.remove();
    if (box && box !== ref.current && !box.textContent?.trim() && !box.querySelector("img")) box.remove();
    setPicked(null);
    emit();
  };
  const togglePreview = () => {
    if (!picked) return;
    picked.dataset.fpKind = picked.dataset.fpKind === "preview" ? "body" : "preview";
    setPicked(null);
    emit();
  };
  const tools: Array<{ icon: React.ReactNode; tip: string; cmd: Cmd } | "|"> = [
    { icon: <UndoOutlined />, tip: "撤销", cmd: ["undo"] },
    { icon: <RedoOutlined />, tip: "重做", cmd: ["redo"] },
    "|",
    { icon: <BoldOutlined />, tip: "加粗", cmd: ["bold"] },
    { icon: <ItalicOutlined />, tip: "斜体", cmd: ["italic"] },
    { icon: <UnderlineOutlined />, tip: "下划线", cmd: ["underline"] },
    "|",
    { icon: <AlignLeftOutlined />, tip: "左对齐", cmd: ["justifyLeft"] },
    { icon: <AlignCenterOutlined />, tip: "居中", cmd: ["justifyCenter"] },
    { icon: <AlignRightOutlined />, tip: "右对齐", cmd: ["justifyRight"] },
    "|",
    { icon: <OrderedListOutlined />, tip: "编号列表", cmd: ["insertOrderedList"] },
    { icon: <UnorderedListOutlined />, tip: "圆点列表", cmd: ["insertUnorderedList"] },
    { icon: <ClearOutlined />, tip: "清除选中文字的格式", cmd: ["removeFormat"] },
  ];
  return (
    <div className="mp-rich">
      <div className="mp-rich-bar" onMouseDown={(e) => e.preventDefault()}>
        {tools.map((t, i) =>
          t === "|" ? (
            <Divider key={i} type="vertical" />
          ) : (
            <Tooltip key={t.tip} title={t.tip}>
              <Button type="text" size="small" icon={t.icon} aria-label={t.tip} onClick={() => run(t.cmd)} />
            </Tooltip>
          ),
        )}
        <select aria-label="段落样式" defaultValue="" onChange={(e) => { if (e.target.value) run(["formatBlock", e.target.value]); e.target.value = ""; }}>
          <option value="">段落样式</option>
          <option value="p">正文</option>
          <option value="h2">大标题</option>
          <option value="h3">小标题</option>
          <option value="blockquote">引用</option>
        </select>
        <input type="color" aria-label="文字颜色" title="文字颜色" onChange={(e) => run(["foreColor", e.target.value])} />
        <Divider type="vertical" />
        <Button size="small" icon={<PictureOutlined />} onClick={() => void insertImages()}>在光标处插图</Button>
        <span className="mp-rich-count muted">正文图 {counts.body} · 预览图 {counts.preview}</span>
      </div>
      {picked && (
        <div className="mp-rich-imgbar">
          <span>{picked.dataset.fpKind === "preview" ? "这是转发 / 视频 / 小程序的预览图" : "这是正文配图"}</span>
          <Button size="small" icon={<EyeOutlined />} onClick={togglePreview}>{picked.dataset.fpKind === "preview" ? "改成正文配图" : "标成预览图"}</Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={removePicked}>删除这张图</Button>
        </div>
      )}
      <div
        ref={ref}
        className="mp-rich-body"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onInput={emit}
        onBlur={() => { keepRange(); emit(); }}
        onKeyUp={keepRange}
        onMouseUp={keepRange}
        onClick={selectImage}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text/plain");
          if (!text || e.clipboardData.types.includes("Files")) return;
          e.preventDefault();
          exec("insertText", text);
        }}
      />
    </div>
  );
}
