---
name: "tailored-resume"
description: >
  Creates a tailored, ATS-optimized resume customized to a specific job description.
  Use this skill whenever the user uploads or pastes a job description and asks for a resume,
  tailored resume, custom resume, or CV for that role. Also triggers when the user says things like
  "tailor my resume to this JD", "make a resume for this job", "customize my resume", or
  "create a resume for [Company/Role]". The skill generates a formatted .docx file using the
  visual design spec defined here and the personal details in reference/CLAUDE.md.
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

# Tailored Resume

Generates a tailored resume as a `.docx`, built with the `docx` npm package.

**All personal details, target roles, base-resume selection rules, and field-specific
vocabulary live in `reference/CLAUDE.md`. This skill contains only the mechanics.**
Read that file first, every run. Its rules override anything here.

---

## Step 0: Load the profile

Read `reference/CLAUDE.md` (bundled with this skill) and call `get_config` on the JobHunt
connector. If the reference file is missing, stop and say so rather than guessing at the
identity, page cap or protected terminology. There are no local paths to resolve.

---

## Step 1: Read inputs

You need three things:

1. **`reference/CLAUDE.md`** - the profile. Name, contact line, target titles, exclusion rules,
   base-resume selection map, page cap, protected terminology. Read this first.
2. **The job description** - from the uploaded file, a URL, or the conversation.
3. **The best-matching base resume** - from the JobHunt connector (`get_base_resume`, `include_file: true`), chosen using the selection map
   in `CLAUDE.md`. Never write a resume from scratch; always start from a base file.

If no base resume matches the role type, say so and ask which base to adapt rather than
inventing content.

---

## Step 2: Content strategy

Tailor the base resume to the JD by:

- Rewriting the **Summary** (target 40 words, hard cap 50) to mirror the JD's language
- Updating the **Core Competencies** line to match JD keywords (pipe-separated, one line)
- Reordering **bullets within a role** so the most JD-relevant appear first
- Adding or reordering **role sub-headers** to surface the most relevant experience
- Mirroring the JD's exact terminology wherever it is accurate
- Keeping every bullet at 30 words or fewer

### What you may never change

- Employment dates
- Job titles
- Company names
- Publications, patents, certifications, or any citation
- Any term listed under "Protected Terminology" in `CLAUDE.md`

### What you may never do

- Fabricate a project, employer, metric, tool, or outcome
- Add a skill the person has not actually used
- Inflate scope ("led" for something they contributed to)
- Simplify technical language to make it "readable"

Reframing real experience in the JD's vocabulary is the entire job. Anything beyond that
is a lie the person has to defend in an interview.

For every bullet you change, append an inline note `[WHY: ...]` in your chat summary
(not in the document) so the user can audit the edit.

### Length

The template renders at roughly **330 words per page**, not the standard 400. Word-count
estimates based on 400 will silently produce a 3.5-page resume.

| Goal      | Max words |
|-----------|-----------|
| 1 page    | 330       |
| 1.5 pages | 495       |
| 2 pages   | 660       |

**The cap for this profile is 1 page**, set in `CLAUDE.md`. Two pages are allowed only for
the AI implementation archetype when the job description is senior and the founder
narrative genuinely needs the room. Never three.

The page cap is set in `CLAUDE.md`. Count words before saving.

**Trim in this order** (highest impact first):

1. Summary → 40 words
2. Key Skills rows → 15 words each
3. Drop the weakest bullet in each role
4. Shorten the most verbose bullets to 28 words
5. Oldest / least relevant role → 4 bullets max, 18 words each
6. Boilerplate closing lines

Word count is an estimate, not proof. **Verify the real page count by rendering:**

```bash
soffice --headless --convert-to pdf --outdir /tmp "output.docx"
python3 -c "import pypdf; print(len(pypdf.PdfReader('/tmp/output.pdf').pages))"
```

---

## Step 3: Build the .docx - formatting spec

Use the `docx` npm package. Install into a scratch dir if needed:
`npm install docx`

