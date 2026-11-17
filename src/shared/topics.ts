const SEPARATORS = /[\s\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff,，、;；#＃]+/u;

export function splitTopics(raw: string): string[] {
  return raw
    .split(SEPARATORS)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function mergeTopics(current: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...current, ...incoming]) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function replaceTopic(current: string[], index: number, raw: string): string[] {
  const parts = splitTopics(raw);
  const next = [...current.slice(0, index), ...parts, ...current.slice(index + 1)];
  return mergeTopics([], next);
}
