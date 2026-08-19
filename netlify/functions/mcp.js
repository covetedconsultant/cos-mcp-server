// mcp.js — North Star OS Chief of Staff MCP server.
//
// REBUILT 2026-08-09. The original source (built 2026-08-06 through
// 2026-08-08, growing from 3 tools to 22) was lost — deployed via the
// Netlify MCP connector's deploy-site tool from an ephemeral sandbox
// directory that no longer exists, with no repo, no source zip, and no
// backup anywhere reachable. See doc 70 (rebuild plan/log) for the full
// recovery investigation. This file is a from-scratch reconstruction
// against:
//   - the 22 tools' exact names/params/behavior as declared live by the
//     Baron Cowork connector (the most authoritative source available —
//     pulled directly from the connector's own tool schemas)
//   - REF-cos-mcp-server-architecture v2.1 (Supabase, `instructions` table)
//   - doc 56 (proven original 3-tool build pattern: token-in-path auth,
//     404-for-any-invalid-token, the Claude HEAD-probe fix)
//   - live Supabase schema, read directly via information_schema.columns
//     (never assumed — this project has a standing rule, after a prior
//     incident, to verify table/column existence before writing queries)
//
// Every response was checked, where possible, against a real live call to
// the CURRENT production server before this file was written. Tools that
// could not be safely live-tested (writes, admin-only, parameterized) are
// marked UNVERIFIED below and should be tested carefully post-deploy.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://omjsqianefykbebnrdmp.supabase.co";

function getSupabase() {
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  // Service-role client, per doc 56 §3c / REF-cos-mcp-server-architecture:
  // the server authenticates AS service role and scopes every query itself
  // by client_id. It does not rely on RLS for scoping (RLS may still be
  // enabled on these tables, but this server's own WHERE clauses are the
  // real, load-bearing scoping mechanism — never omit a client_id filter
  // on a client-scoped table).
  return createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------
// AUTH — token-in-path lookup. Per doc 56: any invalid, missing, garbage,
// or revoked token returns a plain 404 — NEVER a 401. This is deliberate:
// a 401 triggers Claude's OAuth-auto-start behavior, which is the exact
// bug this whole private-URL design exists to route around. An outside
// observer must not be able to distinguish "wrong token" from "revoked
// token" from "no token" — all three look identical (404).
// ---------------------------------------------------------------------
async function resolveClientFromToken(token, supabase) {
  if (!token || token.length < 10) return null;
  const { data, error } = await supabase
    .from("client_mcp_tokens")
    .select("client_id, revoked_at")
    .eq("path_token", token)
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;

  // Fire-and-forget last_used_at update (doc 55 §2c — lets Alzay eyeball
  // usage patterns later). Do not block/fail the request if this errors.
  supabase
    .from("client_mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("path_token", token)
    .then(() => {})
    .catch(() => {});

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, name, email, tier, status, company_name, timezone")
    .eq("id", data.client_id)
    .maybeSingle();
  if (clientErr || !client) return null;
  return client;
}

function requireAdmin(client) {
  if (client.tier !== "admin") {
    throw { code: "forbidden", message: "Admin-only tool." };
  }
}

function jsonRpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(result) }] },
  };
}

function jsonRpcError(id, message) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify({ error: message }) }],
      isError: true,
    },
  };
}

