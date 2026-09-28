# Outreach: the cadence rules, and why they are in code

Outreach is the messages you send to a person at a company you applied to. JobHunt drafts
them, records them and measures them. **It never sends anything**, and there is no code path
that could: no LinkedIn client, no mail send, no connector with send scope.

The rules live in `core/src/outreach.ts` rather than in a prompt, for the same reason scoring
does: a rule in a prompt drifts between runs, and this one governs messages to real people.

## The rules

| | Rule | Enforced |
|---|---|---|
| a | Sent, Accepted, Replied and Meeting are yours to report | `updateOutreach` refuses them from automation; the connector demands your own words, the dashboard a click |
| b | A touch cannot be sent before the application it follows | the role must be Applied, Interviewing or Offer; a `create_role` touch is exempt, since there is no posting |
| c | One message per company per day | company names are compared with Inc, LLC, US, Corporation and Group stripped, on the New York calendar day |
| d | One approach and one nudge per contact | counted over cold touches (connect_note, create_role, backup, nudge) |
| e | Marking Sent sets the follow-up three business days out | weekends skipped, holidays not |
| f | A nudge is due seven business days after the first message | reported by `get_outreach_due`, never sent for you |
| g | An unanswered nudge becomes No reply after five business days | the only status automation may set |
| h | Automation never overwrites what you recorded | it acts only on a touch still sitting at Sent |

Every refusal names its rule, so the message says what to do rather than that something failed.

## Two places the rules contradicted each other

**(g) against (h).** Sent is human-only, so every sent touch is already marked as set by you. A
literal reading of (h) would forbid (g) entirely, since the No-reply sweep always overwrites a
status a person set. Resolved by scope: automation may act only on a touch whose status is
still exactly `Sent`, meaning nothing has happened since. Accepted, Replied, Meeting, No reply
and Closed are never touched.

**(d) against the follow-up.** "Two touches per contact" would forbid the follow-up that
`get_outreach_due` asks for when a connection is accepted, which is the most valuable message
in the sequence: the hard part already worked. Resolved by kind: the cap counts cold touches,
and a `follow_up` is allowed only once that contact accepted or replied. Logging one earlier is
refused as a third cold touch, with a pointer to the nudge.

## What the numbers are for

`get_metrics` reports accept rate, reply rate, and reply rate broken down by hook type, contact
type and role family, plus the interview rate for applications with outreach against those
without, each with its n. When 15 or more messages have gone out and fewer than 15% got a
reply, it sets a warning: at that point the message or the targeting is wrong, and sending more
of the same is the expensive mistake.
