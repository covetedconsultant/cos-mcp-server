# Onboarding a new 1:1 client for Family 2 sweeps

A repeatable checklist for adding a Family 2 (client-repo) sweep for a new
1:1 client — everything from "they've agreed to a sweep" to "it's dispatching
on schedule." Companion to SWEEP-EXECUTION-SCOPE.md, which explains *why*
each of these steps exists; this doc is just the *do this, then this* list.
Run through it top to bottom per client.

## 1. Get repo access

- [ ] Client adds you (or your dedicated bot account) as a **collaborator**
      on their own output repo, with narrow permission — just enough to
      run Actions, nothing else.

## 2. Add their repo to the dispatch token

- [ ] GitHub → Settings → Developer settings → Personal access tokens →
      Fine-grained tokens → `sweep-dispatch-runner-github`.
- [ ] Edit its repository access list, add the client's repo.
      (You do not need a new token per client — this one token's list just
      grows.)

## 3. Add the shared runner workflow to their repo

- [ ] Copy `.github/workflows/run-sweep.yml` from `diana-reyes-outputs`
      into the new client's repo, same path.
- [ ] Update the `client_id` value hardcoded in its "Report run back to
      Command Center" step to this client's real `clients.id`.

## 4. Set that repo's own secrets

In the client's repo → Settings → Secrets and variables → Actions:

- [ ] `SWEEP_REPORT_SHARED_SECRET` — a new long random string, unique to
      this client's repo (don't reuse one client's value for another).
- [ ] `ANTHROPIC_API_KEY` — whichever key this client's sweeps should run
      on. (Still an open call per SWEEP-EXECUTION-SCOPE.md — decide this
      consciously each time, don't default without thinking.)

## 5. Register that secret on the Supabase side

Supabase dashboard → Edge Functions → Secrets — `report-sweep-run` only
checks ONE shared secret value against every client, so:

- [ ] If this is the very first Family 2 client: add
      `SWEEP_REPORT_SHARED_SECRET` there, matching what you just set in
      step 4.
- [ ] If a Family 2 client already exists: **stop and think** — the
      current design uses one shared secret for every client's report-back,
      which means every client repo must use the *same* value. Reusing one
      secret across clients is a real weak point (see note below) worth
      revisiting once you have more than one Family 2 client live.

## 6. Write the sweep's three files

In the client's own repo, in a new folder named for their initials + a
sequence number (e.g. `DR-001`):

- [ ] `{FOLDER}-protocol.md` — what the sweep does, in the client's terms.
- [ ] `{FOLDER}-reference.md` — supporting material it leans on.
- [ ] `{FOLDER}-log.md` — starts empty; catches mistakes and feedback.

## 7. Create the `sweep_schedules` row

In Supabase, one row per sweep:

```sql
insert into sweep_schedules (
  client_id, sweep_name, scheduled_time, scheduled_days, timezone,
  category, sweep_type, execution_family, repo_owner, repo_name, sweep_folder
) values (
  '<client uuid>', '<human-readable sweep name>', '06:00:00',
  array['Monday'], '<client time zone>', '<moment|meeting|weekly>',
  'single_pass', 'client_repo', '<repo owner>', '<repo name>', '<FOLDER>'
);
```

## 8. Confirm it actually fires

- [ ] Wait for the next scheduled window (or trigger `run-sweep.yml`
      manually from the Actions tab to test the wiring without waiting).
- [ ] Check `protocol_runs` in Supabase for a row with
      `for_protocol = '<FOLDER>'` and a recent `requested_at`.
- [ ] Confirm the sweep shows a real run count / last-ran time in the
      Command Center, not blank.

---

**Known weak point, not yet resolved:** step 5 assumes one shared secret
for every client's report-back. That's fine for a first client; it stops
being fine once several clients' repos all hold the same value — a leak
from any one of them lets someone falsely report runs for every other
client too. Worth a per-client secret name (e.g.
`SWEEP_REPORT_SHARED_SECRET_DR001`) once there's a second Family 2 client
to onboard — flagging here rather than fixing pre-emptively.