// ---------------------------------------------------------------------
// TOOL DEFINITIONS — tools/list response. Names, param shapes, and
// descriptions taken directly from the live Baron connector's own
// declared schemas (pulled 2026-08-09), not guessed.
// ---------------------------------------------------------------------
const TOOLS = [
  { name: "ping_test", description: "Proof-of-life test tool. Confirms the private-URL connector is authenticated and working end to end.", inputSchema: { type: "object", properties: {} } },
  { name: "get_my_profile", description: "Get the signed-in client's own profile row (name, email, tier, status).", inputSchema: { type: "object", properties: {} } },
  { name: "get_my_documents", description: "List the signed-in client's own recent documents.", inputSchema: { type: "object", properties: {} } },
  { name: "get_my_daily_brief", description: "Returns the assembled daily brief for the caller's client_id, for a given date (defaults to today).", inputSchema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD, optional, defaults to today" } } } },
  { name: "get_my_operating_picture", description: "Returns the caller's own Operating Picture — annual, quarterly, weekly, daily narratives plus when each was last authored.", inputSchema: { type: "object", properties: {} } },
  { name: "get_my_quarter_status", description: "Returns the caller's current quarter/cycle window from review_schedule, plus derived week-of-quarter and total-weeks. found:false if none covers today.", inputSchema: { type: "object", properties: {} } },
  { name: "get_my_review_documents", description: "Returns the caller's current quarterly_forward document and most recent weekly_review document.", inputSchema: { type: "object", properties: {} } },
  { name: "get_my_year_quarterly_cards", description: "Returns every quarterly_forward/quarterly_backward documents row for the caller within a given year.", inputSchema: { type: "object", properties: { year: { type: "number", description: "e.g. 2026" } }, required: ["year"] } },
  { name: "get_my_cycle_weekly_rows", description: "Returns all weekly_review documents rows for the caller within a date window. Ordered oldest first.", inputSchema: { type: "object", properties: { starts_on: { type: "string" }, ends_on: { type: "string" }, limit: { type: "number" } }, required: ["starts_on", "ends_on"] } },
  { name: "get_current_quarter_calendar", description: "Returns the shared org-wide quarter calendar. Not client-scoped.", inputSchema: { type: "object", properties: {} } },
  { name: "get_my_dream100_status", description: "Returns the caller's Dream 100 roster/status.", inputSchema: { type: "object", properties: {} } },
  { name: "get_onboarding_status", description: "Reports whether the caller has a clients row, whether they're onboarded, and which onboarding step to resume from.", inputSchema: { type: "object", properties: {} } },
  { name: "get_my_workflows", description: "Returns the protocols/workflows pushed to the caller (from action_registry).", inputSchema: { type: "object", properties: {} } },
  { name: "capture_note", description: "Write tool. Captures a decision, follow-up, or contact-update note, scoped to the caller's own client_id.", inputSchema: { type: "object", properties: { note_content: { type: "string" }, tags: { type: "string" } }, required: ["note_content"] } },
  { name: "set_my_sweep_time", description: "Write tool. Sets the scheduled day/time for one of the caller's own sweeps in sweep_schedules, scoped to the caller's own client_id. Upserts by (client_id, sweep_name).", inputSchema: { type: "object", properties: { sweep_name: { type: "string", description: "e.g. Content Sweep" }, scheduled_time: { type: "string", description: "HH:MM:SS, 24-hour" }, scheduled_days: { type: "array", items: { type: "string" }, description: "e.g. [\"Monday\"]" }, timezone: { type: "string", description: "e.g. America/New_York, optional, defaults to caller's existing timezone" } }, required: ["sweep_name", "scheduled_time", "scheduled_days"] } },
  { name: "set_my_quarter", description: "Write tool. Copies a quarter's dates onto the caller's own review_schedule row. Upserts by (client_id, quarter, year).", inputSchema: { type: "object", properties: { quarter: { type: "string" }, year: { type: "number" }, starts_on: { type: "string" }, ends_on: { type: "string" }, day_1_date: { type: "string" }, day_2_date: { type: "string" }, day_3_date: { type: "string" }, day_4_date: { type: "string" } }, required: ["quarter", "year", "starts_on", "ends_on", "day_1_date", "day_2_date"] } },
  { name: "set_my_annual_rendered", description: "Write tool. Rebuilds and stores the caller's operating_picture.annual_rendered layer. Upserts.", inputSchema: { type: "object", properties: { annual_rendered: { type: "string" } }, required: ["annual_rendered"] } },
  { name: "set_my_daily_rendered", description: "Write tool. Rebuilds and stores the caller's operating_picture.daily_rendered layer. Upserts.", inputSchema: { type: "object", properties: { daily_rendered: { type: "string" } }, required: ["daily_rendered"] } },
  { name: "run_onboarding_step", description: "Write tool for onboarding (co-18). Accepts a step key and its data, writes exactly the column(s) that step owns.", inputSchema: { type: "object", properties: { step: { type: "string", enum: ["q2_name", "q3_timezone", "q4_brief_time", "q5_folder", "q7_cos_name", "q8_company", "annual_confirmed", "work_style_confirmed", "close"] }, data: { type: "object" } }, required: ["step", "data"] } },
  { name: "list_clients", description: "Cross-client visibility. Admin-only.", inputSchema: { type: "object", properties: {} } },
  { name: "get_client_status", description: "Per-client status lookup for the operator, by client_id. Admin-only.", inputSchema: { type: "object", properties: { client_id: { type: "string" } }, required: ["client_id"] } },
  { name: "get_weekly_board_rows", description: "Admin-only. Every client's weekly_review documents row (contract columns only, never body_rendered) within a date window, plus full active client roster.", inputSchema: { type: "object", properties: { starts_on: { type: "string" }, ends_on: { type: "string" } }, required: ["starts_on", "ends_on"] } },
];

const ADMIN_TOOLS = new Set(["list_clients", "get_client_status", "get_weekly_board_rows"]);

export default async (req, context) => {
  // Claude probes remote MCP servers with a bare HEAD request before
  // POSTing — doc 56 §"KNOWN OPERATIONAL QUIRKS" — must return a plain 200
  // with no body or Claude treats the server as unreachable.
  if (req.method === "HEAD") {
    return new Response(null, { status: 200 });
  }

  const url = new URL(req.url);
  // Route shape: /mcp/<token>/  — matches the live wildcard route
  // confirmed in the current deploy's function manifest (^\/mcp(?:\/(.*))\/?$)
  const match = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
  const token = match ? match[1] : null;

  const supabase = getSupabase();
  const client = await resolveClientFromToken(token, supabase);
  if (!client) {
    // Same 404 regardless of WHY — garbage token, revoked token, no token.
    return new Response("Not Found", { status: 404 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const { id, method, params } = body;

  if (method === "initialize") {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "north-star-os-chief-of-staff", version: "2.0.0" },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  if (method === "tools/list") {
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id, result: { tools: TOOLS } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments || {};

    try {
      if (ADMIN_TOOLS.has(toolName)) requireAdmin(client);

      const result = await callTool(toolName, args, client, supabase);
      return new Response(JSON.stringify(jsonRpcResult(id, result)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      const message = err?.message || "Tool execution failed.";
      return new Response(JSON.stringify(jsonRpcError(id, message)), {
        status: 200, // JSON-RPC errors still return 200; error is in the body
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config = {
  path: "/mcp/*",
};

// ---------------------------------------------------------------------
// TOOL IMPLEMENTATIONS
// Each implementation notes whether it was checked against a real live
// response from the current production server (VERIFIED) or reconstructed
// from the connector's schema/description alone because it could not be
// safely tested (write tool, admin tool, or needs a real parameter I
// didn't want to invent) — marked UNVERIFIED. Do not treat UNVERIFIED
// tools as proven until tested for real post-deploy.
// ---------------------------------------------------------------------
async function callTool(name, args, client, supabase) {
  switch (name) {
    case "ping_test": {
      // VERIFIED shape (doc 56 §4a, matches the live server's own reply style)
      return `pong. Authenticated as: ${client.name} (client_id ${client.id}). Server time: ${new Date().toISOString()}`;
    }

    case "get_my_profile": {
      // VERIFIED — matches live call made 2026-08-09
      return {
        id: client.id,
        name: client.name,
        email: client.email,
        company_name: client.company_name,
        timezone: client.timezone,
        tier: client.tier,
        status: client.status,
      };
    }

    case "get_my_documents": {
      // VERIFIED shape (empty array is the confirmed live response — no
      // doc-listing logic has ever been fully wired per doc 58; returning
      // the client's own documents rows here is the best-effort behavior
      // matching the tool's description, but the exact original query is
      // UNVERIFIED beyond "returns client's own docs, most recent first")
      const { data, error } = await supabase
        .from("documents")
        .select("id, doc_type, box, quarter, year, week_number, created_at")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return data || [];
    }

    case "get_my_daily_brief": {
      // UNVERIFIED — could not safely live-test (writes nothing, but no
      // confirmed daily_briefs row exists for Alzay's account to check
      // shape against). Best-effort against the daily_briefs table.
      const date = args.date || new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("daily_briefs")
        .select("*")
        .eq("client_id", client.id)
        .eq("brief_date", date)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data || { found: false, date };
    }

    case "get_my_operating_picture": {
      // VERIFIED — matches live call made 2026-08-09 exactly (found,
      // annual_rendered, annual_authored_at, quarterly/weekly/daily
      // rendered + authored_at pairs)
      const { data, error } = await supabase
        .from("operating_picture")
        .select("annual_rendered, annual_authored_at, quarterly_rendered, quarterly_authored_at, weekly_rendered, weekly_authored_at, daily_rendered, daily_authored_at")
        .eq("client_id", client.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { found: false };
      return { found: true, ...data };
    }

    case "get_my_quarter_status": {
      // VERIFIED — matches live call made 2026-08-09 (found, quarter,
      // year, starts_on, ends_on, day_1-4_date, week_n, total_weeks,
      // days_to_review)
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("review_schedule")
        .select("*")
        .eq("client_id", client.id)
        .lte("starts_on", today)
        .gte("ends_on", today)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { found: false };

      const start = new Date(data.starts_on);
      const end = new Date(data.ends_on);
      const now = new Date(today);
      const msPerWeek = 7 * 24 * 60 * 60 * 1000;
      const week_n = Math.floor((now - start) / msPerWeek) + 1;
      const total_weeks = Math.ceil((end - start) / msPerWeek);
      const days_to_review = Math.ceil((end - now) / (24 * 60 * 60 * 1000));

      return {
        found: true,
        quarter: data.quarter,
        year: data.year,
        starts_on: data.starts_on,
        ends_on: data.ends_on,
        day_1_date: data.day_1_date,
        day_2_date: data.day_2_date,
        day_3_date: data.day_3_date,
        day_4_date: data.day_4_date,
        week_n,
        total_weeks,
        days_to_review,
      };
    }

    case "get_my_review_documents": {
      // UNVERIFIED shape (no live row to test against for Alzay's own
      // account at time of writing) — logic per description: current
      // quarterly_forward + most recent weekly_review.
      const { data: forward, error: fErr } = await supabase
        .from("documents")
        .select("*")
        .eq("client_id", client.id)
        .eq("doc_type", "quarterly_forward")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (fErr) throw new Error(fErr.message);

      const { data: weekly, error: wErr } = await supabase
        .from("documents")
        .select("*")
        .eq("client_id", client.id)
        .eq("doc_type", "weekly_review")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (wErr) throw new Error(wErr.message);

      return { quarterly_forward: forward || null, weekly_review: weekly || null };
    }

    case "get_my_year_quarterly_cards": {
      // UNVERIFIED shape, logic per description
      const { year } = args;
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("client_id", client.id)
        .in("doc_type", ["quarterly_forward", "quarterly_backward"])
        .eq("year", year)
        .order("quarter", { ascending: true });
      if (error) throw new Error(error.message);
      return data || [];
    }

    case "get_my_cycle_weekly_rows": {
      // UNVERIFIED shape, logic per description ("ordered oldest first")
      const { starts_on, ends_on, limit } = args;
      let query = supabase
        .from("documents")
        .select("*")
        .eq("client_id", client.id)
        .eq("doc_type", "weekly_review")
        .gte("created_at", starts_on)
        .lte("created_at", ends_on)
        .order("created_at", { ascending: true });
      if (limit) query = query.limit(limit);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data || [];
    }

    case "get_current_quarter_calendar": {
      // FIXED 2026-08-09, verified against co-14 v2.1 (Dependencies +
      // "CHANGE FROM v1.0" section) rather than guessed. co-14's own text:
      // review_schedule rows with user_name='alzay' and client_id IS NULL
      // are "formalized as that shared calendar's home" — one shared,
      // org-wide calendar, four rows (one per quarter), same dates for
      // every client. Confirmed live: exactly these four rows exist
      // (user_name='alzay', client_id null, Q1-Q4 2026). The previous
      // version of this code queried user_name = "Alzay Calhoun" (capital,
      // client-scoped) — that finds Alzay's own CLIENT row (a copy made by
      // set_my_quarter), not the shared calendar. It happened to still
      // return a plausible-looking Q3 result because that row overlaps the
      // real calendar's Q3, but the query was structurally wrong and would
      // not generalize. Fixed to match the real shared-calendar rows.
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("review_schedule")
        .select("*")
        .eq("user_name", "alzay")
        .is("client_id", null)
        .order("starts_on", { ascending: true });
      if (error) throw new Error(error.message);

      const current = (data || []).find((r) => r.starts_on <= today && r.ends_on >= today);
      if (current) {
        return {
          found: true,
          covers_today: true,
          quarter: current.quarter,
          year: current.year,
          starts_on: current.starts_on,
          ends_on: current.ends_on,
          day_1_date: current.day_1_date,
          day_2_date: current.day_2_date,
          day_3_date: current.day_3_date,
          day_4_date: current.day_4_date,
        };
      }
      const upcoming = (data || []).find((r) => r.starts_on > today);
      if (upcoming) {
        return {
          found: true,
          covers_today: false,
          quarter: upcoming.quarter,
          year: upcoming.year,
          starts_on: upcoming.starts_on,
          ends_on: upcoming.ends_on,
          day_1_date: upcoming.day_1_date,
          day_2_date: upcoming.day_2_date,
          day_3_date: upcoming.day_3_date,
          day_4_date: upcoming.day_4_date,
        };
      }
      return { found: false };
    }

    case "get_my_dream100_status": {
      // UNVERIFIED — no dedicated dream100 table exists in the live
      // schema (checked). FLAG FOR ALZAY: the real source for this tool
      // is unconfirmed — possibly a documents doc_type, possibly a
      // Coda-only concept (dream100-roster.md exists as a local file, per
      // NS OS - Scout folder) never actually migrated to Supabase. Do not
      // trust this implementation without confirming the real source.
      throw new Error(
        "get_my_dream100_status: no confirmed live data source in Supabase — needs Alzay's input before this can be implemented safely. See doc 70."
      );
    }

    case "get_onboarding_status": {
      // VERIFIED — matches live call made 2026-08-09 exactly (has_client_row,
      // onboarded, resume_from, known_fields)
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, chief_of_staff_name, timezone, brief_time, folder_root, company_name, onboarded_at")
        .eq("id", client.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { has_client_row: false, onboarded: false, resume_from: "q2_name", known_fields: {} };

      const onboarded = !!data.onboarded_at;
      return {
        has_client_row: true,
        onboarded,
        resume_from: onboarded ? null : "q2_name", // best-effort; real step-resume logic UNVERIFIED
        known_fields: {
          name: data.name,
          chief_of_staff_name: data.chief_of_staff_name,
          timezone: data.timezone,
          brief_time: data.brief_time,
          folder_root: data.folder_root,
          company_name: data.company_name,
        },
      };
    }

    case "get_my_workflows": {
      // UNVERIFIED shape, logic per description
      const { data, error } = await supabase
        .from("action_registry")
        .select("id, name, purpose, box, published")
        .eq("client_id", client.id)
        .eq("published", true);
      if (error) throw new Error(error.message);
      return data || [];
    }

    case "capture_note": {
      // UNVERIFIED — write tool, not fired during this rebuild to avoid
      // creating test data in a real client's account without asking.
      const { note_content, tags } = args;
      const { data, error } = await supabase
        .from("client_notes")
        .insert({ client_id: client.id, note_content, tags: tags || null, status: "open" })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { success: true, note: data };
    }

    case "set_my_sweep_time": {
      // Added 2026-08-18. Scoped to caller client_id, upserts by
      // (client_id, sweep_name) -- matches capture_note's scoping pattern.
      const { sweep_name, scheduled_time, scheduled_days, timezone } = args;
      const updateRow = {
        client_id: client.id,
        sweep_name,
        scheduled_time,
        scheduled_days,
      };
      if (timezone) updateRow.timezone = timezone;
      const { data, error } = await supabase
        .from("sweep_schedules")
        .upsert(updateRow, { onConflict: "client_id,sweep_name" })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { success: true, sweep_schedule: data };
    }

    case "set_my_quarter": {
      // UNVERIFIED — write tool, not fired during this rebuild.
      const { quarter, year, starts_on, ends_on, day_1_date, day_2_date, day_3_date, day_4_date } = args;
      const { data, error } = await supabase
        .from("review_schedule")
        .upsert(
          {
            client_id: client.id,
            quarter,
            year,
            starts_on,
            ends_on,
            day_1_date,
            day_2_date,
            day_3_date: day_3_date || null,
            day_4_date: day_4_date || null,
          },
          { onConflict: "client_id,quarter,year" }
        )
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { success: true, review_schedule: data };
    }

    case "set_my_annual_rendered": {
      // UNVERIFIED — write tool, not fired during this rebuild.
      const { annual_rendered } = args;
      const { data, error } = await supabase
        .from("operating_picture")
        .upsert(
          { client_id: client.id, annual_rendered, annual_authored_at: new Date().toISOString() },
          { onConflict: "client_id" }
        )
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { success: true, operating_picture: data };
    }

    case "set_my_daily_rendered": {
      // UNVERIFIED — write tool, not fired during this rebuild.
      const { daily_rendered } = args;
      const { data, error } = await supabase
        .from("operating_picture")
        .upsert(
          { client_id: client.id, daily_rendered, daily_authored_at: new Date().toISOString() },
          { onConflict: "client_id" }
        )
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { success: true, operating_picture: data };
    }

    case "run_onboarding_step": {
      // IMPLEMENTED 2026-08-09, per co-18 v2.2's own Dependencies section,
      // read directly from Supabase (not guessed). Each step key owns
      // EXACTLY the column(s) named below — never a generic column writer,
      // per co-18's own explicit rule. Step keys and their exact target
      // columns, verbatim from co-18 §5 Dependencies:
      //   q2_name           -> clients.name
      //   q3_timezone       -> clients.timezone
      //   q4_brief_time     -> clients.brief_time
      //   q5_folder         -> clients.folder_root
      //   q7_cos_name       -> clients.chief_of_staff_name
      //   q8_company        -> clients.company_name
      //   annual_confirmed  -> operating_picture.annual_rendered,
      //                        operating_picture.annual_authored_at
      //   work_style_confirmed -> operating_picture.voice_preferences,
      //                        operating_picture.boundaries,
      //                        operating_picture.work_style
      //   close             -> clients.onboarded_at
      const { step, data } = args;

      const CLIENTS_STEP_MAP = {
        q2_name: "name",
        q3_timezone: "timezone",
        q4_brief_time: "brief_time",
        q5_folder: "folder_root",
        q7_cos_name: "chief_of_staff_name",
        q8_company: "company_name",
      };

      if (CLIENTS_STEP_MAP[step]) {
        const column = CLIENTS_STEP_MAP[step];
        const dataKey = Object.keys(data || {})[0]; // e.g. { name } -> "name"
        if (!dataKey) throw new Error(`run_onboarding_step: step "${step}" requires a data value.`);
        const { data: updated, error } = await supabase
          .from("clients")
          .update({ [column]: data[dataKey] })
          .eq("id", client.id)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return { success: true, step, wrote: { [column]: data[dataKey] } };
      }

      if (step === "annual_confirmed") {
        const { annual_rendered } = data;
        if (!annual_rendered) throw new Error('run_onboarding_step: "annual_confirmed" requires data.annual_rendered.');
        const { data: updated, error } = await supabase
          .from("operating_picture")
          .upsert(
            { client_id: client.id, annual_rendered, annual_authored_at: new Date().toISOString() },
            { onConflict: "client_id" }
          )
          .select()
          .single();
        if (error) throw new Error(error.message);
        return { success: true, step, operating_picture: updated };
      }

      if (step === "work_style_confirmed") {
        const { voice_preferences, boundaries, work_style } = data;
        const { data: updated, error } = await supabase
          .from("operating_picture")
          .upsert(
            {
              client_id: client.id,
              voice_preferences: voice_preferences || null,
              boundaries: boundaries || null,
              work_style: work_style || null,
            },
            { onConflict: "client_id" }
          )
          .select()
          .single();
        if (error) throw new Error(error.message);
        return { success: true, step, operating_picture: updated };
      }

      if (step === "close") {
        // Marks onboarding complete server-side, per co-18 Step 7.
        const { data: updated, error } = await supabase
          .from("clients")
          .update({ onboarded_at: new Date().toISOString() })
          .eq("id", client.id)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return { success: true, step, onboarded_at: updated.onboarded_at };
      }

      throw new Error(`run_onboarding_step: unrecognized step "${step}".`);
    }

    case "list_clients": {
      // VERIFIED — matches live call made 2026-08-09 exactly (id, name,
      // email, tier, status, onboarded_at, company_name)
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, email, tier, status, onboarded_at, company_name");
      if (error) throw new Error(error.message);
      return data || [];
    }

    case "get_client_status": {
      // UNVERIFIED shape (not live-tested — would have required passing a
      // real client_id and I didn't want to fire an admin tool blind
      // during discovery). Best-effort per description: per-client status
      // lookup.
      const { client_id } = args;
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("id", client_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { found: false };
      return { found: true, ...data };
    }

    case "get_weekly_board_rows": {
      // UNVERIFIED shape — reconstructed carefully against the tool's own
      // very specific description (contract columns only, NEVER
      // body_rendered, plus full roster separately).
      const { starts_on, ends_on } = args;
      const { data: rows, error: rowsErr } = await supabase
        .from("documents")
        .select("client_id, box, week_number, quarterly_priority, priority_movement, one_thing, bronze_result, win, unfinished, classification, client_language, conversations, new_clients, retainers, created_at")
        .eq("doc_type", "weekly_review")
        .gte("created_at", starts_on)
        .lte("created_at", ends_on);
      if (rowsErr) throw new Error(rowsErr.message);

      const { data: roster, error: rosterErr } = await supabase
        .from("clients")
        .select("id, name, email, tier, status, company_name")
        .eq("status", "active");
      if (rosterErr) throw new Error(rosterErr.message);

      return { weekly_rows: rows || [], active_clients: roster || [] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
