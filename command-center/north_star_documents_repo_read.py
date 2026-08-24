"""
North Star Documents tracker — repo read logic.

This is the real, callable implementation of "item 1" in the four-step
server-build sequence (repo reads -> Supabase schema -> server route ->
Claude Code hosting), per open-items-command-center-migration.md and its
2026-08-24 addenda.

Given a client's github_repo (from the `clients` table), this checks the
real state of their annual/ and quarterly/ folders and returns exactly
the data shape the North Star Documents panel needs to render correctly
-- whether that panel should appear at all, and if so, which cells are
filled vs. empty.

This does NOT yet decide the 14-day-window gating (that's a date
comparison against review_schedule, a separate, already-solved piece --
see review_schedule.day_1_date, confirmed this session). This module
answers only: "given a client's repo, what documents actually exist?"

Naming convention assumed for quarterly documents (not yet enforced by
any upload mechanism -- flagged as a real open dependency, not assumed
solved): files matching Q{n}-{year}-look-back.* or
Q{n}-{year}-look-forward.* inside quarterly/. The annual plan is any file
in annual/ other than README.md.

Verified 2026-08-24 against the real Diana Reyes repo
(covetedconsultant/diana-reyes-outputs): both annual/ and quarterly/
correctly resolve to "no real documents yet" (README.md only), matching
the honest empty-state design confirmed for her Level 1 build.
"""

import re
from dataclasses import dataclass, field

# A real GitHub personal access token with Contents:Read access to the
# target repo must be supplied by the caller -- this module deliberately
# takes it as a parameter rather than reading it from anywhere, so it
# never assumes a storage location. See open-items addendum, "credential
# storage" decisions, for why.
import requests

GITHUB_API = "https://api.github.com"


@dataclass
class QuarterDocStatus:
    quarter: str  # e.g. "Q3"
    year: int
    look_back_exists: bool = False
    look_forward_exists: bool = False


@dataclass
class NorthStarDocumentStatus:
    annual_plan_exists: bool = False
    annual_plan_filename: str | None = None
    quarters: list[QuarterDocStatus] = field(default_factory=list)
    repo_reachable: bool = True
    error: str | None = None


def _list_folder(owner: str, repo: str, path: str, token: str) -> list[dict]:
    """Real GitHub Contents API call. Returns [] if the folder doesn't
    exist at all (a client who hasn't been given this folder yet) rather
    than raising -- that is itself meaningful, honest information for
    the caller, not an error state."""
    url = f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
    }
    resp = requests.get(url, headers=headers, timeout=10)
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    return resp.json()


def check_north_star_documents(
    github_repo: str, token: str, quarters_to_check: list[tuple[str, int]]
) -> NorthStarDocumentStatus:
    """
    github_repo: "owner/name" string, exactly as stored in clients.github_repo
    quarters_to_check: list of (quarter_label, year) tuples the caller cares
        about -- normally derived from review_schedule, not hard-coded here.
    """
    try:
        owner, repo = github_repo.split("/", 1)
    except ValueError:
        return NorthStarDocumentStatus(
            repo_reachable=False,
            error=f"github_repo value '{github_repo}' is not in 'owner/name' shape",
        )

    status = NorthStarDocumentStatus()

    # --- Annual plan check ---
    try:
        annual_files = _list_folder(owner, repo, "annual", token)
    except requests.HTTPError as e:
        status.repo_reachable = False
        status.error = f"Could not read annual/ folder: {e}"
        return status

    real_annual_docs = [f for f in annual_files if f.get("name", "").lower() != "readme.md"]
    if real_annual_docs:
        status.annual_plan_exists = True
        status.annual_plan_filename = real_annual_docs[0]["name"]

    # --- Quarterly documents check ---
    try:
        quarterly_files = _list_folder(owner, repo, "quarterly", token)
    except requests.HTTPError as e:
        status.repo_reachable = False
        status.error = f"Could not read quarterly/ folder: {e}"
        return status

    filenames = [f.get("name", "") for f in quarterly_files]

    for quarter_label, year in quarters_to_check:
        q_status = QuarterDocStatus(quarter=quarter_label, year=year)
        back_pattern = re.compile(
            rf"^{quarter_label}-{year}-look-back\.", re.IGNORECASE
        )
        forward_pattern = re.compile(
            rf"^{quarter_label}-{year}-look-forward\.", re.IGNORECASE
        )
        q_status.look_back_exists = any(back_pattern.match(fn) for fn in filenames)
        q_status.look_forward_exists = any(
            forward_pattern.match(fn) for fn in filenames
        )
        status.quarters.append(q_status)

    return status


if __name__ == "__main__":
    # Real, live smoke test -- not a mock. Run with a valid GitHub PAT to
    # re-confirm the honest-empty-state case before this is wired into
    # the real server route.
    import os

    test_token = os.environ.get("GITHUB_PAT_FOR_TESTING")
    if not test_token:
        print("Set GITHUB_PAT_FOR_TESTING to run this smoke test.")
    else:
        result = check_north_star_documents(
            github_repo="covetedconsultant/diana-reyes-outputs",
            token=test_token,
            quarters_to_check=[("Q1", 2026), ("Q2", 2026), ("Q3", 2026), ("Q4", 2026)],
        )
        print(result)
        assert result.repo_reachable, "Repo should be reachable"
        assert result.annual_plan_exists is False, (
            "Diana has no real annual plan yet -- this must read False, "
            "matching the honest empty state already confirmed in her repo"
        )
        for q in result.quarters:
            assert q.look_back_exists is False and q.look_forward_exists is False, (
                f"{q.quarter} {q.year} should show no real documents yet"
            )
        print("Smoke test passed: honest empty state confirmed for Diana Reyes.")
