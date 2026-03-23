from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator

from ._utils import write_json


DEFAULT_RUNS_OUTPUT = "./workflow_runs.json"
DEFAULT_ARTIFACTS_OUTPUT = "./workflow_artifacts.json"
DEFAULT_WORKFLOW_FILE = "crawl.yml"


@dataclass
class Args:
    repo: str
    workflow_id: str
    runs_output: str
    artifacts_output: str
    since: str
    artifacts_max_pages: int
    pretty: bool


def main():
    args = parse_args()
    fetch_logs_metadata(args)


def parse_args() -> Args:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch workflow runs and artifacts metadata via gh api for logs enrichment."
        )
    )
    parser.add_argument(
        "--repo",
        default=None,
        help=(
            "GitHub repository in owner/name format. Defaults to GITHUB_REPOSITORY "
            "or the local git origin remote."
        ),
    )
    parser.add_argument(
        "--workflow-id",
        default=None,
        help=(
            "Workflow ID to query runs for. Defaults to WORKFLOW_ID. "
            "If missing, it is resolved from --workflow-file."
        ),
    )
    parser.add_argument(
        "--workflow-file",
        default=DEFAULT_WORKFLOW_FILE,
        help=(
            "Workflow filename used to resolve --workflow-id when it is not set "
            f"(default: {DEFAULT_WORKFLOW_FILE})."
        ),
    )
    parser.add_argument(
        "--since",
        default=None,
        help=(
            "ISO8601 timestamp for the lower bound of runs to fetch, for example "
            "2026-03-23T00:00:00Z."
        ),
    )
    parser.add_argument(
        "--since-hours",
        type=int,
        default=24,
        help="Fetch runs started within the last N hours when --since is not set (default: 24).",
    )
    parser.add_argument(
        "--runs-output",
        default=DEFAULT_RUNS_OUTPUT,
        help=f"Output path for workflow runs JSON (default: {DEFAULT_RUNS_OUTPUT}).",
    )
    parser.add_argument(
        "--artifacts-output",
        default=DEFAULT_ARTIFACTS_OUTPUT,
        help=(
            "Output path for workflow artifacts JSON "
            f"(default: {DEFAULT_ARTIFACTS_OUTPUT})."
        ),
    )
    parser.add_argument(
        "--artifacts-max-pages",
        type=int,
        default=10,
        help=(
            "Maximum number of repository artifacts pages to scan "
            "(default: 10)."
        ),
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON output (indent=2).",
    )
    ns = parser.parse_args()

    if ns.artifacts_max_pages < 1:
        raise SystemExit("fetch_logs_metadata: --artifacts-max-pages must be >= 1")

    repo = resolve_repo(ns.repo)
    workflow_id = resolve_workflow_id(ns.workflow_id, repo, ns.workflow_file)
    since = ns.since or iso_utc_hours_ago(ns.since_hours)

    return Args(
        repo=repo,
        workflow_id=workflow_id,
        runs_output=ns.runs_output,
        artifacts_output=ns.artifacts_output,
        since=since,
        artifacts_max_pages=ns.artifacts_max_pages,
        pretty=ns.pretty,
    )


def fetch_logs_metadata(args: Args):
    runs = fetch_runs(args.repo, args.workflow_id, args.since)
    run_ids = {
        str(run.get("id"))
        for run in runs
        if isinstance(run, dict) and run.get("id") is not None
    }

    artifacts = fetch_artifacts(
        args.repo,
        run_ids,
        max_pages=args.artifacts_max_pages,
    )
    write_json(args.runs_output, runs, pretty=args.pretty, ensure_ascii=True)
    write_json(args.artifacts_output, artifacts, pretty=args.pretty, ensure_ascii=True)

    print(
        "Fetched metadata: "
        f"repo={args.repo}, "
        f"workflow_id={args.workflow_id}, "
        f"runs={len(runs)}, "
        f"artifacts_kept={len(artifacts)}, "
        f"since={args.since}"
    )


def fetch_runs(repo: str, workflow_id: str, since: str) -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = []

    for run in run_gh_paginated(
        "workflow_runs",
        [
            f"repos/{repo}/actions/workflows/{workflow_id}/runs",
            "--method",
            "GET",
            "-f",
            "status=completed",
            "-f",
            f"created=>={since}",
        ],
        max_pages=None,
    ):
        if not isinstance(run, dict):
            continue
        run_id = run.get("id")
        if run_id is None:
            continue

        runs.append({
            "id": run_id,
            "conclusion": run.get("conclusion"),
            "run_started_at": run.get("run_started_at"),
        })

    return runs


