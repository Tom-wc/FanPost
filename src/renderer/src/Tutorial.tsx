import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Drawer, Empty, Input, Spin } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { Marked } from "marked";
import { TUTORIAL_SECTIONS, slugify, topicSlug, tutorialHeadings, type TutorialTopic } from "../../shared/tutorial";

type Listener = (slug: string) => void;
const listeners = new Set<Listener>();

export const openTutorial = (topic?: TutorialTopic) => {
  const slug = topic ? topicSlug(topic) : "";
  listeners.forEach((l) => l(slug));
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function render(markdown: string) {
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading({ tokens, depth, text }) {
        return `<h${depth} id="${escapeHtml(slugify(text))}">${this.parser.parseInline(tokens)}</h${depth}>`;
      },
      image({ href, text }) {
        const name = href.replace(/^\.?\/?images\//, "");
        return `<img src="fpdoc://local/${encodeURIComponent(name)}" alt="${escapeHtml(text)}" loading="lazy" />`;
      },
      html() {
        return "";
      },
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (href.startsWith("#")) return `<a href="${escapeHtml(href)}" data-anchor="1">${inner}</a>`;
        return `<span class="tut-ext">${inner}</span>`;
      },
    },
  });
  return md.parse(markdown, { async: false }) as string;
}

export function TutorialHost({ onOverlay }: { onOverlay: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [target, setTarget] = useState("");
  const [query, setQuery] = useState("");
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => onOverlay(open), [open]);

  useEffect(() => {
    const l: Listener = (slug) => {
      setTarget(slug);
      setOpen(true);
    };
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  useEffect(() => {
    if (!open || source !== undefined) return;
    window.fanpost
      .getTutorial()
      .then(setSource)
      .catch(() => setFailed(true));
  }, [open, source]);

  const html = useMemo(() => (source ? render(source) : ""), [source]);
  const toc = useMemo(() => (source ? tutorialHeadings(source).filter((h) => h.depth === 2 && h.text !== "目录") : []), [source]);
  const shown = query.trim() ? toc.filter((h) => h.text.includes(query.trim())) : toc;

  const jump = (slug: string) => {
    const el = slug ? body.current?.querySelector<HTMLElement>(`[id="${CSS.escape(slug)}"]`) : undefined;
    if (el) el.scrollIntoView({ block: "start" });
    else body.current?.scrollTo({ top: 0 });
  };

  useEffect(() => {
    if (!open || !html) return;
    const t = setTimeout(() => jump(target), 60);
    return () => clearTimeout(t);
  }, [open, html, target]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a[data-anchor]");
    if (!a) return;
    e.preventDefault();
    jump(decodeURIComponent((a.getAttribute("href") || "").slice(1)));
  };

  return (
    <Drawer open={open} onClose={() => setOpen(false)} width="min(1080px, 92vw)" title="使用教程" destroyOnHidden={false} className="tutorial-drawer">
      {failed ? (
        <Empty description="教程文件读取失败，请重新安装软件" />
      ) : !source ? (
        <Spin />
      ) : (
        <div className="tutorial">
          <aside className="tutorial-toc">
            <Input allowClear size="small" placeholder="搜索章节" value={query} onChange={(e) => setQuery(e.target.value)} />
            <ul>
              {shown.map((h) => (
                <li key={h.slug}>
                  <button className={h.slug === target ? "active" : ""} onClick={() => { setTarget(h.slug); jump(h.slug); }}>{h.text}</button>
                </li>
              ))}
            </ul>
          </aside>
          <div ref={body} className="tutorial-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      )}
    </Drawer>
  );
}

export function HelpLink({ topic, label = "查看教程" }: { topic: TutorialTopic; label?: string }) {
  return (
    <Button type="link" size="small" className="help-link" icon={<QuestionCircleOutlined />} title={"教程：" + TUTORIAL_SECTIONS[topic]} onClick={() => openTutorial(topic)}>
      {label}
    </Button>
  );
}
