---
name: "tailored-cover-letter"
description: >
  Creates a tailored, job-specific cover letter as a formatted .docx file.
  Use this skill whenever the user provides a job description and asks for a cover letter,
  custom cover letter, CL, or says things like "write a cover letter for this role",
  "tailor a cover letter to this JD", "make a cover letter for [Company]", or "create a CL".
  Also triggers as part of any full application workflow ("create a resume and cover letter",
  "apply to this role"). Always use this skill alongside the tailored-resume skill when both
  are requested together.
---

---

# CLOUD INSTALL (read this first; it overrides anything below)

This copy runs in a Claude Cowork cloud session, not on the Mac. There is no `~/jobhunt/`
folder and no local file system to rely on.

- **Profile and rules:** `reference/CLAUDE.md`, bundled with this skill. Read it first, every
  run. Its rules override anything below.
- **Pipeline of record:** the JobHunt connector. Call `get_config` for the same settings as
  JSON. Fetch the base resume with `get_base_resume` (pass `include_file: true` for the
  .docx); never look for a `01_Resumes_Base/` folder. Store every finished file with
  `save_document`; never look for a `02_Resumes_Tailored/` or similar output folder.
- **Work in a temporary directory** such as `/tmp/jobhunt`. Anything left there is lost when
  the session ends, which is why `save_document` is the only real save.
- **Page counts:** render with `soffice --headless --convert-to pdf` if it exists. If it does
  not, say the page count is an estimate and pass `page_count_verified: false` to
  `save_document`. Never claim a page count you did not measure.
- **Applications are prepared, never submitted.** The submit click is the user's.

## The evidence rule (overrides anything below)

The JobHunt connector holds an **evidence bank**: the only material a generated document may
use. Before writing anything:

1. `list_evidence` with `status: "confirmed"` and the role's archetype. Read every item of kind
   **boundary** first: those are claims you must never make, however well they would fit.
2. Every claim you write must trace to a confirmed item. Reword it into the JD's vocabulary,
   reorder, and choose which items to show. Never add a tool, metric, project, scope, date or
   outcome that is not in the bank.
3. Respect `ownership`. "contributed" never becomes "led", "team" never becomes "built".
4. If the JD asks for something the bank cannot honestly support, leave it out and name it in
   your report as a gap. Do not paper over it.
5. If the person tells you something new mid-task, save it with `add_evidence` before using it,
   so it exists for the next document and not only in this chat.
6. List the evidence ids you used in the content spec you pass to `save_document`.

---

# Tailored Cover Letter

Creates a one-page, three-paragraph cover letter as a `.docx`, built with the `docx` npm package.

**All personal details, contact line, tone preferences, and field vocabulary live in
`reference/CLAUDE.md`. Read it first, every run.** Its rules override anything here.

---

## Step 0: Load the profile

Read `reference/CLAUDE.md` (bundled with this skill) and call `get_config` on the JobHunt
connector. If the reference file is missing, stop and say so rather than guessing at the
identity, page cap or protected terminology. There are no local paths to resolve.

---

## Step 1: Read inputs

1. **`reference/CLAUDE.md`** - name, credential, contact line, writing style rules
2. **The job description**
3. **The resume being submitted with it** - the letter must not contradict the resume,
   and should not simply restate it

---

## Step 2: Content strategy

Three paragraphs. One page. Never two.

### Paragraph 1 - the hook (roughly 100 words)

- Open with something **specific and verifiable** about the company: a named product,
  program, platform, recent launch, or publication. Not "your innovative mission."
- Bridge to the candidate's background in one sentence.
- Close with a fit statement: what lets them contribute immediately.

If you cannot name something specific about the company, you have not done the research.
Go find it before writing.

### Paragraph 2 - two proof points (150 to 180 words)

- Lead with the most relevant role, then the second most relevant.
- Each proof point is concrete: what they did, what method or tool they used, what it
  produced. A proof point with no outcome is a job description, not evidence.
- Close by linking explicitly back to what the JD asked for.

### Paragraph 3 - the ask (30 to 40 words)

- One sentence of genuine interest in this role at this company.
- One sentence asking for the conversation.
- End with "Thank you for your consideration."

### Two usable registers

Pick one based on the role, or ask the user which they want:

