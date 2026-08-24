// north-star-documents.js — reads a client's GitHub repo (annual/,
// quarterly/ folders) and reports which North Star documents actually
// exist. This is item 1 of the four-step server-build sequence
// (repo reads -> Supabase schema -> server route -> Claude Code hosting)
// per open-items-command-center-migration.md and its 2026-08-24 addenda.
//
// CORRECTION (2026-08-24): an earlier version of this logic was written
// in Python and committed to this repo at command-center/
// north_star_documents_repo_read.py. That file cannot run — this whole
// server is a Node.js/Netlify Functions runtime (see package.json,
// netlify.toml, health.js/mcp.js). The Python file was a real defect,
// not a style choice, caught while reading REF-cos-mcp-server-architecture
// and this repo's actual contents before writing this route. That file
// should be deleted once this one is confirmed working.
//
// Naming convention assumed for quarterly documents (NOT yet enforced by
// any upload mechanism — see open-items ADDENDUM3, item 8, a real,
// still-open dependency): files matching
// Q{n}-{year}-look-back.* / Q{n}-{year}-look-forward.* inside a client's
// quarterly/ repo folder. The annual plan is any file in annual/ other
// than README.md.
//
// This function does NOT decide the 14-day-review-window gating (that's
// a date comparison against review_schedule.day_1_date, already solved
// and confirmed working elsewhere in this system). It answers only:
// "given this client's repo, what documents actually exist right now?"

const GITHUB_API = "https://api.github.com";

async function listFolder(owner, repo, path, token) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (resp.status === 404) return []; // folder doesn't exist yet — honest, not an error
  if (!resp.ok) {
    throw new Error(`GitHub API error ${resp.status} reading ${path}`);
  }
  return resp.json();
}

function checkQuarter(filenames, quarterLabel, year) {
  const backPattern = new RegExp(`^${quarterLabel}-${year}-look-back\\.`, "i");
  const forwardPattern = new RegExp(`^${quarterLabel}-${year}-look-forward\\.`, "i");
  return {
    quarter: quarterLabel,
    year,
    look_back_exists: filenames.some((f) => backPattern.test(f)),
    look_forward_exists: filenames.some((f) => forwardPattern.test(f)),
  };
}

export default async (req, context) => {
  const url = new URL(req.url);
  const githubRepo = url.searchParams.get("github_repo");
  const yearParam = url.searchParams.get("year");

  if (!githubRepo || !githubRepo.includes("/")) {
    return new Response(
      JSON.stringify({
        error: "Missing or malformed github_repo query param — expected 'owner/name'",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
  const [owner, repo] = githubRepo.split("/");

  // The GitHub token this function uses is read from Netlify's own
  // environment variables at deploy time — never committed to this repo,
  // never passed in the request. This matches the credential-handling
  // discipline confirmed in open-items-command-center-migration.md
  // (plain values are fine when scoped and access-controlled; they are
  // never embedded in code or logs).
  const token = Netlify.env.get("GITHUB_TOKEN");
  if (!token) {
    return new Response(
      JSON.stringify({ error: "Server misconfiguration — GITHUB_TOKEN not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const annualFiles = await listFolder(owner, repo, "annual", token);
    const realAnnualDocs = annualFiles.filter(
      (f) => f.name.toLowerCase() !== "readme.md"
    );

    const quarterlyFiles = await listFolder(owner, repo, "quarterly", token);
    const filenames = quarterlyFiles.map((f) => f.name);

    const quarters = ["Q1", "Q2", "Q3", "Q4"].map((q) =>
      checkQuarter(filenames, q, year)
    );

    return new Response(
      JSON.stringify({
        repo_reachable: true,
        annual_plan_exists: realAnnualDocs.length > 0,
        annual_plan_filename: realAnnualDocs[0]?.name ?? null,
        quarters,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ repo_reachable: false, error: err.message }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config = {
  path: "/command-center/north-star-documents",
};
