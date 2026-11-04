import { theme, type ThemeConfig } from "antd";

export type ThemeId = "dawn" | "paper" | "graphite" | "ocean" | "midnight";

interface Palette {
  dark: boolean;
  ink: string;
  panel: string;
  raised: string;
  fg: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  onAccent: string;
  ok: string;
  warn: string;
  bad: string;
  run: string;
  sink: string;
  shadow: string;
  panelBg: string;
  grain: number;
  glowA: string;
  glowB: string;
}

export interface ThemeDef {
  id: ThemeId;
  name: string;
  hint: string;
  p: Palette;
}

const LIGHT_STATUS = { ok: "#16a34a", warn: "#d97706", bad: "#dc2626", run: "#0284c7" };
const DARK_STATUS = { ok: "#4ade80", warn: "#fbbf24", bad: "#f87171", run: "#7dd3fc" };

export const THEMES: ThemeDef[] = [
  {
    id: "dawn",
    name: "晨雾",
    hint: "浅灰白 · 墨绿",
    p: {
      dark: false, ink: "#eef1f0", panel: "#ffffff", raised: "#ffffff", fg: "#0f1f1c",
      text: "#14211e", muted: "#4f5f5b", faint: "#82918d", accent: "#0f766e", onAccent: "#ffffff",
      ...LIGHT_STATUS, sink: "rgba(15,31,28,0.04)", shadow: "rgba(15,40,35,0.12)",
      panelBg: "linear-gradient(180deg,#ffffff,#fbfcfc)", grain: 0.035,
      glowA: "rgba(15,118,110,0.10)", glowB: "rgba(2,132,199,0.06)",
    },
  },
  {
    id: "paper",
    name: "宣纸",
    hint: "米白 · 朱砂",
    p: {
      dark: false, ink: "#f4efe6", panel: "#fffdf8", raised: "#fffdf8", fg: "#2b1d12",
      text: "#2b2118", muted: "#6b5a4a", faint: "#9c8b7a", accent: "#c2410c", onAccent: "#fffaf3",
      ...LIGHT_STATUS, sink: "rgba(43,29,18,0.045)", shadow: "rgba(80,50,20,0.12)",
      panelBg: "linear-gradient(180deg,#fffdf8,#fcf8f0)", grain: 0.06,
      glowA: "rgba(194,65,12,0.09)", glowB: "rgba(180,140,60,0.08)",
    },
  },
  {
    id: "graphite",
    name: "石墨",
    hint: "中灰 · 珊瑚",
    p: {
      dark: true, ink: "#23262d", panel: "#2b2f37", raised: "#323741", fg: "#ffffff",
      text: "#eceef2", muted: "#b0b6c2", faint: "#848b99", accent: "#ff8a65", onAccent: "#1f1410",
      ...DARK_STATUS, sink: "rgba(0,0,0,0.18)", shadow: "rgba(0,0,0,0.35)",
      panelBg: "linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))", grain: 0.04,
      glowA: "rgba(255,138,101,0.10)", glowB: "rgba(125,211,252,0.05)",
    },
  },
  {
    id: "ocean",
    name: "深海",
    hint: "藏青 · 天蓝",
    p: {
      dark: true, ink: "#0f1a2b", panel: "#152238", raised: "#1b2a44", fg: "#ffffff",
      text: "#e6edf7", muted: "#9fb0c8", faint: "#6f819c", accent: "#38bdf8", onAccent: "#04121f",
      ...DARK_STATUS, sink: "rgba(0,0,0,0.25)", shadow: "rgba(0,8,20,0.55)",
      panelBg: "linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))", grain: 0.045,
      glowA: "rgba(56,189,248,0.12)", glowB: "rgba(45,212,191,0.06)",
    },
  },
  {
    id: "midnight",
    name: "夜幕",
    hint: "深墨 · 青柠",
    p: {
      dark: true, ink: "#0b0d14", panel: "#12151f", raised: "#181c28", fg: "#ffffff",
      text: "#e8ebf2", muted: "#9aa3b5", faint: "#6b7488", accent: "#c6f24e", onAccent: "#0b0d14",
      ...DARK_STATUS, sink: "rgba(0,0,0,0.32)", shadow: "rgba(0,0,0,0.7)",
      panelBg: "linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.012))", grain: 0.05,
      glowA: "rgba(198,242,78,0.09)", glowB: "rgba(125,211,252,0.06)",
    },
  },
];

