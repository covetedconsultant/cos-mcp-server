# cos-mcp-server — North Star OS Chief of Staff MCP Server

## What this repo is

This is the real, live production server for "Baron," the AI Chief of
Staff every North Star OS client talks to inside their own claude.ai
Project. It is Git-connected to Netlify (`ns-os-private-url-mcp-test`,
site id `6114ac22-a601-4a63-8554-a218a42571bb`) with auto-deploy wired
to `main` — a push to `main` here goes live on its own, no separate
deploy step.

This repo holds mechanism only: the tool surface (what Baron can call),
auth, and data access. It does not hold protocol/instruction content —
what Baron actually *does* with these tools lives in Supabase, not here
(see "Where protocol content lives" below).

## Structure

- `netlify/functions/mcp.js` — the MCP server itself. Every tool Baron
  can call is defined here (the `TOOLS` array) with its handler in the
  matching `switch` case.
- `netlify/functions/health.js` — plain health check, `GET /health`.
- `netlify/functions/north-star-documents.js` — a standalone HTTP
  function, **not** an MCP tool. Not callable by Baron from inside a
  client chat (no filesystem/HTTP access from there) — kept for
  reference/manual use only, not part of the live Command Center path.
- `command-center/templates/diana-reyes-command-center-template.html`
  — a build-time snapshot only, **not** the live source (see the
  comment at the top of the file). The real, authoritative copy is the
  Supabase row `REF-command-center-html-template-v2-20260824`
  (`instructions` table), fetched at runtime via the `get_reference_document`
  tool — deliberately, not by giving a client session direct read
  access to this repo, since that would also expose everything else in
  it (including this server's own architecture notes). If the Supabase
  row changes, update this file to match by hand — the two are not
  wired to stay in sync automatically.

## Auth pattern (every tool must follow this)

- Service-role Supabase client, never anon key.
- Every query scoped by `client_id` — this is a shared, multi-tenant
  server. A tool that queries a table without a real `client_id` column
  to filter on is not safe to ship live (see the `weekly_planning_reports`
  gap — no `client_id` column yet, held back rather than shipped with
  fragile name-matching).
- A resolution failure (bad/missing/revoked token) returns **404, never
  401** — a 401 triggers Claude's OAuth auto-start behavior, which is
  wrong for this private-URL token pattern.

## Adding a new tool — the three-part pattern

1. Add the tool's entry to the `TOOLS` array (name, description,
   `inputSchema`).
2. Add its handler as a new `case` in the dispatch `switch`.
3. Confirm live: after push, `main`'s auto-deploy publishes on its own —
   verify via the deploy record's `commit_ref` (must match the pushed
   commit) and `available_functions` (must be non-empty — a "ready"
   deploy with an empty `available_functions` is a real, silent failure
   mode, not a false alarm; see `LOG-DEPLOY-ERRORS`, `ERR-NET-40`).

## Where protocol content lives (not here)

- **CO protocols** (`co-0`, `co-1`, `co-29`, etc.) — Supabase
  `instructions` table. These tell Baron *when* and *how* to use the
  tools this repo exposes. Written/edited via the `co-protocol-creator`
  skill.
- **REF/LOG documents** — same `instructions` table. Structural
  references (`REF-cos-mcp-server-architecture`, the Command Center
  template/design-system docs) and this server's own error memory
  (`LOG-DEPLOY-ERRORS`, in `system_prompts`).
- This repo's CLAUDE.md governs *this repo's own code* — it is not
  where Baron's client-facing behavior is authored or edited.

## Deploy discipline

Never declare a change "live" on push success or deploy-status alone.
Confirm via a real behavioral probe (a live tool call, not just a
"ready" state) — see `LOG-DEPLOY-ERRORS` and the `go-build-it` skill for
the full discipline and known failure modes before pushing.

## Resolved gaps, kept here as history

As of 2026-08-24, both closed: `get_reference_document(instruction_id)`
lets a client session fetch an approved REF document by name, gated on
a `client_readable` column (default false — nothing is exposed until
explicitly reviewed and marked true). `get_my_sweeps` closes the
matching read-side gap for `sweep_schedules`/`protocol_runs`. `co-29`
now runs as written.
