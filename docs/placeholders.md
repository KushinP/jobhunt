# Placeholders

Personal values were replaced with these tokens. Fill them per user (ideally rendered by the
server from config, not edited by hand).

| Token | Filled from |
|---|---|
| `{{FULL_NAME}}` | `config.identity.name` |
| `{{APPLY_EMAIL}}` | `config.identity.email`: the inbox applications go out from; the search reads LinkedIn alert emails here and the weekly review drafts follow-ups here |
| `{{PHONE}}` | `config.identity.phone` |
| `{{HOME_CITY}}` | `config.identity.city` |
| `{{LINKEDIN_URL}}` | `config.identity.linkedin` |
| `{{JOBHUNT_BASE_URL}}` | the deployed Worker / dashboard origin |
| `{{GRADUATION_DATE}}` | application profile, education |
| `{{GPA}}` | application profile, education |
| `{{SUPABASE_PROJECT_ID}}` | only in legacy skill text; remove |

Also removed entirely (not placeholdered): the personal plan (referral contacts, employer
history, boundaries), the personal profile inside each skill's `reference/CLAUDE.md`, and
the author's local-area town list in `config.locations_local`.
