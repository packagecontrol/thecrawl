from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

DEFAULT_WORKSPACE = "workspace.json"
DEFAULT_OUTPUT = "seed.json"


def main() -> None:
    args = parse_args()
    workspace = load_workspace(args.workspace)
    seed = extract_seed(workspace)
    write_seed(args.output, seed)

    removed_count = sum(1 for entry in seed.values() if "removed" in entry)
    alive_count = len(seed) - removed_count
    print(
        f"Wrote {len(seed)} entries to {args.output} "
        f"({alive_count} alive, {removed_count} removed)."
    )


class Args(argparse.Namespace):
    workspace: str
    output: str


def parse_args() -> Args:
    parser = argparse.ArgumentParser(
        description="Extract minimal package seed data from workspace.json",
    )
    parser.add_argument(
        "--workspace",
        default=DEFAULT_WORKSPACE,
        help=f"Path to workspace.json (default: {DEFAULT_WORKSPACE})",
    )
    parser.add_argument(
        "-o",
        "--output",
        default=DEFAULT_OUTPUT,
        help=f"Output path for seed JSON (default: {DEFAULT_OUTPUT})",
    )
    return parser.parse_args(namespace=Args())


def load_workspace(path: str) -> dict[str, Any]:
    workspace_path = Path(path)
    return json.loads(workspace_path.read_text(encoding="utf-8"))


def extract_seed(workspace: dict[str, Any]) -> dict[str, dict[str, Any]]:
    seed: dict[str, dict[str, Any]] = {}

    for package in workspace["packages"].values():
        name = package["name"]
        first_seen = package["first_seen"]

        if removed := package.get("removed"):
            entry = {
                "name": name,
                "first_seen": first_seen,
                "removed": removed,
                "labels": package.get("labels", []),
            }
            if source := package.get("source"):
                entry["source"] = source
            seed[name] = entry
        else:
            seed[name] = {
                "name": name,
                "first_seen": first_seen,
            }

    return dict(sorted(seed.items(), key=lambda item: item[0].casefold()))


def write_seed(path: str, seed: dict[str, dict[str, Any]]) -> None:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(seed, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
