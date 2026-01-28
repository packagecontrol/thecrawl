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
        history_days=ns.history_days,
        pretty=ns.pretty,
    )


def update_logs(args: Args):
    run_id = args.run_id or os.environ.get("GITHUB_RUN_ID")
    if not run_id:
        raise SystemExit("collect_logs: missing --run-id or GITHUB_RUN_ID")
    if args.timestamp is None:
        raise SystemExit("collect_logs: missing --timestamp")

    notes_path = Path(args.notes)
    if not notes_path.is_file():
        raise SystemExit(f"collect_logs: notes file not found: {notes_path}")

    notes_text = notes_path.read_text(encoding="utf-8")
    forced_timestamp = datetime.fromtimestamp(args.timestamp, tz=timezone.utc)

    output_path = Path(args.output).expanduser().resolve()
    output_dir = output_path.parent
    if output_dir and not output_dir.exists():
        output_dir.mkdir(parents=True, exist_ok=True)

    entries = load_logs(output_path)
    run_id_str = str(run_id)
    entries = [entry for entry in entries if entry.get("run_id") != run_id_str]

    entries.append({
        "date": forced_timestamp.isoformat(),
        "run_id": run_id_str,
        "notes": notes_text,
    })

    entries.sort(key=lambda entry: entry["date"], reverse=True)

    cutoff = retention_cutoff(args.history_days, reference=now_utc())
    kept_entries = [
        entry for entry in entries
        if datetime.fromisoformat(entry["date"]) >= cutoff
    ]

    write_json(output_path, kept_entries, pretty=args.pretty, ensure_ascii=True)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def retention_cutoff(keep_days: int, *, reference: datetime | None = None) -> datetime:
    """Compute the earliest UTC timestamp we must retain."""
    if reference is None:
        reference = now_utc()
    return reference - timedelta(days=keep_days)


def load_logs(path: Path) -> list[dict[str, Any]]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []


if __name__ == "__main__":
    main()
