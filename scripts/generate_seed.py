from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Literal, Mapping, NotRequired, TypedDict

from ._utils import pick

DEFAULT_WORKSPACE = "workspace.json"
DEFAULT_REGISTRY = "registry.json"
DEFAULT_OUTPUT = "seed.json"


type IsoTimestamp = str
type Url = str


class ActivePackage(TypedDict):
    name: str
    first_seen: IsoTimestamp


class TombstonedPackage(TypedDict):
    name: str
    first_seen: IsoTimestamp
    source: NotRequired[Url | None]
    removed: IsoTimestamp
    labels: NotRequired[list[str]]


SeedEntry = ActivePackage | TombstonedPackage


def main() -> None:
    args = parse_args()
    input_kind, input_path = resolve_input(args)
    input_data = load_json(input_path)

    seed = (
        extract_seed_from_workspace(input_data)
        if input_kind == "workspace"
        else extract_seed_from_registry(input_data)
    )
    write_seed(args.output, seed)

    removed_count = sum(1 for entry in seed.values() if "removed" in entry)
    alive_count = len(seed) - removed_count
    print(
        f"Wrote {len(seed)} entries to {args.output} "
        f"({alive_count} alive, {removed_count} removed)."
    )


class Args(argparse.Namespace):
    workspace: str | None
    registry: str | None
    output: str


def parse_args() -> Args:
    parser = argparse.ArgumentParser(
        description=(
            "Generate a compact seed JSON from either workspace.json or registry.json"
        ),
    )
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument(
        "--workspace",
        nargs="?",
        const=DEFAULT_WORKSPACE,
        help=(
            "Path to workspace.json. If provided without a value, defaults to "
            f"{DEFAULT_WORKSPACE}."
        ),
    )
    input_group.add_argument(
        "--registry",
        nargs="?",
        const=DEFAULT_REGISTRY,
        help=(
            "Path to registry.json. If provided without a value, defaults to "
            f"{DEFAULT_REGISTRY}."
        ),
    )
    parser.add_argument(
        "-o",
        "--output",
        default=DEFAULT_OUTPUT,
        help=f"Output path for seed JSON (default: {DEFAULT_OUTPUT})",
    )
    return parser.parse_args(namespace=Args())


def resolve_input(args: Args) -> tuple[Literal["workspace", "registry"], str]:
    if args.workspace is not None:
        return "workspace", args.workspace
    if args.registry is not None:
        return "registry", args.registry
    raise AssertionError("Either --workspace or --registry must be provided")


def load_json(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def extract_seed_from_workspace(workspace: dict[str, Any]) -> dict[str, Mapping[str, Any]]:
    seed: dict[str, Mapping[str, Any]] = {}
    for package in workspace["packages"].values():
        entry = build_seed_entry(package)
        seed[entry["name"]] = entry
    return sort_seed(seed)


def extract_seed_from_registry(registry: dict[str, Any]) -> dict[str, Mapping[str, Any]]:
    seed: dict[str, Mapping[str, Any]] = {}
    for package in registry["packages"]:
        entry = build_seed_entry(package)
        seed[entry["name"]] = entry
    return sort_seed(seed)


def build_seed_entry(package: dict[str, Any]) -> Mapping[str, Any]:
    if "removed" in package:
        return pick(("name", "first_seen", "removed", "labels", "source"), package)
    else:
        return pick(("name", "first_seen"), package)


def sort_seed(seed: dict[str, Mapping[str, Any]]) -> dict[str, Mapping[str, Any]]:
    return dict(sorted(seed.items(), key=lambda item: item[0].casefold()))


def write_seed(path: str, seed: dict[str, Mapping[str, Any]]) -> None:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(seed, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
