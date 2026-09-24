import { useEffect, useState } from 'react';

declare const __BUILD_ID__: string;

/**
 * A dashboard tab left open keeps running the code it loaded, so after a deploy it shows the
 * old screens with no sign anything changed. This checks the deployed build every few minutes
 * and whenever the tab comes back into view, and offers a reload when it differs.
 */
export function UpdateBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let stop = false;
    const check = async () => {
      if (stop || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return; // the dev server has no version file
        const { build } = await res.json() as { build?: string };
        if (build && build !== __BUILD_ID__) setStale(true);
      } catch { /* offline: try again later */ }
    };
    const timer = setInterval(check, 5 * 60_000);
    document.addEventListener('visibilitychange', check);
    void check();
    return () => { stop = true; clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, []);
  if (!stale) return null;
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
      <span>JobHunt was updated since this tab opened. Reload to get the latest version.</span>
      <button type="button" onClick={() => window.location.reload()}
        className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white">Reload</button>
    </div>
  );
}
