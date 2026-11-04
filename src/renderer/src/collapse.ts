import { useState } from "react";

const KEY = "fanpost.collapsed";

function load(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function useCollapsed(scope: string) {
  const [keys, setKeys] = useState<string[]>(load);
  const isCollapsed = (id: string) => keys.includes(scope + ":" + id);
  const toggle = (id: string) => {
    const key = scope + ":" + id;
    const next = keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
    setKeys(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      return;
    }
  };
  return { isCollapsed, toggle };
}
