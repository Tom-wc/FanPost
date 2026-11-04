import { useEffect, useState, type ReactNode } from "react";
import { Image } from "antd";
import type { PublishDraft, PublishTask } from "../../shared/types";
import { contentFor } from "../../shared/platform-rules";
import { useThumbs } from "./MediaPicker";
import { TaskMessage } from "./TaskMessage";

const LIVE_REFRESH_MS = 3000;
const RUNNING: PublishTask["status"][] = ["opening", "uploading", "publishing"];
const MAX_THUMBS = 4;

function useTaskImage(task: PublishTask) {
  const [src, setSrc] = useState("");
  const running = RUNNING.includes(task.status);
  useEffect(() => {
    let alive = true;
    const load = () =>
      window.fanpost
        .previewTask(task.id)
        .then((r) => alive && setSrc((old) => (running ? r.live || old : r.snapshot)))
        .catch(() => undefined);
    if (!running && !task.snapshotPath) {
      setSrc("");
      return;
    }
    void load();
    const timer = running ? setInterval(load, LIVE_REFRESH_MS) : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [task.id, running, task.snapshotPath]);
  return { src, running };
}

function ContentPreview({ draft, task }: { draft: PublishDraft; task: PublishTask }) {
  const c = contentFor(draft, task.platform);
  const media = draft.type === "image_text" ? draft.mediaPaths : c.coverPath ? [c.coverPath] : [];
  const thumbs = useThumbs(media.slice(0, MAX_THUMBS));
  return (
    <div className="content-preview">
      <b className="content-preview-title">{c.title || "（无标题）"}</b>
      {c.description && <p>{c.description}</p>}
      {c.topics.length > 0 && <div className="content-preview-topics">{c.topics.map((t) => "#" + t).join(" ")}</div>}
      <div className="content-preview-media">
        {media.slice(0, MAX_THUMBS).map((p) => (thumbs[p] ? <img key={p} src={thumbs[p]} alt="" /> : null))}
        <span className="muted">
          {draft.type === "video" ? "视频 " + draft.mediaPaths.length + " 个" : "图片 " + draft.mediaPaths.length + " 张"}
        </span>
      </div>
    </div>
  );
}

export function TaskCard({
  task,
  draft,
  who,
  status,
  actions,
}: {
  task: PublishTask;
  draft: PublishDraft;
  who: ReactNode;
  status: ReactNode;
  actions: ReactNode;
}) {
  const { src, running } = useTaskImage(task);
  return (
    <article className={"task-card is-" + task.status}>
      <header className="task-card-head">
        {who}
        {status}
      </header>
      <div className="task-card-preview">
        {src ? (
          <>
            <Image src={src} alt={"发布页画面：" + task.title} preview={{ mask: running ? "放大看实时画面" : "放大查看" }} />
            {running && <span className="live-badge">实时</span>}
          </>
        ) : running ? (
          <div className="preview-empty muted">正在打开发布页…</div>
        ) : (
          <ContentPreview draft={draft} task={task} />
        )}
      </div>
      {task.message && <TaskMessage message={task.message} />}
      <footer className="task-card-actions">{actions}</footer>
    </article>
  );
}
