> Engineering notes from the author's own instance (2026-09-23). Kept because they document known scorer bugs and the fixes still owed in server code.

# Scorer-retune step in the JobHunt Weekly Review scheduled task

Task: `JobHunt: Weekly Review` (Fri 18:00 ET).

Status: **APPLIED.** Verified live on 2026-09-23 by reading the task's stored
prompt. It is installed as STEP 6, with the old final step renumbered to STEP 7.
An earlier attempt had been blocked by the auto-mode permission classifier
(Cowork Scheduled Task Write); it has since gone through. Do not re-apply it.

The live STEP 5 also already carries the corrected threshold rule: it judges
`thresholds.auto_generate` only on New roles that HAVE a JD, and reports the
JD-less backlog separately with its ZipRecruiter and Indeed split. The version
of STEP 5 returned by the server's own `get_scheduled_task_prompts` is the OLD
one and reads as inverted; the live task is ahead of it. Trust the live prompt,
not the canonical copy, when they disagree.

## The step as installed

STEP 6. RETUNE THE SCORER. Two knobs, with different evidence bars. Read `get_config` first.

6a. Threshold (`thresholds.auto_generate`). Retune every week; needs no outcome
data. From the New-with-JD roles in Step 5, take the score distribution and set
`auto_generate` so roughly 20 to 30 roles sit at or above it, about a week of
supply at the 8-applications-a-week goal. Move it no more than 5 points a week,
never below `hard_cutoff` + 5, never above 90. Write with `put_config`, changing
only `thresholds.auto_generate`, and state old value, new value and implied
count. Skip the write entirely when the Queued (Generate) backlog is already
above 40, and say so.

6b. Weights (`weights`). GATED until `get_metrics` shows at least 5 roles that
reached interview across 2 or more score bands. Below that bar, say weight
retuning is gated and change nothing. A gradient cannot appear while nearly
every application comes from one band; report that as a selection artifact.

Never change `hard_cutoff`, the archetypes, the query set or the exclusion lists
in an automated run.

## Why the gate

As of 2026-09-23 the calibration table read 0% interviews in all four bands
(90-100, 80-89, 70-79, 60-69), flat because the interview column is zero
everywhere, not because the weights are wrong. 16 of 19 applications came from
the 90-100 band, so the table is structurally incapable of showing a gradient.

## What 6a does NOT fix

The scorer's worst failure is neither the threshold nor the weights: it is the
hard title gate, which STEP 6 is correctly forbidden from touching. See
`claude/scorer-title-gate.md`. That one needs the owner's manual approval.

Config at time of writing: weights title 20 / domain 25 / skill 20 /
seniority 20 / location 15; hard_cutoff 60; auto_generate 75.
