import { useRef, useState, type RefObject } from "react";
import { Button, Modal } from "antd";
import type { LeaveGuard } from "./PublishComposer";

type Choice = "save" | "discard" | "cancel";

const DRAFT_TEXT = { title: "是否保存草稿？", body: "不保存的话，已填的素材、标题、正文、话题和分平台内容都会清空。", save: "保存草稿" };

export function useLeaveConfirm(guard: RefObject<LeaveGuard | undefined>) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState(DRAFT_TEXT);
  const resolver = useRef<((ok: boolean) => void) | undefined>(undefined);
  const finish = (ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = undefined;
  };
  const choose = async (choice: Choice) => {
    if (choice !== "save") return finish(choice === "discard");
    setSaving(true);
    const ok = (await guard.current?.save()) ?? true;
    setSaving(false);
    if (ok) finish(true);
  };
  const confirm = () => {
    if (!guard.current?.isDirty()) return Promise.resolve(true);
    resolver.current?.(false);
    setText(guard.current.text ?? DRAFT_TEXT);
    setOpen(true);
    return new Promise<boolean>((resolve) => (resolver.current = resolve));
  };
  const modal = (
    <Modal
      open={open}
      title={text.title}
      onCancel={() => void choose("cancel")}
      maskClosable={false}
      footer={[
        <Button key="cancel" onClick={() => void choose("cancel")}>
          取消
        </Button>,
        <Button key="discard" danger onClick={() => void choose("discard")}>
          不保存离开
        </Button>,
        <Button key="save" type="primary" loading={saving} onClick={() => void choose("save")}>
          {text.save}
        </Button>,
      ]}
    >
      <p>{text.body}</p>
    </Modal>
  );
  return { confirm, modal };
}
