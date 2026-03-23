from __future__ import annotations

import argparse
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypedDict

from ._utils import write_json


@dataclass
class Args:
    input: str
    output: str
    runs: str
    artifacts: str | None
    pretty: bool


type RunId = str


class RuntimeArtifact(TypedDict):
    run_id: RunId
    id: int
    name: str
    size: int
    url: str


class ArtifactMetadata(TypedDict):
    id: int
    name: str
    size: int
    url: str


def main():
    args = parse_args()
    update_logs(args)


def parse_args() -> Args:
    parser = argparse.ArgumentParser(
        description=(
            "Enrich logs.json with workflow run metadata, artifacts metadata, "
            "and fill missing runs."
        )
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
        default="./workflow_runs.json",
        help=(
            "Path to workflow_runs.json fetched from the GitHub API "
            "(default: ./workflow_runs.json)."
        ),
    )
    parser.add_argument(
        "--artifacts",
        default="./workflow_artifacts.json",
        help=(
            "Optional path to workflow_artifacts.json fetched from the GitHub API "
            "(default: ./workflow_artifacts.json)."
        ),
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
        artifacts=ns.artifacts,
        pretty=ns.pretty,
    )


def update_logs(args: Args):
    entries = load_json(Path(args.input)) or []
    runs = load_json(Path(args.runs)) or []
    artifacts: list[RuntimeArtifact] = []
    if args.artifacts:
        artifacts = load_json(Path(args.artifacts)) or []

    if not isinstance(entries, list):
        raise SystemExit(f"enrich_logs: input must be a JSON array: {args.input}")
    if not isinstance(runs, list):
        raise SystemExit(f"enrich_logs: runs must be a JSON array: {args.runs}")
    if not isinstance(artifacts, list):
        raise SystemExit(f"enrich_logs: artifacts must be a JSON array: {args.artifacts}")

    enriched = 0
    created = 0
    artifacts_attached = 0

    runs_index = {
        run_id: {
            "conclusion": run.get("conclusion"),
            "run_started_at": run.get("run_started_at"),
        }
        for run in runs
        if (run_id := str(run.get("id", "")))
    }
    artifacts_index = build_artifacts_index(artifacts)

    seen = set()
    for entry in entries:
        run_id = entry["run_id"]
        seen.add(run_id)

        info = runs_index.get(run_id)
        if info and not entry.get("conclusion") and info.get("conclusion"):
            entry["conclusion"] = info["conclusion"]
            enriched += 1

        run_artifacts = artifacts_index.get(run_id)
        if run_artifacts and entry.get("artifacts") != run_artifacts:
            entry["artifacts"] = run_artifacts
            artifacts_attached += 1

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
        if run_artifacts := artifacts_index.get(run_id):
            new_entry["artifacts"] = run_artifacts
            artifacts_attached += 1

        entries.append(new_entry)
        created += 1

    entries.sort(key=lambda entry: entry.get("date", ""), reverse=True)
    write_json(args.output, entries, pretty=args.pretty, ensure_ascii=True)
    print(
        "Enriched entries: "
        f"{enriched}, "
        f"added missing runs: {created}, "
        f"attached artifacts on entries: {artifacts_attached}"
    )


def build_artifacts_index(artifacts: list[RuntimeArtifact]) -> dict[RunId, list[ArtifactMetadata]]:
    artifacts_by_run: defaultdict[RunId, list[ArtifactMetadata]] = defaultdict(list)

    for artifact in artifacts:
        run_id = artifact["run_id"]
        artifacts_by_run[run_id].append({
            "id": artifact["id"],
            "name": artifact["name"],
            "size": artifact["size"],
            "url": artifact["url"],
        })

    for run_artifacts in artifacts_by_run.values():
        run_artifacts.sort(key=lambda item: (item["name"].casefold(), str(item["id"])))

    return dict(artifacts_by_run)


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None


if __name__ == "__main__":
    main()