### Page layout

```javascript
page: {
  size: { width: 12240, height: 15840 },                        // US Letter 8.5" x 11"
  margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }  // 1" all sides
}
```

### Font

- **Calibri throughout.** No exceptions, no mixed fonts.
- Body and bullets: 11pt (`size: 22` - docx uses half-points)
- Single font colour for all body text. Colour, if any, is reserved for the name and
  section headers. Set the palette in `CLAUDE.md`.

### Name header

```javascript
new Paragraph({
  alignment: AlignmentType.LEFT,
  spacing: { after: 57 },
  children: [new TextRun({ text: "FULL NAME, CREDENTIAL", bold: true, size: 28, font: "Calibri" })]
})
```

Name: **28 half-points = 14pt**, bold, left-aligned.

### Contact line

```javascript
new Paragraph({
  alignment: AlignmentType.LEFT,
  spacing: { after: 40 },
  children: [new TextRun({
    text: "City | Phone | Email | linkedin.com/in/handle | personal-site.com",
    size: 22, font: "Calibri"
  })]
})
```

Contact: **22 half-points = 11pt**. Include the personal site if there is one.

### Section headers

Core Competencies, Professional Experience, Education, Key Skills, Publications, Patents.

```javascript
new Paragraph({
  spacing: { before: 120, after: 40 },
  children: [new TextRun({ text: "Professional Experience", bold: true, size: 28, font: "Calibri" })]
})
```

Section headers: **24 half-points = 12pt** for this one-page layout (the template's 14pt
spends too much vertical space), bold, **Title Case** (not all-caps), no border, no
horizontal rule. Spacing alone separates sections. The size is set in `CLAUDE.md`.

### Job header and title

```javascript
// Company + location + dates, one run
new Paragraph({
  spacing: { before: 160, after: 0 },   // 120 for roles after the first
  children: [new TextRun({
    text: "Company Name, City, ST | 03/2021 - 05/2025",
    bold: true, size: 24, font: "Calibri"
  })]
})

// Title line, no spacing above
new Paragraph({
  spacing: { before: 60, after: 0 },
  children: [new TextRun({ text: "Job Title | Scope Descriptor", bold: true, size: 24, font: "Calibri" })]
})
```

Job headers and titles: **24 half-points = 12pt**, bold.

**Date ranges use a single hyphen with spaces: `MM/YYYY - MM/YYYY`.** Not an en dash,
not an em dash, not a triple hyphen. This one is easy to get wrong and shows up everywhere.

### Bullets

```javascript
// Define once on the Document:
numbering: {
  config: [{
    reference: "bullets",
    levels: [{
      level: 0,
      format: LevelFormat.BULLET,
      text: "•",
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } }
    }]
  }]
}

// Each bullet:
new Paragraph({
  numbering: { reference: "bullets", level: 0 },
  spacing: { before: 60, after: 0 },
  children: [
    new TextRun({ text: "Led ", bold: true, size: 22, font: "Calibri" }),
    new TextRun({ text: "the rest of the bullet text.", size: 22, font: "Calibri" })
  ]
})
```

**Bold emphasis in bullets:** check what the base resumes actually do before assuming.
Two conventions are common:

- **Bold leading verb** - the first word is a separate bold TextRun (`Led`, `Designed`, `Owned`)
- **Bold mid-phrase** - the verb is plain and a key noun phrase later in the bullet is bold

Whichever convention the base files use, **preserve it**. Do not "fix" the base files to
match a rule written elsewhere. If the base and a written rule disagree, the base file wins,
and flag the contradiction to the user.

### Key Skills

Sub-headers inside Key Skills are **11pt bold** (`size: 22`), not 12pt:

```javascript
new Paragraph({
  spacing: { before: 80, after: 40 },
  children: [new TextRun({ text: "Skill Category", bold: true, size: 22, font: "Calibri" })]
})
```

Skill sub-bullets use the standard bullet format with the phrase before the colon in bold.
Cap at 2 to 3 sub-sections; more than that reads as padding.

