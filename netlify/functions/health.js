// health.js — unauthenticated liveness check.
// Contract per doc 56 §3b: reveals nothing client-specific, safe for any
// external uptime monitor to ping every few minutes with no token.

export default async (req, context) => {
  return new Response(
    JSON.stringify({ status: "ok", checked_at: new Date().toISOString() }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config = {
  path: "/health",
};
