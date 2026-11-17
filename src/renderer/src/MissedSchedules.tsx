import { useEffect, useState } from "react";
import { Alert, Button, Modal, Space, Tag } from "antd";
import dayjs from "dayjs";
import { ClockCircleOutlined } from "@ant-design/icons";

interface Missed {
  id: string;
  title: string;
  type: "video" | "image_text";
  scheduledAt: string;
  pending: number;
}

export function MissedSchedules() {
  const [list, setList] = useState<Missed[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      void window.fanpost
        .getMissedSchedules()
        .then((items) => {
          if (items.length) {
            setList(items);
            setOpen(true);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearTimeout(t);
  }, []);
  const run = async (id: string) => {
    setBusy(id);
    try {
      await window.fanpost.runScheduledNow(id);
      setList((l) => l.filter((x) => x.id !== id));
    } catch {
      setBusy("");
    }
  };
  const later = (id: string) => setList((l) => l.filter((x) => x.id !== id));
  return (
    <Modal
      open={open && list.length > 0}
      title="有定时任务到点了，但当时软件没在运行"
      width={560}
      onCancel={() => setOpen(false)}
      footer={<Button onClick={() => setOpen(false)}>稍后处理</Button>}
    >
      <Alert
        type="warning"
        showIcon
        title="定时任务靠这台电脑执行：软件没开或电脑睡眠时，到点了不会自动发。"
        description="下面这些任务还没开始，可以现在就跑，也可以改个新时间；不处理的话它们会一直停在「排队中」。"
        style={{ marginBottom: 12 }}
      />
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        {list.map((m) => (
          <div className="missed-row" key={m.id}>
            <span className="grow">
              <b>{m.title}</b>
              <small className="muted">
                {m.type === "video" ? "视频" : "图文"} · 原定 {dayjs(m.scheduledAt).format("MM-DD HH:mm")} · {m.pending} 个账号待发
              </small>
            </span>
            <Tag icon={<ClockCircleOutlined />} color="orange">
              已过期
            </Tag>
            <Button type="primary" size="small" loading={busy === m.id} onClick={() => void run(m.id)}>
              现在开始
            </Button>
            <Button size="small" onClick={() => later(m.id)}>
              稍后
            </Button>
          </div>
        ))}
      </Space>
    </Modal>
  );
}
