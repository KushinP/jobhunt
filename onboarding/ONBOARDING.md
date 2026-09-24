# Onboarding flow

The server exposes `onboarding_status`, which returns this 17-step checklist. A chat session calls it first, works the `next` step, saves each answer with the listed tools, and repeats. Steps are `verified_by` data (the server checks stored data), saved (a config key was written) or confirmed (the person said so, recorded with `confirm_setup_step`).

## 1. Your current resume, stored as a master  (`resume`)

**Why:** Every tailored resume starts from a master, which keeps dates, titles and credentials identical everywhere.

**Verified by:** data  
**Saved with:** `save_base_resume`

**What Claude asks / does:**
- Ask for their current resume as a .docx. They can upload it in the dashboard (Setup, Base resumes) or send it in this chat.
- Store it with save_base_resume, always passing extracted_text.

## 2. Every claim on the resume confirmed, corrected or rejected  (`resume_claims`)

**Why:** Tailoring may only use confirmed evidence. A claim is not true because it was written down, and the slightly overstated ones are exactly what an interviewer probes.

**Verified by:** data  
**Saved with:** `add_evidence`, `review_evidence`

**What Claude asks / does:**
- Read the master with get_base_resume. Add EVERY claim to the evidence bank as its own item with source "resume" and source_ref the filename: each role with its dates, each bullet, each metric, each credential. Copy them; do not improve them.
- Go through them with the person a few at a time. For each: is it accurate exactly as written, and who did the work (built_myself, led, contributed, team)? Confirm it, correct it, or reject it with a note saying what is actually true.
- Rejected items stay in the bank as a record of what not to claim.

## 3. What you have done that is not on the resume  (`beyond_resume`)

**Why:** Most people undersell. Things built, launches, and numbers moved that never made the one-page cut are often the strongest material for a specific role.

**Verified by:** data  
**Saved with:** `add_evidence`

**What Claude asks / does:**
- Ask what they have built, shipped, launched or improved that is not on the resume. Ask for specifics: dates as MM/YYYY, what they personally did, a metric if there is one, and a link or file as proof.
- Save each as its own item with honest ownership. Offer to capture 3 to 5 STAR stories (kind "story") for interviews while the details are fresh.

## 4. Skills you would be comfortable being tested on  (`skills`)

**Why:** Keyword matching pulls terms onto a resume. A skill with no evidence behind it is where the ambush question comes from.

**Verified by:** data  
**Saved with:** `add_evidence`

**What Claude asks / does:**
- List tools and skills with a level (familiar, working, strong, expert). For each, ask which project or role proves it, and put that in detail. Leave off anything they could not whiteboard.

## 5. What must never be claimed  (`boundaries`)

**Why:** Written guardrails stop a tailoring pass from reaching for a claim that fits the JD but is not true.

**Verified by:** data  
**Saved with:** `add_evidence`

**What Claude asks / does:**
- Ask what they must never claim even when a JD asks for it: experience they do not have, titles they did not hold, outcomes that did not happen, work someone else did. Save each as kind "boundary" with what is true instead.

## 6. The kinds of role to target, in priority order  (`target_roles`)

**Why:** These drive scoring and which master a role is tailored from.

**Verified by:** saved  
**Saved with:** `put_config`

**What Claude asks / does:**
- Show the archetypes from get_config and ask which to target, in priority order, and what is missing. Save with put_config "archetypes"; keep term lists specific enough that roles do not route to the wrong archetype.

## 7. Cities to search in  (`target_cities`)

**Why:** Each city is searched, and a role outside them that is not remote is filtered out entirely.

**Verified by:** saved  
**Saved with:** `set_preferences`

**What Claude asks / does:**
- Ask which cities. For each: the search location (e.g. "New York, NY") and the words that mean that city in a posting (e.g. new york, nyc, manhattan, brooklyn). Remote roles are always considered.
- Tell them searches per day are queries times cities.

## 8. Pay, work mode, and what you will not do  (`preferences`)

**Why:** A comp floor filters postings that state less; ruled-out industries are filtered however well the role matches.

**Verified by:** saved  
**Saved with:** `set_preferences`

**What Claude asks / does:**
- Work modes they accept: remote, hybrid, onsite.
- Comp floor (base below which a role is not worth applying to) and comp target (what they would say if asked).
- Company stages and industries they prefer, industries to avoid, and any dealbreakers.
- Relocation, sponsorship, earliest start date. These also fill the matching application answers.

## 9. Platforms to search  (`sources`)

**Why:** Each platform is reached differently. Some are built in, some need a connector, some a paid key, and some are not supported.

**Verified by:** saved  
**Saved with:** `set_preferences`

**What Claude asks / does:**
- Call get_source_catalog and ask which platforms to search. Be plain about how each is reached, what it costs, and which are not supported yet. Recommend company boards first.

## 10. Connectors and keys for the platforms you chose  (`connectors`)

