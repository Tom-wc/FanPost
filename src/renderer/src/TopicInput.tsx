import { useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { AutoComplete, Input } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { mergeTopics, replaceTopic, splitTopics } from "../../shared/topics";

export function TopicInput({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  options: string[];
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<number>();
  const [editText, setEditText] = useState("");
  const commit = (raw: string) => {
    const parts = splitTopics(raw);
    if (parts.length) onChange(mergeTopics(value, parts));
    setDraft("");
  };
  const onDraftChange = (text: string) => {
    if (/[\s\u00a0\u3000,，、;；]$/u.test(text) && splitTopics(text).length) return commit(text);
    setDraft(text);
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (splitTopics(text).length < 2 && !/[\s\u00a0\u3000,，、;；#＃]/u.test(text.trim())) return;
    e.preventDefault();
    commit(draft + " " + text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && draft.trim()) {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      startEdit(value.length - 1);
    }
  };
  const startEdit = (i: number) => {
    if (disabled) return;
    setEditing(i);
    setEditText(value[i]);
  };
  const finishEdit = () => {
    if (editing === undefined) return;
    onChange(replaceTopic(value, editing, editText));
    setEditing(undefined);
  };
  const remove = (i: number) => onChange(value.filter((_, n) => n !== i));
  const suggestions = options.filter((o) => !value.includes(o) && (!draft || o.includes(draft.trim()))).slice(0, 12);
  return (
    <div className={"topic-input" + (disabled ? " is-disabled" : "")}>
      {value.map((t, i) =>
        editing === i ? (
          <Input
            key={i + ":edit"}
            size="small"
            autoFocus
            className="topic-edit"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={finishEdit}
            onPressEnter={finishEdit}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(undefined);
            }}
            style={{ width: Math.max(4, Array.from(editText).length + 2) + "em" }}
            aria-label={"编辑话题 " + t}
          />
        ) : (
          <span key={i + ":" + t} className="topic-chip">
            <button type="button" className="topic-chip-text" onClick={() => startEdit(i)} disabled={disabled} title="点击编辑">
              #{t}
            </button>
            <button type="button" className="topic-chip-x" onClick={() => remove(i)} disabled={disabled} aria-label={"删除话题 " + t}>
              <CloseOutlined />
            </button>
          </span>
        ),
      )}
      <AutoComplete
        className="topic-draft"
        value={draft}
        disabled={disabled}
        options={suggestions.map((o) => ({ value: o, label: "#" + o }))}
        onSelect={(o: string) => commit(o)}
        onChange={onDraftChange}
        popupMatchSelectWidth={false}
      >
        <Input
          variant="borderless"
          placeholder={value.length ? "继续添加" : "输入话题，空格、逗号或回车分隔；可直接粘贴整串"}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && commit(draft)}
          aria-label="添加话题"
        />
      </AutoComplete>
    </div>
  );
}
