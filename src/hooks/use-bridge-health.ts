import { useCallback, useEffect, useState } from "react";

export function useBridgeHealth(baseUrl: string) {
  const [bridgeOnline, setBridgeOnline] = useState<boolean>(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const ping = useCallback(async () => {
    const tryEndpoint = async (path: string) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      try {
        const res = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) return true;
        setLastError(`HTTP ${res.status}`);
        return false;
      } catch (e: any) {
        clearTimeout(timeout);
        setLastError(e?.message ?? "offline");
        return false;
      }
    };

    // Try /ping first, then fallback to /status
    const ok = (await tryEndpoint("/ping")) || (await tryEndpoint("/status"));
    setBridgeOnline(ok);
    return ok;
  }, [baseUrl]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!mounted) return;
      await ping();
    })();
    const id = setInterval(ping, 3000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [ping]);

  return { bridgeOnline, lastError, checkNow: ping } as const;
}