**Why:** A platform that needs a connector returns nothing until it is installed, which looks exactly like a quiet day.

**Verified by:** data  
**Saved with:** n/a

**What Claude asks / does:**
- Point them to the dashboard, Setup, "Connect Claude": it lists everything below with copy buttons and downloads, and always shows the current versions.
- For each chosen platform that needs a claude.ai connector (get_source_catalog says which), walk them through adding it in claude.ai: Settings, Connectors.
- Feature connectors: Gmail on the account they apply from (follow-up drafts), and Claude in Chrome for auto-filling applications and for the browser-only platforms (Handshake, Wellfound, any job page).
- After this connector is updated, they refresh its tool list in claude.ai (Settings, Connectors, JobHunt) so new tools appear; reconnecting is only needed if refreshing does not show them.
- This step completes itself once a search run logs results from the connector platforms.

## 11. The four JobHunt skills added to Claude  (`claude_skills`)

**Why:** The scheduled document build runs on tailored-resume and tailored-cover-letter; job-extract reads roles from Handshake and other sites in the browser; application-autofill fills application forms. Without the first two the build run stops.

**Verified by:** confirmed  
**Saved with:** `get_scheduled_task_prompts`, `confirm_setup_step`

**What Claude asks / does:**
- get_scheduled_task_prompts returns the four skill downloads (skills). Give the person the links: they open in their signed-in browser. The dashboard, Setup, "Connect Claude" has the same download buttons.
- They upload each zip in claude.ai, Settings, Capabilities, Skills (the same skills reach Cowork). Uploading replaces an older copy with the same name.
- Once they say all four are uploaded, call confirm_setup_step with step "claude_skills" and their words. You cannot check this from here, so do not mark it done on a guess.

## 12. Companies whose own job boards to watch  (`target_boards`)

**Why:** The freshest and least contested postings, and the list is empty by default.

**Verified by:** saved  
**Saved with:** `search_company_boards`, `put_config`

**What Claude asks / does:**
- Ask which companies to watch. For each, find its board: try it on Greenhouse, Lever and Ashby with search_company_boards with `boards` set to just that candidate and `ingest` false (a preview, nothing is added), and keep only slugs that return postings. Save with put_config "target_boards" as "slug:Display Name" entries, sending the complete value.

## 13. Application answers with nothing left as CONFIRM  (`application_answers`)

**Why:** Auto-fill types these into real forms, so a placeholder would be submitted to an employer.

**Verified by:** data  
**Saved with:** `get_application_profile`, `put_application_profile`

**What Claude asks / does:**
- Call get_application_profile and fill anything still "CONFIRM" with put_application_profile. Never store demographic or EEO answers; those stay theirs to answer on the form.

## 14. At least one goal with a number in it  (`goals`)

**Why:** Without a target the weekly review reports activity, not whether the search is working.

**Verified by:** data  
**Saved with:** `set_goal`

**What Claude asks / does:**
- Agree at least one countable goal, usually applications per week. Push back on goals with no number.

## 15. A written plan  (`plan`)

**Why:** Documents and advice build on what was already decided instead of reopening it every session.

**Verified by:** saved  
**Saved with:** `put_plan`

**What Claude asks / does:**
- Draft it with them, not for them: positioning per archetype drawn only from confirmed evidence, weekly cadence tied to the goals, and what they have decided not to chase. Save with put_plan.

## 16. The four scheduled runs set up, and the search run once  (`scheduled_runs`)

**Why:** This is what makes it run without you. Running the search once by hand also approves its tool permissions, so scheduled runs do not stall on a prompt.

**Verified by:** data  
**Saved with:** `get_scheduled_task_prompts`

**What Claude asks / does:**
- The four runs (daily search, daily sweep, document build, weekly review) are scheduled tasks that run in the cloud with the computer off (Claude Cowork). Call get_scheduled_task_prompts: it returns each task's title, schedule and prompt, and how to set them up.
- Create them now if you can: when this session has a way to create scheduled tasks (Cowork's scheduled tasks, or the scheduled-tasks tool in Claude Code), list the existing tasks, then update the one with the same title or create it, with the title, schedule and prompt exactly as returned. Tell the person what you created or changed.
- If you cannot create tasks here, hand the person the four as copy-paste blocks (title, frequency, prompt) and point them to the dashboard, Setup, "Connect Claude", which has copy buttons. In Cowork: Scheduled, New task, Set up manually.
- Either way: the approval mode must let tools run without asking, or every run stalls. Never leave two copies of a task, or every run happens twice.
- Then run the search task once (Run now). That completes this step, and usually the connectors step too.

## 17. Roles in the pipeline  (`first_roles`)

**Why:** Proves search, scoring and dedupe work end to end.

**Verified by:** data  
**Saved with:** `add_role`

**What Claude asks / does:**
- Complete once a search run or a hand-added role puts something in the pipeline.
