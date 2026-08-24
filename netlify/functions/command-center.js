// command-center.js — serves Diana Reyes's (and any future client's)
// filled Command Center HTML page.
//
// Item 3 of the four-step server-build sequence named in
// north-star-documents.js (repo reads -> Supabase schema -> server route
// -> Claude Code hosting). This is the server route.
//
// Auth follows the same private-URL discipline as mcp.js (doc 56 §3a):
// token-in-path, resolved against client_mcp_tokens, ANY invalid/missing/
// revoked token returns a plain 404 — never a 401 or an error page that
// could confirm/deny a token's validity to an outside observer.
//
// Reads: clients, decisions, review_schedule, weekly_planning_reports
// (Supabase), plus the already-deployed GET /command-center/north-star-documents
// route (GitHub repo reads, item 1). weekly_planning_reports is the real
// per-client weekly-plan table — note this is NOT the `weekly_reports`
// table (that one holds Alzay's own admin CS-4/CS-5 infrastructure
// reports, scoped by user_name='alzay' only, no client relationship at
// all — confirmed by reading its live rows before writing this route).
//
// Template source of truth: command-center/templates/
// diana-reyes-command-center-template.html. Every {{TOKEN}} in that file
// is filled below. The template's own inline comments mark which panel is
// existence-gated (North Star Documents, on review_schedule.day_1_date
// minus today <= 14) vs. always present.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SUPABASE_URL = "https://omjsqianefykbebnrdmp.supabase.co";

// netlify/functions/command-center.js -> repo root -> command-center/templates/.
// Declared in netlify.toml's `included_files` so esbuild ships the raw HTML
// alongside the bundled function (it is not JS, so it is never `import`ed).
const TEMPLATE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "command-center",
  "templates",
  "diana-reyes-command-center-template.html"
);

