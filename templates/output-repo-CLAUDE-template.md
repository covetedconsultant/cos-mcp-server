<!--
  Output-Repo CLAUDE.md Template
  ================================
  Copy this file's CONTENT (below the line) into a new client's output
  repo as `CLAUDE.md`, replacing every {{TOKEN}} and deleting this
  header comment. Generalized from `diana-reyes-outputs/CLAUDE.md`
  (the first repo built to this shape, 2026-08-24) — keep this
  template and that real example in sync by hand; they are not wired
  together.

  {{CLIENT_NAME}}       — e.g. "Diana Reyes"
  {{SERVICE_LEVEL}}     — e.g. "Level 1 (Bronze — group coaching)". Use
                           whatever level name is actually confirmed for
                           this client — do not guess a tier name that
                           hasn't been confirmed.
  {{SWEEPS_LIST}}       — every level gets Virtual Team Playbooks
                           (always-on, on-demand). Add custom
                           single-pass or second-brain sweep rows here
                           ONLY once a real, specific need is named for
                           THIS client — never scaffold ahead of need.

  Folder set: the five folders below (`toolkit/`, `quarterly/`,
  `annual/`, `receipts/`, `playbooks/`) are the Level 1 baseline, true
  for every client regardless of tier. If this client's actual scope
  adds folders beyond that baseline, add them explicitly with the same
  one-line "why this exists" treatment — don't copy folders from
  another client's repo without a real reason for this one.
-->

# {{CLIENT_NAME}} — Chief of Staff Output Desk

## What this repo is

This is {{CLIENT_NAME}}'s output desk — the place their Chief of Staff
(Baron) delivers finished work. It does not hold Baron's own training or
protocol instructions (that lives elsewhere, on Baron's side of the
relationship — the "laptop," not the "desk"). This repo is
{{CLIENT_NAME}}'s own property.

## Current service level: {{SERVICE_LEVEL}}

At this level, every client gets the same three things, present before
any custom scoping ever happens:

- **Weekly Plan** — lives on {{CLIENT_NAME}}'s Command Center dashboard,
  not as a file in this repo. The dashboard is the canonical home for
  weekly-plan content; nothing here duplicates it.
- **Decision Log** — a running record of what's been decided, whether
  from a group call or individually. See `receipts/` for the underlying
  source material this may draw from.
- **Chief of Staff Sweeps** — {{SWEEPS_LIST}}

No custom sweeps beyond what's listed above exist for {{CLIENT_NAME}}
yet. Those get added only once a real, specific need for them is named —
never scaffolded in advance of that need.

## Folder guide

- `toolkit/` — what tools and connections exist for {{CLIENT_NAME}}, how
  they're wired (MCP or API key), and where credentials are stored.
- `quarterly/` — Look Backward / Look Forward review documents.
- `annual/` — the North Star annual plan.
- `receipts/` — session summaries and notes captured from working
  conversations.
- `playbooks/` — finished, personalized playbook documents (PDFs/HTML),
  produced when {{CLIENT_NAME}}'s Chief of Staff runs a Virtual Team
  Playbook for a specific box.

## A note on what's deliberately absent

This repo does not contain `daily/`, `meetings/`, `actions/`, `sources/`,
`contacts/`, or `dashboards/` folders. Those were tied to a retired
daily-brief concept and an earlier command-center model that no longer
applies to how this system serves clients. Their absence here is
intentional, not an oversight.
