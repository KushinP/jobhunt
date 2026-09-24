# CLAUDE.md - Job Hunt Profile (TEMPLATE)

**Single config file for the whole system.** The tailored-resume, tailored-cover-letter and
application-autofill skills read it before doing anything. Copy this file into each skill's
`reference/` folder after filling it in.

Mirror of record: the JobHunt server config (`get_config`). Scheduled cloud runs read the
server; local skills read this file. Change one, update the other. Never edit only one.

Anything marked `<< CONFIRM >>` is a guess that needs the person's sign-off before the
automation relies on it.

---

# IDENTITY

- **Full name (as it appears on documents):** {{FULL_NAME}}
- **Credential suffix:** {{none | CFA | MBA | ...}}
- **Contact line (used verbatim in resume and cover letter headers):**
  `{{HOME_CITY}} | {{PHONE}} | {{APPLY_EMAIL}} | {{LINKEDIN_URL}}`
- **Years of experience:** {{N}}
- **Education:** {{School}}, {{Degree}}, MM/YYYY - MM/YYYY. {{Concentration}}. GPA {{GPA}}/4.0. {{Honours}}.
- **Evidence bank:** every claim a document may make lives in the JobHunt connector
  (`list_evidence`, status confirmed). This file holds rules; the bank holds facts.

---

# TARGET ROLES

Archetypes in priority order. Priority drives which queries run first and which base
resume is the general fallback. Keep in sync with `get_config` `archetypes`.

| # | Archetype | Titles | Comp band |
|---|---|---|---|
| 1 | **{{Archetype}}** | {{titles}} | ${{low}} - ${{high}} |
| 2 | **{{Archetype}}** | {{titles}} | ${{low}} - ${{high}} |

- **Focus areas:** {{domains}}
- **Geography:** `<< CONFIRM >>` {{cities}}; remote {{OK / not OK}}
- **Minimum level:** {{Analyst / Associate}}. Never below: intern, co-op, apprentice, fellow
- **Comp floor:** `<< CONFIRM >>` ${{FLOOR}} base. Used to filter only. Never written into a document

## Hard exclusions

Roles the system must never surface, tailor for, or spend tokens on:

- Unpaid, intern, co-op, apprentice, fellowship listings
- Commission-only or draw-against-commission sales roles
- Staffing agency listings with no named client
- On-site roles outside the acceptable geography
- Anything requiring an active security clearance
- Roles requiring a professional license the candidate does not hold (CPA, PE, Series 7)

**Exclusion scope rule:** exclusions apply to the **role's actual duties**, not the
company's branding. A staffing firm hiring its own internal analyst is fine. Judge from the
job description, not the logo.

## Override terms

Terms that rescue an otherwise-excluded role, e.g. `rotational analyst program`,
`analyst development program`, `associate product manager`.

---

# BASE RESUME SELECTION

Base resumes live on the server (`get_base_resume` with the role's archetype). One base per
archetype family; see `get_config` `base_resume_map`.

**Always start from a base file.** Never write a tailored resume from scratch; the base is
what keeps dates, titles, and credentials identical across every application.

**Fix problems in the base file, not in the output.** A corrected generated resume with an
uncorrected base regenerates the same error forever.

---

# WRITING STYLE RULES

- **Never use em dashes** in any output: resumes, cover letters, emails, briefs. Use commas,
  semicolons, colons, or parentheses.
- **Date ranges use a single hyphen with spaces:** `MM/YYYY - MM/YYYY`.
- Tone: direct, concrete, confident. No filler adverbs, no throat-clearing openers.
- Every claim traceable to something real.

---

# OUTPUT RULES

- **Resume page cap:** {{1}} page, hard. Roughly 330 words per page in the default template.
- **Cover letter:** one page, always.
- File names: `{{Lastname}}_[Company]_[Role]_[YYYY-MM-DD].docx`, `CL_[Company]_[Role]_[YYYY-MM-DD].docx`
- **Never fabricate experience.** Reframe real experience only.
- For every bullet changed, report an inline `[WHY: ...]` note in chat so it can be audited.

---

# RESUME FORMATTING

If a written rule and a base file disagree, **the base file wins** and the contradiction
gets flagged, not silently fixed. Section order: {{Contact -> Education -> Work Experience -> ...}}

---

# PROTECTED TERMINOLOGY

Must appear **exactly** as written. Never paraphrase, simplify, expand, or substitute.

**Credentials and institutions:** {{school, degree name, honours, clubs}}
**Companies and products:** {{employers, products}}
**Field vocabulary:** {{domain terms}}

Acronym rule for ATS: spell out on first use with the acronym in parentheses.

---

# WHAT CAN AND CANNOT CHANGE WHEN TAILORING

## Can change
- Summary paragraph, if present, to mirror the JD
- Skills line, to match JD keywords
- Bullet order within a role
- Synonym swaps where the meaning is identical
- Which optional bullets appear, to fit the page cap

## Cannot change, ever
- Employment dates, job titles, company names
- GPA, degree name, graduation date, honours
- Anything in Protected Terminology
- Bullet content beyond reordering and accurate synonym swaps

## Must never do
- Fabricate a project, metric, tool, employer, or outcome
- Add a skill never actually used
- Inflate scope ("led" for something contributed to)
- {{The single most likely overreach for this person, named explicitly}}
- Remove a credential to make room

---

# JOB VERIFICATION RULES

1. **Link verification.** URL loads, title matches, company matches. Dead link, 404, or a
   redirect to a generic careers page means discard.
2. **Freshness.** Posting within the last **14** days.
3. **Company verification.** Real company, named employer.
4. **Duplicate check.** Enforced by the server on `normalized_key` (title + company).

**Status values - use only these:**
`New` | `Generate` | `Complete` | `Applied` | `Interviewing` | `Offer` | `Rejected` | `Skip` | `Unverified` | `Dead link` | `Discarded`

**Dashboard names differ for two of these.** The dashboard shows `Generate` as **Queued**
and `Complete` as **Ready**. Pass the API value in every tool call; say "Queued" and
"Ready" in notes, reports and anything the person reads.

`Applied`, `Interviewing`, `Offer`, and `Rejected` are **human-only**. No automation may
write them; the MCP server refuses.

---

# SCORING

| Dimension | Points |
|---|---|
| Title match | 20 |
| Domain / focus area match | 25 |
| Core skill match | 20 |
| Seniority match | 20 |
| Location or remote fit | 15 |

- **Hard cutoff: 60.** Below that, Discarded.
- **Auto-generate threshold: 75.** At or above, the role is Queued for documents.
- 60 to 74 lands as `New` for a one-click decision.

Scoring runs on the server, not in a prompt, so it cannot drift between runs.

---

# OPERATING PREFERENCES

- Do not narrate steps. Execute and report at the end.
- Be concise everywhere except the resume, cover letter, and interview brief.
- The system never submits an application. It prepares documents and opens the portal.
