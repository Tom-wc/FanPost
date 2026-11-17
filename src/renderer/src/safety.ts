import { useEffect, useState } from "react";
import type { SafetyRules } from "../../shared/safety";
import { SAFETY_ERROR } from "../../shared/safety-review";

export function useSafetyRules(): { rules: SafetyRules | null; loaded: boolean } {
  const [state, setState] = useState<{ rules: SafetyRules | null; loaded: boolean }>({ rules: null, loaded: false });
  useEffect(() => {
    let alive = true;
    window.fanpost
      .getSafetyRules()
      .then((r) => alive && setState({ rules: r.rules, loaded: true }))
      .catch(() => alive && setState({ rules: null, loaded: true }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

export function safetyReason(e: unknown) {
  const t = String(e instanceof Error ? e.message : e);
  const i = t.indexOf(SAFETY_ERROR);
  return i >= 0 ? t.slice(i + SAFETY_ERROR.length) : "";
}