- **Skill-forward** - leads with technical depth and specific methods. Use for individual
  contributor and specialist roles where the hiring manager is a practitioner.
- **Leadership-forward** - leads with scope, ownership, and outcomes across teams. Use for
  manager, director, and head-of roles where the reader cares about judgment and range.

Same three-paragraph structure either way; only the emphasis of paragraph 2 changes.

### Writing rules

- **No em dashes.** Use commas, semicolons, colons, or parentheses. This applies to every
  document the system produces.
- Direct and confident. Not flowery, not deferential, not padded with adverbs.
- No sentence that could appear in a letter to a different company. If it is portable,
  it is filler; cut it.
- Never fabricate. Reframe real experience only, and only what the resume can support.
- Address a named person when the name is known and verified. `Dear Hiring Manager,`
  otherwise. Never "To Whom It May Concern."
- Sign with the full name plus credential, exactly as configured in `CLAUDE.md`.

---

## Step 3: Build the .docx - formatting spec

### Page layout

```javascript
page: {
  size: { width: 12240, height: 15840 },                        // US Letter
  margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }  // 1"
}
```

### Font and colour

- **Calibri throughout.** 11pt body (`size: 22`).
- Name: accent colour (e.g. `1F4E79`). All other text: a single dark colour
  (e.g. `2F2F2F`). No third colour.

### Paragraph structure

| Para | Content        | Size | Bold | Colour  | Before | After |
|------|----------------|------|------|---------|--------|-------|
| 0    | Name           | 14pt | Yes  | accent  | 0      | 25    |
| 1    | Contact line   | 11pt | No   | body    | 0      | 120   |
| 2    | Date           | 11pt | No   | body    | 0      | 120   |
| 3    | Salutation     | 11pt | No   | body    | 0      | 0     |
| 4    | Body para 1    | 11pt | No   | body    | 120    | 0     |
| 5    | Body para 2    | 11pt | No   | body    | 120    | 0     |
| 6    | Body para 3    | 11pt | No   | body    | 120    | 0     |
| 7    | "Sincerely,"   | 11pt | No   | body    | 120    | 0     |
| 8    | Signature name | 11pt | Yes  | body    | 120    | 0     |

Spacing is in twips: 1pt = 20 twips, so 6pt = 120.

### Header block

```javascript
new Paragraph({
  alignment: AlignmentType.LEFT,
  spacing: { before: 0, after: 25 },
  // NO border of any kind. Not top, not bottom, nothing.
  children: [new TextRun({
    text: "FULL NAME, CREDENTIAL",
    bold: true, size: 28, font: "Calibri", color: "1F4E79"
  })]
})
```

**Left-aligned, never centred. No border or horizontal rule under the name.** Spacing alone
separates the name from the contact line.

### Date

Format `Month DD, YYYY` (e.g. `August 9, 2026`). Use the actual generation date, and
re-check it each run rather than copying from a previous letter.

### Signature

11pt **bold**, in the body colour, not the accent colour. Intentionally different from the
header name.

---

## Step 4: Save, verify, deliver

**File naming:** `CL_[Company]_[RoleCode]_[YYYY-MM-DD].docx`
**Save to:** the JobHunt connector with `save_document` (work files in `/tmp/jobhunt`)

### Verification

1. **One page.** Verify by rendering, not by guessing:
   ```bash
   soffice --headless --convert-to pdf --outdir /tmp "CL_file.docx"
   python3 -c "import pypdf; print(len(pypdf.PdfReader('/tmp/CL_file.pdf').pages))"
   ```
   If it renders at two pages, cut paragraph 2 until it is one.
2. **No em dashes.** Grep for `—`, `–`.
3. **Company name spelled correctly, everywhere.** The single most embarrassing error in
   this document, and the easiest to make when reusing a previous letter.
4. **Date is today's date**, not a copied one.
5. **File loads** with `python-docx`.
6. **Copy integrity** if writing to a cloud-synced folder: `md5sum` both sides plus
   `zipfile.is_zipfile`.

Then present the file to the user.

---

## Formatting rules - always apply

- Single column. No tables, text boxes, graphics, headers, or footers.
- Calibri only.
- No borders anywhere.
- Left-aligned throughout.
- No em dashes in the body.
- One page. Always.
