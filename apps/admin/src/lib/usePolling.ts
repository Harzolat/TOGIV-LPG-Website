import { useEffect, useRef } from "react";

/**
 * Keeps a screen in sync without a manual reload.
 *
 * - runs immediately on mount (and whenever `run` changes, e.g. a filter)
 * - repeats every `intervalMs` while the tab is visible
 * - refreshes on tab focus / visibility regain
 * - never overlaps requests
 *
 * `run` must be stable (wrap it in useCallback). Callers should make their
 * loader silent when data already exists so a poll never flashes a skeleton.
 */
export function usePolling(
  run: () => void | Promise<void>,
  {
    intervalMs = 10_000,
    enabled = true,
  }: { intervalMs?: number; enabled?: boolean } = {},
) {
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let running = false;

    const tick = async () => {
      if (cancelled || running) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      running = true;
      try {
        await runRef.current();
      } finally {
        running = false;
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), intervalMs);
    const onWake = () => {
      if (document.visibilityState === "visible") void tick();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [enabled, intervalMs, run]);
}
