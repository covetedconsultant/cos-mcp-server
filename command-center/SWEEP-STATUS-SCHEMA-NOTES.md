# Sweep status panel — schema notes

Tracks what the database needs before the Command Center's sweep rows can
show real run history and a working "Run now" button. Started 2026-08-25,
during the sweep-detail-dropdown mockup session (Option A / inline strip
chosen — see the published artifact for the visual). Alzay is making these
changes himself before this chat closes; this doc is the checklist for
that, not a record of changes already made.

## What the client needs to see, per sweep row

1. How many times has this sweep run, total.
2. When did it last run.
3. When will it run next (already partly covered by `scheduled_time` /
   `scheduled_days` on `sweep_schedules` — no gap there).
4. A "Run now" button that copies a ready-to-paste prompt, the same
   pattern already live for Virtual Team Playbooks
   (`copyPlaybookPrompt` in the command-center template — "Run the
   Virtual Team playbook for Box 2, Client Avatar.").

## What already exists — no change needed

`protocol_runs` already carries everything needed for #1 and #2:

| column | type | use |
|---|---|---|
| `client_id` | uuid | filter to this client |
| `for_protocol` | text | matches `sweep_schedules.protocol_id` |
| `requested_at` | timestamptz | timestamp of each run |

Run count and last-ran are a **query change**, not a schema change:

```sql
select for_protocol, count(*) as run_count, max(requested_at) as last_ran
from protocol_runs
where client_id = :client_id
group by for_protocol;
```

`get_my_sweeps` already joins `sweep_schedules` + `protocol_runs` per the
prior session's handoff — this just needs to also aggregate the above and
return `run_count` / `last_ran` per sweep row, which the server tool can
do without a migration.

## What actually needs a schema change

**The "Run now" copy-prompt button has nothing to copy.** The playbook
chips work because `copyPlaybookPrompt()` hardcodes a friendly sentence
client-side per box. Scheduled sweeps have no equivalent — `sweep_schedules
.protocol_id` is an internal id (e.g. a `co-*` reference), not something a
client should ever see or paste, and `instructions.body` is the full
protocol document, not a short trigger phrase.

Proposed addition to `sweep_schedules`:

| column | type | notes |
|---|---|---|
| `run_prompt_text` | text, nullable | The exact human-readable sentence the "Run now" button copies to the client's clipboard — e.g. `"Run this week's priorities sweep now."` Nullable so existing rows don't need to backfill before this ships; a row with no value should have "Run now" fall back to disabled or hidden rather than copying nothing. |

Open question, not yet decided: should `run_prompt_text` be authored once
per sweep at creation time, or generated from `sweep_name` at read time
(e.g. `"Run " + sweep_name + " now."`)? A stored column gives Alzay control
over the exact wording per sweep; a generated string needs no new column
at all. Flagging both options here since Alzay is the one making the
migration call.

## Not in scope here

- Nothing about *triggering* the sweep server-side — "Run now" in the
  existing mockups only copies a prompt to paste into chat, it doesn't
  call a tool directly. If that ever changes to a real trigger, that's a
  separate, larger schema/API conversation.
- The inline-strip sweep detail dropdown (input/process/output) itself
  needs no schema change — it renders from the sweep's existing
  name/category/status, plus whatever static copy is written per sweep.