function getSupabase() {
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Same 404-only-signal as mcp.js's resolveClientFromToken — an outside
// observer must not be able to tell "wrong token" from "revoked token"
// from "no token" apart, all three look identical.
async function resolveClientFromToken(token, supabase) {
  if (!token || token.length < 10) return null;
  const { data, error } = await supabase
    .from("client_mcp_tokens")
    .select("client_id, revoked_at")
    .eq("path_token", token)
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;

  supabase
    .from("client_mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("path_token", token)
    .then(() => {})
    .catch(() => {});

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, name, mission_line, github_repo, timezone")
    .eq("id", data.client_id)
    .maybeSingle();
  if (clientErr || !client) return null;
  return client;
}

// Plain literal token substitution — deliberately NOT String#replaceAll,
// which honors $&/$`/$'/$$ replacement patterns even for a string search
// value. Decision/mission/weekly-plan text is free-form client language
// and could plausibly contain a literal "$" sequence; split/join never
// interprets the replacement text as a pattern.
function fill(str, token, value) {
  return str.split(token).join(value);
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Safe to inline inside a <script> tag: prevents a `</script>` (or any
// other `</`) inside stored decision text from closing the tag early.
function escapeForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function formatDateLong(date, timezone) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: timezone || "UTC",
  }).format(date);
}

function formatDateShort(dateStr) {
  if (!dateStr) return "—";
  // dateStr is a plain YYYY-MM-DD date column — parse as UTC so it isn't
  // shifted a day by the server's local timezone.
  const d = new Date(`${dateStr}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function daysBetween(fromDateStr, toDateStr) {
  const from = new Date(`${fromDateStr}T00:00:00Z`);
  const to = new Date(`${toDateStr}T00:00:00Z`);
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

async function getReviewSchedule(supabase, clientId, todayStr) {
  const { data, error } = await supabase
    .from("review_schedule")
    .select("quarter, year, starts_on, ends_on, day_1_date")
    .eq("client_id", clientId)
    .order("starts_on", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data || [];
  const current = rows.find((r) => r.starts_on <= todayStr && r.ends_on >= todayStr);
  if (current) return current;
  const upcoming = rows.find((r) => r.starts_on > todayStr);
  return upcoming || null;
}

// weekly_planning_reports is scoped by free-text user_name, not
// client_id (confirmed: no client_id column on this table). Match
// tolerantly against clients.name — live data has both "Diana Reyes" and
// "diana_reyes" for the same client.
function normalizeName(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function getWeeklyPlanRows(supabase, clientName) {
  const { data, error } = await supabase
    .from("weekly_planning_reports")
    .select("session_date, this_week_bronze, user_name")
    .order("session_date", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  const target = normalizeName(clientName);
  return (data || [])
    .filter((r) => normalizeName(r.user_name) === target)
    .slice(0, 2);
}

async function getNorthStarDocuments(origin, githubRepo, year) {
  if (!githubRepo) return { repo_reachable: false };
  const url = `${origin}/command-center/north-star-documents?github_repo=${encodeURIComponent(githubRepo)}&year=${year}`;
  const resp = await fetch(url);
  if (!resp.ok) return { repo_reachable: false };
  return resp.json();
}

function trackerCell(exists) {
  return exists ? "Filed" : "—";
}

function decisionTag(box) {
  if (!box) return "DECISION";
  const match = box.match(/box\s*\d+/i);
  return (match ? match[0] : box).toUpperCase();
}

export default async (req, context) => {
  const url = new URL(req.url);
  const match = url.pathname.match(/^\/command-center\/view\/([^/]+)\/?$/);
  const token = match ? match[1] : null;

  const supabase = getSupabase();
  const client = await resolveClientFromToken(token, supabase);
  if (!client) {
    return new Response("Not Found", { status: 404 });
  }

  let template = readFileSync(TEMPLATE_PATH, "utf8");

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const year = today.getFullYear();

  const [decisions, reviewSchedule, weeklyRows, northStarDocs] = await Promise.all([
    supabase
      .from("decisions")
      .select("date, text, source, stage, box")
      .eq("client_id", client.id)
      .order("date", { ascending: false })
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return data || [];
      }),
    getReviewSchedule(supabase, client.id, todayStr),
    getWeeklyPlanRows(supabase, client.name),
    getNorthStarDocuments(url.origin, client.github_repo, year),
  ]);

  // ---- Greeting panel (always visible) ----
  const firstName = (client.name || "").split(" ")[0] || client.name || "";
  template = fill(template, "{{CLIENT_FIRST_NAME}}", escapeHtml(firstName));
  template = fill(template, "{{TODAY_DATE_LONG}}", escapeHtml(formatDateLong(today, client.timezone)));
  template = fill(template, "{{MISSION_LINE}}", escapeHtml(client.mission_line || ""));

  const daysToReview = reviewSchedule ? daysBetween(todayStr, reviewSchedule.day_1_date) : null;
  template = fill(template, "{{DAYS_TO_REVIEW}}", daysToReview === null ? "—" : String(daysToReview));
  template = fill(
    template,
    "{{QUARTER_LABEL}}",
    escapeHtml(reviewSchedule ? `${reviewSchedule.quarter} ${reviewSchedule.year}` : "No review scheduled")
  );
  template = fill(
    template,
    "{{REVIEW_DATE_SHORT}}",
    escapeHtml(reviewSchedule ? formatDateShort(reviewSchedule.day_1_date) : "—")
  );

  // ---- North Star Documents panel — existence-gated per the template's
  // own comment: included only if days_to_review <= 14, and genuinely
  // absent (not hidden) otherwise. The mockup-flag build-time banner is
  // stripped in every case — it must never reach a real client. ----
  const showNorthStarPanel = daysToReview !== null && daysToReview <= 14;
  // Lazy match up to (not including, via lookahead) the next section's
  // comment — avoids hardcoding how many nested </div>s close the panel.
  const northStarPanelMatch = template.match(
    /<div class="card" style="border-color:var\(--clay\);">[\s\S]*?(?=<!-- Weekly Plan summary)/
  );
  if (northStarPanelMatch) {
    if (!showNorthStarPanel) {
      template = template.replace(northStarPanelMatch[0], "");
    } else {
      const panel = northStarPanelMatch[0].replace(
        /<div class="mockup-flag">.*?<\/div>\n\s*/,
        ""
      );
      template = template.replace(northStarPanelMatch[0], panel);
    }
  }

  const annualExists = !!northStarDocs.annual_plan_exists;
  template = fill(
    template,
    "{{ANNUAL_PLAN_CELL_TEXT}}",
    escapeHtml(annualExists ? northStarDocs.annual_plan_filename : "Not yet created")
  );

  const quarters = northStarDocs.quarters || [];
  for (const q of ["Q1", "Q2", "Q3", "Q4"]) {
    const entry = quarters.find((row) => row.quarter === q) || {};
    template = fill(template, `{{${q}_LOOK_BACK_CELL}}`, trackerCell(entry.look_back_exists));
    template = fill(template, `{{${q}_LOOK_FORWARD_CELL}}`, trackerCell(entry.look_forward_exists));
  }

  // ---- Weekly Plan summary ----
  for (const i of [0, 1]) {
    const row = weeklyRows[i];
    template = fill(
      template,
      `{{WEEKLY_ROW_${i + 1}_DATE}}`,
      escapeHtml(row ? formatDateShort(row.session_date) : "—")
    );
    template = fill(
      template,
      `{{WEEKLY_ROW_${i + 1}_TEXT}}`,
      escapeHtml(row ? row.this_week_bronze : "No weekly plan on file yet.")
    );
  }

  // ---- Decision Log summary ----
  template = fill(template, "{{DECISION_COUNT}}", String(decisions.length));
  const latest = decisions[0];
  template = fill(template, "{{LATEST_DECISION_DATE}}", escapeHtml(latest ? formatDateShort(latest.date) : "—"));
  template = fill(
    template,
    "{{LATEST_DECISION_TEXT}}",
    escapeHtml(latest ? latest.text : "No decisions logged yet.")
  );
  template = fill(template, "{{LATEST_DECISION_TAG}}", escapeHtml(latest ? decisionTag(latest.box) : ""));

  // ---- Decision Log full-page data (view 2) ----
  const rows = decisions.map((d) => ({
    date: d.date,
    dateLabel: formatDateShort(d.date),
    source: d.source,
    stage: d.stage,
    text: d.text,
    box: d.box,
  }));
  template = fill(template, "{{DECISION_LOG_ROWS_JSON}}", escapeForScript(rows));

  // The template's own TEMPLATE banner is a build-time-only marker — it
  // must never appear in a real client's page.
  template = template.replace(
    /<div class="banner">TEMPLATE — \{\{PLACEHOLDER\}\}[\s\S]*?<\/div>\n\n\s*/,
    ""
  );

  return new Response(template, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};

export const config = {
  path: "/command-center/view/*",
};
