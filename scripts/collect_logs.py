from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from ._utils import write_json

DEFAULT_OUTPUT = "logs.json"
HISTORY_DAYS = 32


def main():
    args = parse_args()
    try:
        update_logs(args)
    except Exception as exc:
        print(f"collect_logs failed: {exc}", file=sys.stderr)
        raise


@dataclass
class Args:
    output: str
    notes: str
    run_id: str | None
    timestamp: float | None
    workspace: str | None
    history_days: int
    pretty: bool


def parse_args() -> Args:
    parser = argparse.ArgumentParser(
        description="Collect a rolling history of crawler release notes."
    )
    parser.add_argument(
        "-o",
        "--output",
        default=DEFAULT_OUTPUT,
        help=f"Output file path (default: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--run-id",
        default=None,
        help="GitHub run id (defaults to GITHUB_RUN_ID env).",
    )
    parser.add_argument(
        "--timestamp",
        type=float,
        default=None,
        help="Unix timestamp (seconds) when the notes were produced.",
    )
    parser.add_argument(
        "--workspace",
        default=None,
        help=(
            "Optional workspace JSON path. When provided, "
            "collect found_updates from matching package entries."
        ),
    )
    parser.add_argument(
        "--history-days",
        type=int,
        default=HISTORY_DAYS,
        help="How many full days to keep (default: 32).",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON output (indent=2).",
    )
    parser.add_argument(
        "notes",
        help="Path to the freshly generated notes.txt file.",
    )
    ns = parser.parse_args()
    return Args(
        output=ns.output,
        notes=ns.notes,
        run_id=ns.run_id,
        timestamp=ns.timestamp,
        workspace=ns.workspace,
        history_days=ns.history_days,
        pretty=ns.pretty,
    )


def update_logs(args: Args):
    run_id = args.run_id or os.environ.get("GITHUB_RUN_ID")
    if not run_id:
        raise SystemExit("collect_logs: missing --run-id or GITHUB_RUN_ID")

    notes_path = Path(args.notes)
    if not notes_path.is_file():
        raise SystemExit(f"collect_logs: notes file not found: {notes_path}")

    notes_text = notes_path.read_text(encoding="utf-8")
    timestamp = args.timestamp
    if timestamp is None:
        now_ts = os.environ.get("NOW_TS")
        if now_ts is None:
            raise SystemExit("collect_logs: missing --timestamp")
        timestamp = float(now_ts.strip())

    runtime_ts = datetime.fromtimestamp(timestamp, tz=timezone.utc)
    run_timestamp_iso = runtime_ts.strftime("%Y-%m-%dT%H:%M:%SZ")

    output_path = Path(args.output).expanduser().resolve()
    output_dir = output_path.parent
    if output_dir and not output_dir.exists():
        output_dir.mkdir(parents=True, exist_ok=True)

    entries: list[dict[str, Any]] = load_json(output_path)
    run_id_str = str(run_id)
    entries = [entry for entry in entries if entry.get("run_id") != run_id_str]

    entry: dict[str, Any] = {
        "date": runtime_ts.isoformat(),
        "run_id": run_id_str,
        "notes": notes_text,
    }
    if args.workspace:
        entry["found_updates"] = derive_found_updates(args.workspace, run_timestamp_iso)
    entries.append(entry)

    entries.sort(key=lambda entry: entry["date"], reverse=True)

    cutoff = now_utc() - timedelta(days=args.history_days)
    kept_entries = [
        entry for entry in entries
        if datetime.fromisoformat(entry["date"]) >= cutoff
    ]

    write_json(output_path, kept_entries, pretty=args.pretty, ensure_ascii=True)


def derive_found_updates(workspace_path: str, run_timestamp_iso: str) -> list[dict[str, Any]]:
    packages = load_workspace_packages(workspace_path)
    found_updates = []
    for entry in packages.values():
        detected_at = entry.get("update_detected")
        if detected_at == run_timestamp_iso:
            found_updates.append({
                "name": entry["name"],
                "detected_at": detected_at,
                "published_at": entry.get("last_modified"),
            })

    found_updates.sort(key=lambda item: item["name"].casefold())
    return found_updates


def load_workspace_packages(path: str) -> dict[str, dict]:
    workspace_path = Path(path)
    if not workspace_path.is_file():
        raise SystemExit(f"collect_logs: workspace file not found: {workspace_path}")

    workspace = load_json(workspace_path)
    if not isinstance(workspace, dict):
        raise SystemExit(f"collect_logs: workspace must be a JSON object: {workspace_path}")

    packages: dict[str, dict] = workspace.get("packages", {})
    if not isinstance(packages, dict):
        raise SystemExit(f"collect_logs: workspace packages must be an object: {workspace_path}")

    return packages


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []


if __name__ == "__main__":
    main()
