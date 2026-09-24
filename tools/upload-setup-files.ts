/**
 * Puts the skill zips into the setup_files table, so the dashboard's Setup page can hand them
 * out behind sign-in. Rebuild the zips first (they bundle 00_Admin/CLAUDE.md), then run:
 *   node tools/upload-setup-files.ts
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { d1 } from './d1http.ts';

const dir = join(homedir(), 'jobhunt/cowork/skills');
const files = [
  ['tailored-resume.zip', 'Builds each tailored resume from your master and evidence bank. Needed by the scheduled document build.'],
  ['tailored-cover-letter.zip', 'Writes the matching cover letter. Needed by the scheduled document build.'],
  ['job-extract.zip', 'Reads jobs from pages in your own Chrome (Handshake, Wellfound, any job page) into JobHunt.'],
  ['application-autofill.zip', 'Fills an application form in your own Chrome from your stored answers and the role\'s documents. It never submits.'],
] as const;

for (const [name, description] of files) {
  const b64 = readFileSync(join(dir, name)).toString('base64');
  await d1.prepare(
    `INSERT INTO setup_files (name, content_b64, description, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(name) DO UPDATE SET content_b64 = excluded.content_b64,
       description = excluded.description, updated_at = datetime('now')`,
  ).bind(name, b64, description).run();
  console.log(`uploaded ${name} (${Math.round(b64.length * 0.75 / 1024)} KB)`);
}
