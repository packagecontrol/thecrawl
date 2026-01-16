from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class Args:
    input: str
    output: str
    runs: str
    pretty: bool


def main():
    args = parse_args()
    update_logs(args)


def parse_args() -> Args:
    parser = argparse.ArgumentParser(
        description="Enrich logs.json with workflow run metadata and fill missing runs."
    )
    parser.add_argument(
        "-i",
        "--input",
        default="logs.json",
        help="Input logs file (default: logs.json).",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="logs.json",
        help="Output logs file (default: logs.json).",
    )
    parser.add_argument(
        "-r",
        "--runs",
        required=True,
        help="Path to workflow_runs.json fetched from the GitHub API.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON output (indent=2).",
    )
    ns = parser.parse_args()
    return Args(
        input=ns.input,
        output=ns.output,
        runs=ns.runs,
        pretty=ns.pretty,
    )


def update_logs(args: Args):
    entries = load_json(Path(args.input)) or []
    runs = load_json(Path(args.runs)) or []

    enriched = 0
    created = 0

    runs_index = {
        str(run.get("id")): {
            "conclusion": run.get("conclusion"),
            "run_started_at": run.get("run_started_at"),
        }
        for run in runs
        if "id" in run
    }

    seen = set()
    for entry in entries:
        run_id = str(entry.get("run_id", ""))
        if not run_id:
            continue
        seen.add(run_id)
        info = runs_index.get(run_id)
        if not info:
            continue
        if not entry.get("conclusion") and info.get("conclusion"):
            entry["conclusion"] = info["conclusion"]
            enriched += 1

    for run_id, info in runs_index.items():
        if run_id in seen:
            continue
        date = info.get("run_started_at")
        if not date:
            continue
        new_entry = {
            "date": date,
            "run_id": run_id,
        }
        if conclusion := info.get("conclusion"):
            new_entry["conclusion"] = conclusion
        entries.append(new_entry)
        created += 1

    entries.sort(key=lambda entry: entry.get("date", ""), reverse=True)
    save_json(Path(args.output), entries, pretty=args.pretty)
    print(f"Enriched entries: {enriched}, added missing runs: {created}")


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None


def save_json(path: Path, data: Any, *, pretty: bool):
    with path.open("w", encoding="utf-8") as handle:
        if pretty:
            json.dump(data, handle, indent=2, ensure_ascii=True)
        else:
            json.dump(data, handle, separators=(",", ":"), ensure_ascii=True)


if __name__ == "__main__":
    main()
