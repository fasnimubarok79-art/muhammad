"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Load data, then keep polling while `shouldPoll(data)` is true. Pauses when the tab is hidden. */
export function usePoll<T>(load: () => Promise<T>, shouldPoll: (d: T) => boolean, intervalMs = 2500) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!data || !shouldPoll(data)) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [data, shouldPoll, intervalMs, refresh]);
  return { data, error, refresh };
}