### Publications and Patents

- Section header 14pt bold, `spacing: { before: 240 }`
- Each entry is a bullet at 11pt
- In publications, bold the author names up to and including the candidate's own name;
  the rest of the citation is plain. Never duplicate author names across the bold and
  plain runs.
- **Never retype a citation from memory.** Copy it byte-for-byte from the base file.
  Journal names, years, and volume numbers get corrupted by paraphrase, and a wrong
  citation on a scientific resume is disqualifying.

### Spacing reference (twips; 1pt = 20 twips)

| Element                  | before | after |
|--------------------------|--------|-------|
| Name header              | 0      | 57    |
| Contact line             | 0      | 40    |
| Summary                  | 80     | 0     |
| Section headers          | 120    | 40    |
| Job header (first role)  | 160    | 0     |
| Job header (later roles) | 120    | 0     |
| Job title line           | 60     | 0     |
| Role sub-header          | 80     | 60    |
| Bullets                  | 60     | 0     |
| Key Skills sub-header    | 80     | 40    |
| Education job header     | 0      | 0     |

### Section order

Contact → Education → Work Experience → Leadership Experience → Skills.

**Education comes first** and stays first until roughly three years post-graduation.
**No Core Competencies block, no Publications, no Patents.** Those are senior-profile
sections; on a one-page early-career resume they read as padding. The Publications and
Patents mechanics below are kept only in case they ever apply.

Confirm the order against the base file each time; base files drift.

---

## Step 4: Save, verify, deliver

**File naming:** `[Lastname]_[Company]_[RoleCode]_[YYYY-MM-DD].docx`
**Save to:** the JobHunt connector with `save_document` (work files in `/tmp/jobhunt`)

### Verification checklist - run all of these before delivering

1. **File opens.** `python-docx` loads it without error.
2. **Real page count.** Render to PDF with LibreOffice and count pages. Do not trust the
   word-count heuristic alone.
3. **Dates unchanged.** Diff every date against the base file.
4. **Publications and patents unchanged.** Diff character by character.
5. **No em dashes anywhere.** Grep for `—`, `–`, and `---`.
6. **Paragraph indices re-verified.** If you are editing an existing file by paragraph
   index, dump fresh indices for that specific file. Never reuse indices from a prior
   version; sections shift and you will overwrite a publication.
7. **Copy integrity.** If the destination folder is cloud-synced (OneDrive, Dropbox,
   Google Drive), a copy can silently corrupt. Verify with both:
   ```bash
   md5sum source.docx destination.docx
   python3 -c "import zipfile; print(zipfile.is_zipfile('destination.docx'))"
   ```
   Matching file size is not sufficient proof.

Then present the file to the user.

Report alongside it: the keyword gaps still unaddressed, and any ATS risks in the output.

---

## Quick reference: font sizes

| Element             | Half-points | Points | Bold |
|---------------------|-------------|--------|------|
| Name                | 28          | 14pt   | Yes  |
| Section headers     | 28          | 14pt   | Yes  |
| Job header          | 24          | 12pt   | Yes  |
| Job title           | 24          | 12pt   | Yes  |
| Role sub-header     | 24          | 12pt   | Yes  |
| Key Skills sub-head | 22          | 11pt   | Yes  |
| Body / bullets      | 22          | 11pt   | No   |
| Contact line        | 22          | 11pt   | No   |

---

## ATS rules - always apply

- Single column. No tables, no text boxes, no graphics, no headers or footers, no columns.
- Calibri only.
- Mirror the JD's exact keywords wherever they are accurate.
- Spell out an acronym on first use with the acronym in parentheses, so both forms are
  searchable: `Investigational New Drug (IND)`, `Search Engine Optimization (SEO)`.
- Target roughly 65 to 75 percent keyword overlap with the JD. Higher than that reads as
  keyword stuffing to a human.
- Save as `.docx`, not `.pdf`, unless the application explicitly asks for PDF.
