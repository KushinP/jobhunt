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