export const DEFAULT_THEME: ThemeId = "dawn";
const STORAGE_KEY = "fanpost.theme";

export const findTheme = (id: string | null | undefined) => THEMES.find((t) => t.id === id) ?? THEMES[0];

export function loadThemeId(): ThemeId {
  try {
    return findTheme(localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME).id;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveThemeId(id: ThemeId) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    return;
  }
}

export function applyCssVars(def: ThemeDef) {
  const { p } = def;
  const vars: Record<string, string> = {
    "--ink": p.ink, "--panel": p.panel, "--raised": p.raised, "--fg": p.fg, "--text": p.text,
    "--muted": p.muted, "--faint": p.faint, "--accent": p.accent, "--on-accent": p.onAccent,
    "--ok": p.ok, "--warn": p.warn, "--bad": p.bad, "--run": p.run, "--sink": p.sink,
    "--shadow": p.shadow, "--panel-bg": p.panelBg, "--grain": String(p.grain),
    "--glow-a": p.glowA, "--glow-b": p.glowB,
  };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.theme = def.id;
  root.style.colorScheme = p.dark ? "dark" : "light";
}

const FONT = '"Geist Variable", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';

export function antTheme(def: ThemeDef): ThemeConfig {
  const { p } = def;
  const line = p.dark ? "rgba(255,255,255,0.08)" : "rgba(15,25,30,0.09)";
  const field = p.dark ? "rgba(255,255,255,0.03)" : "#ffffff";
  return {
    algorithm: p.dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: p.accent,
      colorInfo: p.run,
      colorSuccess: p.ok,
      colorWarning: p.warn,
      colorError: p.bad,
      colorBgBase: p.ink,
      colorBgContainer: p.panel,
      colorBgElevated: p.raised,
      colorBgLayout: p.ink,
      colorBorder: p.dark ? "rgba(255,255,255,0.12)" : "rgba(15,25,30,0.14)",
      colorBorderSecondary: line,
      colorText: p.text,
      colorTextSecondary: p.muted,
      colorTextTertiary: p.faint,
      colorTextLightSolid: p.onAccent,
      fontFamily: FONT,
      fontSize: 14,
      borderRadius: 10,
      borderRadiusLG: 16,
      borderRadiusSM: 7,
      controlHeight: 36,
      motionDurationMid: "0.22s",
      boxShadowSecondary: "0 18px 50px -12px " + p.shadow + ", 0 0 0 1px " + line,
    },
    components: {
      Button: { primaryColor: p.onAccent, fontWeight: 600, primaryShadow: "0 8px 24px -10px " + p.accent, defaultBg: p.raised },
      Card: { colorBgContainer: "transparent", headerFontSize: 15 },
      Table: { headerBg: "transparent", rowHoverBg: p.sink, colorBgContainer: "transparent", headerColor: p.faint },
      Tabs: { itemSelectedColor: p.text, inkBarColor: p.accent, itemHoverColor: p.text },
      Modal: { contentBg: p.raised, headerBg: p.raised },
      Drawer: { colorBgElevated: p.panel },
      Input: { activeBorderColor: p.accent, hoverBorderColor: p.accent, colorBgContainer: field },
      Select: { colorBgContainer: field },
      Segmented: { itemSelectedBg: p.raised, trackBg: p.sink },
      Tag: { defaultBg: p.sink },
      Switch: { handleBg: p.dark ? p.onAccent : "#ffffff" },
    },
  };
}
