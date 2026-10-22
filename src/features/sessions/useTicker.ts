import { useEffect, useState } from 'react';

/**
 * The current time in ms, refreshed every `intervalMs`. Relative labels ("3 min. ago",
 * "resets in 2h 14m") use it so they keep moving between snapshot polls.
 */
export function useTicker(intervalMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
