import { useEffect, useRef, useState } from 'react';

export interface PreviewDoc { id: string; filename: string; kind: string }

const PAGE_PX = 816; // a US Letter page at 96 dpi, which is how the renderer lays pages out

/**
 * Shows a built .docx as Word would lay it out, without downloading it. The renderer loads
 * only when a preview opens, so it costs nothing on every other screen. A role's resume and
 * cover letter sit side by side as tabs, since they are read together.
 */
export function DocPreview({ docs, initialId, title, onClose }: {
  docs: PreviewDoc[]; initialId: string; title?: string; onClose: () => void;
}) {
  const [id, setId] = useState(initialId);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState(1);
  const pageHost = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const doc = docs.find((d) => d.id === id) ?? docs[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Fit the page to narrow screens instead of scrolling sideways.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const fit = () => setZoom(Math.min(1, (el.clientWidth - 32) / PAGE_PX));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        const res = await fetch(`/doc/${doc.id}`);
        if (!res.ok) throw new Error(`the file could not be loaded (${res.status})`);
        const blob = await res.blob();
        const { renderAsync } = await import('docx-preview');
        if (cancelled || !pageHost.current) return;
        pageHost.current.innerHTML = '';
        await renderAsync(blob, pageHost.current, undefined, {
          className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false,
          renderHeaders: true, renderFooters: true, useBase64URL: true,
        });
        tidy(pageHost.current);
        if (!cancelled) setState('ready');
      } catch (e) {
        if (!cancelled) { setErr(e instanceof Error ? e.message : String(e)); setState('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [doc.id]);

  return (
    <>
      <button type="button" aria-label="Close preview" onClick={onClose} className="fixed inset-0 z-50 bg-black/50" />
      <div role="dialog" aria-label={`Preview of ${doc.filename}`}
        className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-2xl sm:inset-6">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            {title && <p className="truncate text-xs text-muted">{title}</p>}
            <p className="truncate text-sm font-semibold">{doc.filename}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {docs.length > 1 && (
              <div className="mr-1 inline-flex rounded-lg border border-line p-0.5 text-xs">
                {docs.map((d) => (
                  <button key={d.id} type="button" onClick={() => setId(d.id)}
                    className={`rounded-md px-2.5 py-1 ${d.id === doc.id ? 'bg-panel font-semibold' : 'text-muted hover:text-fg'}`}>
                    {d.kind === 'resume' ? 'Resume' : 'Cover letter'}
                  </button>
                ))}
              </div>
            )}
            <a href={`/doc/${doc.id}`} className="rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent">Download</a>
            <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-muted hover:text-fg" aria-label="Close">✕</button>
          </div>
        </header>
        <div ref={frame} className="relative min-h-0 flex-1 overflow-auto bg-[#8a8781] py-4 dark:bg-[#2b2a28]">
          {state === 'loading' && <p className="absolute inset-x-0 top-6 text-center text-sm text-white/80">Rendering…</p>}
          {state === 'error' && (
            <p className="mx-auto mt-6 max-w-md rounded-lg bg-bg px-4 py-3 text-sm">
              Could not show this file: {err}. Download it to open in Word.
            </p>
          )}
          <div ref={pageHost} className="docx-host" style={{ zoom, visibility: state === 'ready' ? 'visible' : 'hidden' }} />
        </div>
        <p className="shrink-0 border-t border-line px-4 py-1.5 text-[11px] text-muted">
          A browser rendering: fonts and page breaks can differ slightly from Word. The page count
          on the role is from the build run.
        </p>
      </div>
    </>
  );
}

/**
 * Word's bullets are Symbol-font private-use characters, which browsers draw as empty boxes,
 * and Word fonts such as Calibri are often not installed. Swap in a real bullet and give every
 * font a close fallback, so the preview reads like the document rather than a broken copy.
 */
function tidy(host: HTMLElement) {
  const PUA = '[\\uF0A7\\uF0B7\\uF076\\uF0D8\\uF0FC]';
  const HAS_PUA = new RegExp(PUA);
  const PUA_BULLETS = new RegExp(PUA, 'g');
  for (const style of host.querySelectorAll('style')) {
    style.textContent = (style.textContent ?? '')
      .replace(/\\f0b7|\\f0a7|\\f076|\\f0d8|\\f0fc/gi, '\\2022')
      .replace(/font-family:\s*("?)(Symbol|Wingdings)\1/gi, 'font-family: inherit');
  }
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (HAS_PUA.test(n.nodeValue ?? '')) n.nodeValue = (n.nodeValue ?? '').replace(PUA_BULLETS, '\u2022');
  }
  const serif = /times|georgia|garamond|cambria|book antiqua|palatino/i;
  for (const el of host.querySelectorAll<HTMLElement>('[style*="font-family"]')) {
    const f = el.style.fontFamily;
    if (!f || /(sans-serif|serif|monospace)\s*$/i.test(f)) continue;
    if (/symbol|wingdings/i.test(f)) { el.style.fontFamily = 'inherit'; continue; }
    el.style.fontFamily = `${f}, ${/calibri/i.test(f) ? 'Carlito, ' : ''}${serif.test(f) ? 'serif' : 'Helvetica, Arial, sans-serif'}`;
  }
}
