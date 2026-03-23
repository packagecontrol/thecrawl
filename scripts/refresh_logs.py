from __future__ import annotations

import argparse
import subprocess
from dataclasses import dataclass
from pathlib import Path

from . import enrich_logs, fetch_logs_metadata


DEFAULT_LOGS_PATH = "./logs.json"
DEFAULT_RELEASE_TAG = "crawler-status"


@dataclass
class Args:
    logs: str
    repo: str | None
    workflow_id: str | None
    workflow_file: str
    runs_output: str
    artifacts_output: str
    artifacts_max_pages: int
    since: str | None
    since_hours: int
    release_tag: str
    skip_download: bool
    pretty: bool


def main():
    args = parse_args()
    refresh_logs(args)


def parse_args() -> Args:
    parser = argparse.ArgumentParser(
        description=(
            "Refresh logs.json locally by downloading current logs (optional), "
            "fetching run/artifact metadata in batch, and enriching the file."
        )
    )
    parser.add_argument(
        "--logs",
        default=DEFAULT_LOGS_PATH,
        help=f"Path to logs.json to refresh (default: {DEFAULT_LOGS_PATH}).",
    )
    parser.add_argument(
        "--repo",
        default=None,
        help=(
            "GitHub repository in owner/name format. Defaults to GITHUB_REPOSITORY "
            "or local git origin."
        ),
    )
    parser.add_argument(
        "--workflow-id",
        default=None,
        help="Workflow ID. If omitted, resolved from --workflow-file.",
    )
    parser.add_argument(
        "--workflow-file",
        default=fetch_logs_metadata.DEFAULT_WORKFLOW_FILE,
        help=(
            "Workflow filename used when resolving workflow id "
            f"(default: {fetch_logs_metadata.DEFAULT_WORKFLOW_FILE})."
        ),
    )
    parser.add_argument(
        "--runs-output",
        default=fetch_logs_metadata.DEFAULT_RUNS_OUTPUT,
        help=(
            "Output path for workflow runs JSON "
            f"(default: {fetch_logs_metadata.DEFAULT_RUNS_OUTPUT})."
        ),
    )
    parser.add_argument(
        "--artifacts-output",
        default=fetch_logs_metadata.DEFAULT_ARTIFACTS_OUTPUT,
        help=(
            "Output path for workflow artifacts JSON "
            f"(default: {fetch_logs_metadata.DEFAULT_ARTIFACTS_OUTPUT})."
        ),
    )
    parser.add_argument(
        "--artifacts-max-pages",
        type=int,
        default=10,
        help="Maximum artifact pages to scan (default: 10).",
    )
    parser.add_argument(
        "--since",
        default=None,
        help="ISO8601 lower bound; overrides --since-hours.",
    )
    parser.add_argument(
        "--since-hours",
        type=int,
        default=24,
        help="Lower bound in hours when --since is not provided (default: 24).",
    )
    parser.add_argument(
        "--release-tag",
        default=DEFAULT_RELEASE_TAG,
        help=f"Release tag used for logs download (default: {DEFAULT_RELEASE_TAG}).",
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Do not attempt to download logs.json from release if missing.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print generated JSON files.",
    )
    ns = parser.parse_args()
    if ns.artifacts_max_pages < 1:
        raise SystemExit("refresh_logs: --artifacts-max-pages must be >= 1")

    return Args(
        logs=ns.logs,
        repo=ns.repo,
        workflow_id=ns.workflow_id,
        workflow_file=ns.workflow_file,
        runs_output=ns.runs_output,
        artifacts_output=ns.artifacts_output,
        artifacts_max_pages=ns.artifacts_max_pages,
        since=ns.since,
        since_hours=ns.since_hours,
        release_tag=ns.release_tag,
        skip_download=ns.skip_download,
        pretty=ns.pretty,
    )


def refresh_logs(args: Args):
    repo = fetch_logs_metadata.resolve_repo(args.repo)
    workflow_id = fetch_logs_metadata.resolve_workflow_id(
        args.workflow_id,
        repo,
        args.workflow_file,
    )

    logs_path = Path(args.logs)
    ensure_logs_file(logs_path, repo, args.release_tag, args.skip_download)

    fetch_args = fetch_logs_metadata.Args(
        repo=repo,
        workflow_id=workflow_id,
        runs_output=args.runs_output,
        artifacts_output=args.artifacts_output,
        artifacts_max_pages=args.artifacts_max_pages,
        since=args.since or fetch_logs_metadata.iso_utc_hours_ago(args.since_hours),
        pretty=args.pretty,
    )
    fetch_logs_metadata.fetch_logs_metadata(fetch_args)

    enrich_args = enrich_logs.Args(
        input=str(logs_path),
        output=str(logs_path),
        runs=args.runs_output,
        artifacts=args.artifacts_output,
        pretty=args.pretty,
    )
    enrich_logs.update_logs(enrich_args)

    print(f"Refreshed logs file: {logs_path}")


def ensure_logs_file(logs_path: Path, repo: str, release_tag: str, skip_download: bool):
    logs_path.parent.mkdir(parents=True, exist_ok=True)
    if logs_path.exists():
        return

    if skip_download:
        raise SystemExit(
            f"refresh_logs: logs file not found and --skip-download was set: {logs_path}"
        )

    cmd = [
        "gh",
        "release",
        "download",
        release_tag,
        "--repo",
        repo,
        "--pattern",
        "logs.json",
        "--output",
        str(logs_path),
        "--clobber",
    ]
    process = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if process.returncode != 0:
        raise SystemExit(
            "refresh_logs: failed to download logs.json from release\n"
            f"repo={repo}\n"
            f"tag={release_tag}\n"
            f"stderr={process.stderr.strip()}"
        )


if __name__ == "__main__":
    main()