def fetch_artifacts(
    repo: str,
    run_ids: set[str],
    *,
    max_pages: int,
) -> list[dict[str, Any]]:
    if not run_ids:
        return []

    remaining_run_ids = set(run_ids)
    artifacts: list[dict[str, Any]] = []

    for artifact in run_gh_paginated(
        "artifacts",
        [
            f"repos/{repo}/actions/artifacts",
            "--method",
            "GET",
        ],
        max_pages=max_pages,
    ):
        if not isinstance(artifact, dict):
            continue

        workflow_run = artifact.get("workflow_run")
        workflow_run_id = None
        if isinstance(workflow_run, dict):
            workflow_run_id = workflow_run.get("id")

        if workflow_run_id is None:
            continue

        run_id = str(workflow_run_id)
        if run_id in run_ids:
            # Mark run_id as seen immediately. Otherwise malformed artifacts could prevent
            # remaining_run_ids from emptying and keep pagination running unnecessarily.
            remaining_run_ids.discard(run_id)

            artifact_id = artifact.get("id")
            artifact_name = artifact.get("name")
            artifact_size = artifact.get("size_in_bytes")
            if artifact_id is None or artifact_name is None or artifact_size is None:
                continue

            artifacts.append({
                "run_id": run_id,
                "id": artifact_id,
                "name": str(artifact_name),
                "size": int(artifact_size),
                "url": f"https://github.com/{repo}/actions/runs/{run_id}/artifacts/{artifact_id}",
            })
            # We only know whether we're done when we see the *next* item. Keep scanning
            # because multiple artifacts for an interesting run_id can appear consecutively.
            continue

        if not remaining_run_ids:
            # Assumes API items are ordered: once all interesting run_ids were seen and we
            # hit a non-interesting run_id, there are no more relevant artifacts to collect.
            break

    artifacts.sort(key=lambda item: (item["run_id"], item["name"].casefold(), str(item["id"])))
    return artifacts


def resolve_repo(repo: str | None) -> str:
    if repo:
        return repo

    if env_repo := os.environ.get("GITHUB_REPOSITORY"):
        return env_repo

    if origin_url := read_git_origin_url():
        if parsed_repo := parse_repo_from_remote(origin_url):
            return parsed_repo

    raise SystemExit(
        "fetch_logs_metadata: unable to resolve repo. "
        "Set --repo, GITHUB_REPOSITORY, or configure git origin."
    )


def resolve_workflow_id(workflow_id: str | None, repo: str, workflow_file: str) -> str:
    if workflow_id:
        return str(workflow_id)

    if env_workflow_id := os.environ.get("WORKFLOW_ID"):
        return env_workflow_id

    resolved = run_gh_json([
        f"repos/{repo}/actions/workflows/{workflow_file}",
        "--method",
        "GET",
        "--jq",
        ".id",
    ])
    if resolved is None:
        raise SystemExit(
            "fetch_logs_metadata: failed to resolve workflow id "
            f"for {repo}/{workflow_file}"
        )

    return str(resolved)


def iso_utc_hours_ago(hours: int) -> str:
    timestamp = datetime.now(timezone.utc) - timedelta(hours=hours)
    return timestamp.strftime("%Y-%m-%dT%H:%M:%SZ")


def read_git_origin_url() -> str | None:
    process = subprocess.run(
        ["git", "config", "--get", "remote.origin.url"],
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode != 0:
        return None

    origin = process.stdout.strip()
    return origin or None


def parse_repo_from_remote(remote_url: str) -> str | None:
    # https://github.com/owner/repo(.git)
    if match := re.search(r"github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?$", remote_url):
        owner, repo = match.group(1), match.group(2)
        return f"{owner}/{repo}"
    return None


def run_gh_paginated(
    key: str,
    cmd: list[str],
    *,
    max_pages: int | None,
    per_page: int = 100,
) -> Iterator[Any]:
    page = 1
    while max_pages is None or page <= max_pages:
        payload = run_gh_json([
            *cmd,
            "-f",
            f"per_page={per_page}",
            "-f",
            f"page={page}",
        ])
        if not isinstance(payload, dict):
            return

        page_items = payload.get(key)
        if not isinstance(page_items, list) or not page_items:
            return

        yield from page_items

        if len(page_items) < per_page:
            return

        page += 1


def run_gh_json(args: list[str]) -> Any:
    cmd = ["gh", "api", *args]
    command_str = " ".join(cmd)
    print(f"fetch_logs_metadata: {command_str}", file=sys.stderr)

    process = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if process.returncode != 0:
        stderr = process.stderr.strip()
        raise SystemExit(
            "fetch_logs_metadata: gh command failed\n"
            f"command: {command_str}\n"
            f"stderr: {stderr}"
        )

    output = process.stdout.strip()
    if not output:
        return []

    try:
        return json.loads(output)
    except json.JSONDecodeError as exc:
        excerpt = output[:260]
        raise SystemExit(
            "fetch_logs_metadata: invalid JSON from gh command\n"
            f"command: {command_str}\n"
            f"error: {exc}\n"
            f"context: {excerpt}"
        ) from exc


if __name__ == "__main__":
    main()
