/**
 * The weekly Venture Capital Jobs newsletter (venturecapitaljobs@substack.com), read from the
 * plain-text body Claude's Gmail connector returns. One role per line:
 *
 *   [🚨 ]Title [ https://substack.com/redirect/... ][ (detail)], Company, Location[ (pay)]
 *
 * Section headings, the sponsor blurb and the footer carry no role and are skipped, as are
 * recruiter lines whose employer is withheld (a quoted description such as “$10B+ VC firm”).
 * Gmail stays on Claude's side, so the person's mail never reaches the server; only this text does.
 */

export interface VcJobsRole {
  title: string;
  company: string;
  location: string | null;
  salary: string | null;
  /** the newsletter's tracking link, resolved to the posting by the connector */
  redirect: string;
  /** marked 🚨 in the issue: a role the editors flag as notable */
  flagged: boolean;
}

const LINE = /^(🚨\s*)?(.+?)\s*\[\s*(https?:\/\/\S+?)\s*\](?:\s*\(([^)]*)\))?,\s*(.+)$/u;
const PAY = /[$£€]|\/hr\b|\/week\b|\d+k\b|\bpaid\b|\bunpaid\b|annualized|bonus|equity/i;

export function parseVcJobsNewsletter(text: string): { roles: VcJobsRole[]; skipped: { line: string; reason: string }[] } {
  const roles: VcJobsRole[] = [];
  const skipped: { line: string; reason: string }[] = [];
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    const m = LINE.exec(line);
    if (!m) continue;
    const [, flag, titleRaw, redirect, detail, rest] = m;
    let tail = rest.trim().replace(/[.\s]+$/, '');
    // pay is the last bracket, when it reads like pay; a bracket that does not ("(UK Preferred)",
    // "(Open to remote)") belongs to the location
    let salary: string | null = null;
    const last = /\s*\(([^()]*)\)$/.exec(tail);
    if (last && PAY.test(last[1])) {
      salary = last[1].trim();
      tail = tail.slice(0, last.index).trim();
    }
    const comma = tail.indexOf(',');
    const company = (comma === -1 ? tail : tail.slice(0, comma)).trim();
    const location = comma === -1 ? null : tail.slice(comma + 1).trim() || null;
    const title = detail ? `${titleRaw.trim()} (${detail.trim()})` : titleRaw.trim();
    if (/^["“”'‘’]/.test(company)) {
      skipped.push({ line, reason: 'employer not named' });
      continue;
    }
    if (!company || !title) continue;
    roles.push({ title, company, location, salary, redirect, flagged: !!flag });
  }
  return { roles, skipped };
}

/** A LinkedIn job link in its clean form, with its id; null for any other url. */
export function linkedInJob(url: string): { url: string; id: string } | null {
  const m = /linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^/?#]*?-)?(\d{6,})/i.exec(url ?? '')
    ?? /linkedin\.com\/jobs\/[^?#]*[?&]currentJobId=(\d{6,})/i.exec(url ?? '');
  return m ? { url: `https://www.linkedin.com/jobs/view/${m[1]}/`, id: m[1] } : null;
}

/** The only hosts the server asks for anything: the newsletter's own link shorteners. */
const REDIRECTORS = /^(?:[a-z0-9-]+\.)*(?:substack\.com|lnkd\.in)$/i;

/**
 * Where a newsletter link leads, read from redirect headers only. The server requests a hop only
 * when its host is a known redirector (Substack, lnkd.in), never the destination itself, so a
 * spoofed issue cannot make the Worker send requests to arbitrary hosts. Returns the first url
 * outside the redirectors, or the link itself when it cannot be followed.
 */
export async function resolveNewsletterLink(url: string, fetcher: typeof fetch = fetch, maxHops = 5): Promise<string> {
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    let u: URL;
    try { u = new URL(current); } catch { return current; }
    if (u.protocol !== 'https:' || !REDIRECTORS.test(u.hostname)) return current;
    let res: Response;
    try {
      res = await fetcher(current, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0' } });
    } catch { return current; }
    await res.body?.cancel();
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!next) return current;
    current = new URL(next, current).toString();
  }
  return current;
}
