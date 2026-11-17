import { useState } from "react";
import { Button, Popover, Tabs } from "antd";
import { SmileOutlined } from "@ant-design/icons";
import { EMOJI_CATEGORIES, RECENT_EMOJI_KEY, RECENT_EMOJI_LIMIT } from "./emoji-data";

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_EMOJI_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, RECENT_EMOJI_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(list));
  } catch {}
}

function Grid({ items, onPick }: { items: string[]; onPick: (emoji: string) => void }) {
  if (!items.length) return <div className="emoji-empty">还没有用过的表情</div>;
  return (
    <div className="emoji-grid" role="listbox">
      {items.map((emoji) => (
        <button key={emoji} type="button" className="emoji-cell" aria-label={emoji} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(emoji)}>
          {emoji}
        </button>
      ))}
    </div>
  );
}

export function EmojiPicker({ onPick, disabled, target }: { onPick: (emoji: string) => void; disabled?: boolean; target: string }) {
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [open, setOpen] = useState(false);
  const pick = (emoji: string) => {
    const next = [emoji, ...recent.filter((x) => x !== emoji)].slice(0, RECENT_EMOJI_LIMIT);
    setRecent(next);
    saveRecent(next);
    onPick(emoji);
  };
  const items = [
    { key: "recent", label: "最近", children: <Grid items={recent} onPick={pick} /> },
    ...EMOJI_CATEGORIES.map((c) => ({ key: c.key, label: c.label, children: <Grid items={c.items} onPick={pick} /> })),
  ];
  return (
    <Popover
      open={open && !disabled}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      content={
        <div className="emoji-panel">
          <div className="emoji-target">插入到：{target}</div>
          <Tabs size="small" defaultActiveKey={recent.length ? "recent" : EMOJI_CATEGORIES[0].key} items={items} />
        </div>
      }
    >
      <Button size="small" type="text" icon={<SmileOutlined />} disabled={disabled} onMouseDown={(e) => e.preventDefault()}>
        表情符号
      </Button>
    </Popover>
  );
}
