import type { RawJob } from '@jobhunt/core';
import { htmlToText } from './html.ts';

/** A board entry is "slug" or "slug:Display Name", so the dashboard can say "Scale AI"
 * rather than "scaleai" without changing the config's shape. */
export function parseBoardEntry(entry: string): { slug: string; name: string } {
  const i = entry.indexOf(':');
  if (i < 0) return { slug: entry.trim(), name: entry.trim() };
  return { slug: entry.slice(0, i).trim(), name: entry.slice(i + 1).trim() || entry.slice(0, i).trim() };
}

export interface BoardResult {
  jobs: RawJob[];
  unavailable: string[];
  errors: { board: string; slug: string; error: string }[];
}

const UA = 'jobhunt-mcp (personal job search; contact via the board owner)';

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Greenhouse, Lever and Ashby all publish a company's own board as public JSON.
 * These postings are fresher than the aggregators and far less contested, which is why
 * this is the highest-return source of the four.
 */
export async function searchCompanyBoards(boards: {
  greenhouse?: string[]; lever?: string[]; ashby?: string[];
}): Promise<BoardResult> {
  const out: BoardResult = { jobs: [], unavailable: [], errors: [] };

  for (const entry of boards.greenhouse ?? []) {
    const { slug, name } = parseBoardEntry(entry);
    try {
      const data = await getJson(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
      ) as { jobs?: { title?: string; location?: { name?: string }; absolute_url?: string;
                      updated_at?: string; id?: number; content?: string }[] };
      for (const j of data.jobs ?? []) {
        out.jobs.push({
          title: j.title ?? '', company: name, location: j.location?.name ?? null,
          url: j.absolute_url ?? null, source: 'greenhouse',
          source_job_id: j.id != null ? String(j.id) : null,
          posted_at: j.updated_at ? j.updated_at.slice(0, 10) : null,
          jd_text: htmlToText(j.content),
        });
      }
    } catch (e) {
      out.errors.push({ board: 'greenhouse', slug, error: String(e) });
    }
  }

  for (const entry of boards.lever ?? []) {
    const { slug, name } = parseBoardEntry(entry);
    try {
      const data = await getJson(
        `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
      ) as { text?: string; categories?: { location?: string }; hostedUrl?: string;
             createdAt?: number; id?: string; descriptionPlain?: string }[];
      for (const j of data ?? []) {
        out.jobs.push({
          title: j.text ?? '', company: name, location: j.categories?.location ?? null,
          url: j.hostedUrl ?? null, source: 'lever', source_job_id: j.id ?? null,
          posted_at: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : null,
          jd_text: j.descriptionPlain ?? null,
        });
      }
    } catch (e) {
      out.errors.push({ board: 'lever', slug, error: String(e) });
    }
  }

  for (const entry of boards.ashby ?? []) {
    const { slug, name } = parseBoardEntry(entry);
    try {
      const data = await getJson(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
      ) as { jobs?: { title?: string; location?: string; jobUrl?: string; publishedAt?: string;
                      id?: string; descriptionPlain?: string }[] };
      for (const j of data.jobs ?? []) {
        out.jobs.push({
          title: j.title ?? '', company: name, location: j.location ?? null,
          url: j.jobUrl ?? null, source: 'ashby', source_job_id: j.id ?? null,
          posted_at: j.publishedAt ? j.publishedAt.slice(0, 10) : null,
          jd_text: j.descriptionPlain ?? null,
        });
      }
    } catch (e) {
      out.errors.push({ board: 'ashby', slug, error: String(e) });
    }
  }

  return out;
}
