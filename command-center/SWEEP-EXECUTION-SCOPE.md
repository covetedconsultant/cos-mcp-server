# Sweep execution — agreed scope

Decided 2026-08-25, in the same session that chose the Option A sweep-detail
dropdown and ran the `sweep_schedules` migration below. This is the record
of what was agreed, not a build log — nothing described here as "not yet
built" has been built yet.

## The two families

Every sweep belongs to exactly one family. The dividing line is **where its
data lives**, not how important or custom-feeling it is.

### Family 1 — internal

Sweeps that only ever touch data already sitting in North Star's own
Supabase — decisions, weekly plans, sweep run history. These are built once
by the company and reused across every client; nothing about them is
client-specific. They run exactly like the existing `generate-weekly-reports`
edge function: a Supabase `pg_cron` timer fires it, it reads its own
Supabase tables, calls Claude directly, writes the result back. No client
repo, no client credentials, nothing new to invent — this pattern already
runs in production.

### Family 2 — client repo

Sweeps that need to reach a client's own outside tool (their CRM, etc.).
These are custom per client and touch something the company should never
hold credentials for. Execution happens inside the client's own GitHub
repo, using a credential the client owns in their own repo secrets. The
company still authors and owns the quality of what runs — hosting location
is the only thing that moves.

## The three-file protocol pattern (Family 2 only)

Family 1 sweeps need no client-side files — they're generic. Every Family 2
sweep gets its own folder inside the client's output repo, named for the
client's initials and a sequence number (e.g. `DR-001` for Diana Reyes's
first custom sweep). Inside that folder, three files, dash-separated, no
subfolders:

- `DR-001-protocol.md` — what the sweep actually does, in the client's own
  terms. This is the file the company edits whenever the sweep isn't
  working right.
- `DR-001-reference.md` — supporting material the protocol leans on (field
  mappings, tone, whatever context it needs without repeating itself).
- `DR-001-log.md` — catches build mistakes the same way a companion log
  does for any other protocol, **and** is where client feedback lands. The
  "Send feedback" link under a custom sweep in the Command Center writes
  here — one folder holds both the sweep's design and its own record of
  what's gone wrong with it.

## How a Family 2 sweep actually runs — three pieces

1. **Timer** — a `pg_cron` schedule inside Supabase, reading that sweep's
   `scheduled_time` / `scheduled_days` / `timezone` off `sweep_schedules`.
   Fires, does nothing else.
2. **Edge function** — company-owned code in Supabase. The timer wakes it;
   its only job is to send a "run now" signal (a GitHub workflow dispatch)
   to the right repo. It needs a GitHub credential of its own, scoped only
   to trigger dispatches — never the client's CRM key.
3. **GitHub Action** — one generic, reusable workflow file per client repo,
   living at `.github/workflows/` (GitHub only recognizes workflow files in
   that exact location — it cannot live inside the sweep's own folder).
   Not written per sweep: the edge function's signal tells it which sweep
   folder to read. It reads that sweep's `protocol.md` and `reference.md`,
   calls Claude, uses the client's own stored key to act on their tool,
   then reports back to Supabase (writes a `protocol_runs` row) so the
   Command Center's run count and "last ran" stay accurate regardless of
   where the actual work happened.

## Schema — what changed today

`sweep_schedules` already had `scheduled_time`, `scheduled_days`, and
`timezone` from an earlier session — no change needed there.

Added in this session:

```sql
alter table sweep_schedules
  add column execution_family text not null default 'internal',
  add column repo_owner text,
  add column repo_name text,
  add column sweep_folder text;

alter table sweep_schedules
  add constraint sweep_schedules_execution_family_check
  check (execution_family in ('internal', 'client_repo'));

alter table sweep_schedules
  add constraint sweep_schedules_client_repo_fields_check
  check (
    execution_family = 'internal'
    or (repo_owner is not null and repo_name is not null and sweep_folder is not null)
  );
```

`execution_family` defaults to `'internal'`, so every existing row stays a
Family 1 sweep unless explicitly changed. A `client_repo` row is required
to carry `repo_owner` / `repo_name` / `sweep_folder` — enforced by the
second constraint, not just convention.

`protocol_runs` needed no schema change — it already has `client_id`,
`for_protocol`, and `requested_at`, which is what run-count and last-ran
are computed from for both families.

**Explicitly decided against:** a `run_prompt_text` column. "Run now"
stays a copy-a-prompt action (generated at read time from `sweep_name`,
e.g. `"Run " + sweep_name + " now."`), not a column to maintain.

## UI decisions carried into this scope

- Sweep detail, shown as a dropdown under each sweep row: **Option A, the
  inline strip** (Input / Process / Output, three flat cells) — chosen
  over the numbered-stage and plain-sentence alternatives.
- "Run now" copies a prompt to the clipboard; it does not trigger
  execution directly. A true one-click trigger was considered and
  deliberately deferred — not needed yet, revisit once real 1:1 clients
  are live and it's clear the copy-paste step is actually a problem.
- "Send feedback" under a Family 2 sweep writes into that sweep's own
  `-log.md`, not a separate inbox.

## Not yet done — still open

- The edge function and the shared GitHub Action workflow described above
  are designed, not built.
- The GitHub credential the edge function needs is assumed to already
  exist as a Supabase secret — not yet confirmed by name or scope; needs
  verifying before the edge function is written.
- Diana's own real Family 2 sweeps aren't designed yet — this session
  worked out the *mechanism*, using Cameron's real sweeps as the worked
  example, not Diana's actual content.
