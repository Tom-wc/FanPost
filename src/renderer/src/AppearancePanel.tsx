import { CheckOutlined } from "@ant-design/icons";
import { THEMES, type ThemeId } from "./theme";

export function AppearancePanel({ value, onChange }: { value: ThemeId; onChange: (id: ThemeId) => void }) {
  const light = THEMES.filter((t) => !t.p.dark);
  const dark = THEMES.filter((t) => t.p.dark);
  const group = (title: string, list: typeof THEMES) => (
    <div className="appearance-group">
      <small className="muted">{title}</small>
      <div className="appearance-grid" role="listbox" aria-label={title}>
        {list.map((t) => (
          <button key={t.id} type="button" role="option" aria-selected={value === t.id} className={"appearance-card" + (value === t.id ? " active" : "")} onClick={() => onChange(t.id)}>
            <span className="appearance-preview" style={{ background: t.p.ink }}>
              <span className="ap-rail" style={{ background: t.p.panel }}>
                <i style={{ background: t.p.accent }} />
                <i style={{ background: t.p.faint }} />
                <i style={{ background: t.p.faint }} />
              </span>
              <span className="ap-body">
                <span className="ap-card" style={{ background: t.p.panel }}>
                  <b style={{ background: t.p.text }} />
                  <em style={{ background: t.p.muted }} />
                  <u style={{ background: t.p.accent }} />
                </span>
              </span>
            </span>
            <span className="appearance-text">
              <b>{t.name}</b>
              <small>{t.hint}</small>
            </span>
            {value === t.id && <CheckOutlined className="appearance-check" />}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="appearance-panel">
      {group("浅色", light)}
      {group("深色", dark)}
      <small className="muted">配色只影响软件界面，立即生效，不需要保存；各平台账号页面保持平台原样。</small>
    </div>
  );
}
