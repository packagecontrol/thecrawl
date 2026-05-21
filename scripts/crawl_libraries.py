from __future__ import annotations

import argparse
import asyncio
import json
import os
from collections import defaultdict, namedtuple
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import partial
from itertools import product
from pathlib import Path
from typing import Literal, Required, TypedDict
from urllib.parse import unquote, urlsplit

import aiohttp
from packaging.version import InvalidVersion, Version
from rich.console import Console
from rich.progress import track

from ._doctor_lib import format_library_doctor
from ._resolve_lib import (
    Release,
    ReleaseEntry,
    compile_asset_patterns,
    explain_library,
    load_json,
    normalize_release_def,
    resolve_library,
    spell_out_constraint_variations,
)
from ._utils import err, format_name_list, write_json
from ._explain_package import print_library_explain


DEFAULT_REGISTRY = "./registry.json"
DEFAULT_WORKSPACE = "./workspace.json"


type Url = str
type Name = str
type IsoTimestamp = str
type VersionString = str


class Registry(TypedDict, total=False):
    repositories: list[Url]
    packages: list[RegistryEntry]
    libraries: list[RegistryEntry]


class Workspace(TypedDict, total=False):
    packages: dict[Name, WorkspaceEntry]
    libraries: dict[Name, WorkspaceEntry]


class _Entry(TypedDict, total=False):

    author: str
    description: str
    homepage: Url
    issues: Url
    ...

    source: Url
    schema_version: str


class RegistryEntry(_Entry, total=False):
    name: Required[str]
    releases: Required[list[ReleaseEntry]]


class WorkspaceEntry(_Entry, total=False):
    name: Required[str]
    # releases: Required[list[Release]]

    added: IsoTimestamp
    removed: IsoTimestamp
    last_crawl: IsoTimestamp

    failing_since: IsoTimestamp
    fail_reason: str

    latest_version: VersionString
    last_update: str
    last_update_at: IsoTimestamp


@dataclass
class Args:
    registry: Path
    allowed_sources: set[str]
    name: str | None
    explain: str | None
    write: bool
    verbose: bool
    limit: int
    workspace: Path
    cache_dir: Path


@dataclass(frozen=True)
class UnmatchedReleaseDefinition:
    raw: ReleaseEntry
    missing: list[ExpectedReleaseMatch]


@dataclass(frozen=True)
class ExpectedReleaseMatch:
    sublime_text: str
    platform: str | None
    python_version: str | None


def parse_args() -> Args:
    parser = argparse.ArgumentParser(
        description="Resolve a single library (PyPI or GitHub) from registry.json."
    )
    parser.add_argument(
        "--registry",
        "-r",
        default=DEFAULT_REGISTRY,
        help=f"Path to registry to crawl (default: {DEFAULT_REGISTRY})",
    )
    parser.add_argument(
        "--allowed-source",
        action="append",
        default=[],
        metavar="URL",
        help="Allow only libraries with a source matching this URL (repeatable).",
    )
    parser.add_argument("--name", help="Library name from registry to crawl")
    parser.add_argument(
        "--explain",
        help="Library name to print resolved release definitions for",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write the resolved library entry to the workspace when using --name.",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Print raw resolved JSON when using --name.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Number of libraries to crawl when --name/--explain is omitted (default: 10)",
    )
    parser.add_argument(
        "--workspace",
        "-o",
        default=DEFAULT_WORKSPACE,
        help=f"Path to workspace JSON (default: {DEFAULT_WORKSPACE})",
    )
    parser.add_argument(
        "--cache-dir",
        default=".pypi-cache",
        help="PyPI cache directory (default: .pypi-cache)",
    )
    ns = parser.parse_args()

    if ns.explain and ns.name:
        parser.error("Use either --name or --explain, not both.")
    if ns.write and not ns.name:
        parser.error("--write requires --name.")
    if ns.limit < 1:
        parser.error("--limit must be a positive integer.")

    registry_path = Path(os.path.abspath(ns.registry))
    if not registry_path.exists():
        parser.error(f"{registry_path} not found.")

    return Args(
        registry=registry_path,
        allowed_sources=set(ns.allowed_source),
        name=ns.name,
        explain=ns.explain,
        write=ns.write,
        verbose=ns.verbose or ns.write,
        limit=ns.limit,
        workspace=Path(os.path.abspath(ns.workspace)),
        cache_dir=Path(os.path.abspath(ns.cache_dir)),
    )


def main() -> None:
    raise SystemExit(asyncio.run(run(parse_args())))


def is_allowed_source(library: RegistryEntry, allowed_sources: set[str]) -> bool:
    if not allowed_sources:
        return True
    source = library.get("source")
    return bool(source) and source in allowed_sources


async def run(args: Args) -> int:
    if args.name:
        return await handle_name(args.name, args)

    if args.explain:
        return await handle_explain(args.explain, args)

    registry: Registry = load_json(args.registry)  # type: ignore[assignment]

    timestamp = now_timestamp()
    added_names: list[str] = []
    updated_names: list[str] = []

    workspace: Workspace = load_workspace(args.workspace)
    workspace_entries = workspace["libraries"]
    registered_entries = {
        lib["name"]: lib
        for lib in registry["libraries"]
    }

    ignored_by_source: dict[str, int] = defaultdict(int)
    if args.allowed_sources:
        for library in registry.get("libraries", []):
            if is_allowed_source(library, args.allowed_sources):
                continue
            source = library.get("source", "")
            ignored_by_source[source] += 1
        for source, count in sorted(ignored_by_source.items()):
            if source:
                print(f"Ignoring {count} libraries from {source}")
            else:
                print(f"Ignoring {count} libraries without a source.")

    removed = set(workspace_entries) - set(registered_entries)
    for name in removed:
        if entry := workspace_entries.get(name):
            mark_removed(entry, timestamp)

    for name, lib in registered_entries.items():
        if is_allowed_source(lib, args.allowed_sources):
            if entry := workspace_entries.get(name):
                mark_added(entry, timestamp)

    lib_info = namedtuple("lib_info", "last_crawl lname name entry")
    active_libs = (
        lib_info(
            (
                workspace_entries  # type: ignore[call-overload]
                .get(name, {})
                .get("last_crawl", "0000-00-00T00:00:00Z")
            ),
            name.lower(),
            name,
            entry
        )
        for name, entry in registered_entries.items()
        if is_allowed_source(entry, args.allowed_sources)
        if not workspace_entries.get(name, {}).get("removed")  # type: ignore[call-overload]
    )

    selected_libs = sorted(active_libs)[:args.limit]
    if not selected_libs:
        print("Nothing to crawl.")
        return 0

    console = Console(stderr=True)
    disable_progress = not console.is_terminal or os.environ.get("CI") == "true"
    track_ = partial(
        track,
        description="Crawling Libraries",
        console=console,
        disable=disable_progress
    )

    async with aiohttp.ClientSession() as aio_session:
        ordered_libs = sorted(selected_libs, key=lambda lib: lib.lname)
        tasks = {
            lib.name: asyncio.create_task(
                resolve_library(lib.entry, args.cache_dir, aio_session)
            )
            for lib in ordered_libs
        }
        for name, task in track_(tasks.items()):
            try:
                result = await task
            except Exception as exc:
                entry = workspace_entries.get(name, {"name": name}).copy()
                mark_added(entry, timestamp)
                mark_failure(entry, timestamp, str(exc))
                workspace_entries[name] = entry
                print(f"Failed {name}: {exc}")
                continue

            info, sources = result
            entry = workspace_entries.get(name, {"name": name}).copy()
            entry.update(info)
            mark_added(entry, timestamp)
            latest_version = latest_version_from_releases(info["releases"])
            status = mark_success(entry, timestamp, latest_version)
            if status == "added":
                added_names.append(name)
            elif status == "updated":
                updated_names.append(name)
            workspace_entries[name] = entry
            source_label = ", ".join(sources) if sources else "cache"
            version_label = f" {latest_version}" if latest_version else ""
            err(f"Resolved {name}{version_label} using {source_label}.")

    write_json(args.workspace, workspace, pretty=True, ensure_ascii=True)
    print(f"Crawled {len(selected_libs)} libraries.")
    print(format_change_message(added_names, updated_names))
    return 0


async def handle_name(name: str, args: Args) -> int:
    registry: Registry = load_json(args.registry)  # type: ignore[assignment]

    library = find_library(registry, name)
    if not library:
        print(f'Library "{name}" not found in {args.registry.name}.')
        return 1

    if not is_allowed_source(library, args.allowed_sources):
        print("Library is not on an allowed source.")
        return 0

    timestamp = now_timestamp()
    added_names: list[str] = []
    updated_names: list[str] = []

    workspace: Workspace = load_workspace(args.workspace)
    workspace_entries = workspace["libraries"]

    try:
        async with aiohttp.ClientSession() as aio_session:
            info, sources = await resolve_library(
                library, args.cache_dir, aio_session
            )

        unmatched = unmatched_release_definitions(library, info["releases"])
        entry: WorkspaceEntry = \
            workspace_entries.get(name, {"name": name}).copy()
        entry.update(info)
        mark_added(entry, timestamp)
        latest_version = latest_version_from_releases(info["releases"])
        status = mark_success(entry, timestamp, latest_version)
        if status == "added":
            added_names.append(name)
        elif status == "updated":
            updated_names.append(name)
        if args.write:
            workspace_entries[name] = entry
            write_json(args.workspace, workspace, pretty=True, ensure_ascii=True)

        if args.verbose:
            source_label = ", ".join(sources) if sources else "cache"
            version_label = f" {latest_version}" if latest_version else ""
            print(json.dumps(entry, indent=2, ensure_ascii=False))
            print_unmatched_release_definitions(unmatched)
            print(f"Resolved {args.name}{version_label} using {source_label}.")
        else:
            print(
                format_library_doctor(
                    name=args.name or name,
                    latest_version=latest_version,
                    sources=sources,
                    releases=info["releases"],
                    missing_coordinates=missing_matrix_coordinates(unmatched),
                    has_unmatched_definitions=bool(unmatched),
                )
            )
        if args.write:
            print(format_change_message(added_names, updated_names))
        return 0
    except Exception as exc:
        if args.write:
            entry = \
                workspace_entries.get(name, {"name": args.name}).copy()  # type: ignore[assignment]
            mark_added(entry, timestamp)
            mark_failure(entry, timestamp, str(exc))
            workspace_entries[name] = entry
            write_json(args.workspace, workspace, pretty=True, ensure_ascii=True)
        raise


async def handle_explain(name: str, args: Args) -> int:
    registry: Registry = load_json(args.registry)  # type: ignore[assignment]
    library = find_library(registry, name)
    if not library:
        print(f'Library "{name}" not found in {args.registry.name}.')
        return 1

    explain_rows = explain_library(library)
    metadata = {key: value for key, value in library.items() if key != "releases"}
    print_library_explain(name, explain_rows, metadata=metadata)
    return 0


def parse_last_crawl(value: str | None) -> datetime:
    if not value:
        return datetime.min
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return datetime.min


def latest_version_from_releases(releases: list[Release]) -> str | None:
    if not releases:
        return None
    newest = sorted(releases, key=lambda rel: rel.get("date") or "")[-1]
    version = newest.get("version")
    return version if isinstance(version, str) else None


def now_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_workspace(path: Path) -> Workspace:
    if not path.exists():
        return {"libraries": {}}
    data: Workspace = load_json(path)  # type: ignore[assignment]
    if not isinstance(data, dict):
        raise ValueError(f"{path.name} must be a JSON object.")
    if "libraries" not in data:
        data["libraries"] = {}
    if not isinstance(data["libraries"], dict):
        raise ValueError(f"{path.name} libraries must be an object.")
    return data


def mark_added(entry: WorkspaceEntry, timestamp: IsoTimestamp) -> None:
    entry.pop("removed", None)
    entry.setdefault("added", timestamp)


def mark_success(
    entry: WorkspaceEntry,
    timestamp: IsoTimestamp,
    latest_version: VersionString | None
) -> Literal["added", "updated"] | None:
    entry["last_crawl"] = timestamp
    entry.pop("failing_since", None)
    entry.pop("fail_reason", None)
    entry.pop("removed", None)
    previous_version = entry.get("latest_version")
    if latest_version:
        entry["latest_version"] = latest_version

    if updated := bool(
        previous_version
        and latest_version
        and previous_version != latest_version
    ):
        entry["last_update"] = f"{previous_version} -> {latest_version}"
        entry["last_update_at"] = timestamp

    if not previous_version:
        return "added"
    if updated:
        return "updated"
    return None


def mark_removed(entry: WorkspaceEntry, timestamp: IsoTimestamp) -> None:
    entry["removed"] = timestamp


def mark_failure(entry: WorkspaceEntry, timestamp: IsoTimestamp, reason: str) -> None:
    entry["last_crawl"] = timestamp
    entry.setdefault("failing_since", timestamp)
    entry["fail_reason"] = reason


def find_library(registry: Registry, name: str) -> RegistryEntry | None:
    for library in registry.get("libraries", []):
        if library.get("name") == name:
            return library
    return None


def unmatched_release_definitions(
    library: RegistryEntry,
    releases: list[Release],
) -> list[UnmatchedReleaseDefinition]:
    output = []
    for raw_release in library.get("releases", []):
        missing = unmatched_expected_matches(raw_release, releases)
        if missing:
            output.append(UnmatchedReleaseDefinition(raw_release, missing))
    return output


def unmatched_expected_matches(
    raw_release: ReleaseEntry,
    releases: list[Release],
) -> list[ExpectedReleaseMatch]:
    normalized = normalize_release_def(deepcopy(raw_release))
    if "url" in normalized:
        return []

    concrete_defs = spell_out_constraint_variations(
        normalized,
        auto_assets="pypi.org/project/" in normalized["base"],
    )
    expected_matches = (
        ExpectedReleaseMatch(sublime_text, platform, python_version)
        for sublime_text, platform, python_version in product(
            normalized["sublime_text"],
            expected_dimension_values(raw_release, normalized, "platforms"),
            expected_dimension_values(raw_release, normalized, "python_versions"),
        )
    )
    return [
        expected
        for expected in expected_matches
        if not any(
            release_matches_expected(release, concrete, expected)
            for concrete in matching_concrete_defs(concrete_defs, expected)
            for release in releases
        )
    ]


def expected_dimension_values(
    raw_release: ReleaseEntry,
    normalized: dict,
    key: str,
) -> list[str | None]:
    if is_auto_dimension(raw_release, key):
        return [None]
    return normalized[key]


def is_auto_dimension(raw_release: ReleaseEntry, key: str) -> bool:
    if key not in raw_release:
        return True
    raw_values = raw_release[key]  # type: ignore[literal-required]
    if not isinstance(raw_values, list):
        raw_values = [raw_values]
    return "*" in raw_values


def matching_concrete_defs(concrete_defs: list, expected: ExpectedReleaseMatch):
    return (
        concrete for concrete in concrete_defs
        if concrete.sublime_text == expected.sublime_text
        if expected.platform is None or concrete.platform == expected.platform
        if (
            expected.python_version is None
            or concrete.python_version == expected.python_version
        )
    )


def release_matches_expected(
    release: Release,
    concrete,
    expected: ExpectedReleaseMatch,
) -> bool:
    version = release.get("version")
    if not isinstance(version, str):
        return False
    try:
        if not concrete.version.contains(Version(version), prereleases=True):
            return False
    except InvalidVersion:
        return False

    if expected.platform and not list_constraint_covers(
        release.get("platforms", []), expected.platform
    ):
        return False
    if expected.python_version and not list_constraint_covers(
        release.get("python_versions", []), expected.python_version
    ):
        return False
    if not scalar_constraint_covers(
        release.get("sublime_text", "*"), expected.sublime_text
    ):
        return False

    if concrete.asset_patterns:
        filename = unquote(
            urlsplit(release.get("url", "")).path.rsplit("/", 1)[-1]
        )
        if not filename:
            return False
        return any(
            pattern.match(filename)
            for pattern in compile_asset_patterns(concrete, version)
        )
    return True


def list_constraint_covers(values: str | list[str], target: str) -> bool:
    if isinstance(values, str):
        values = [values]
    return "*" in values or target in values


def scalar_constraint_covers(value: str | list[str], target: str) -> bool:
    if isinstance(value, list):
        return list_constraint_covers(value, target)
    return value == "*" or value == target


def missing_matrix_coordinates(
    unmatched: list[UnmatchedReleaseDefinition],
) -> list[tuple[str, str, str]]:
    coordinates = []
    seen = set()
    for definition in unmatched:
        for missing in definition.missing:
            if not missing.platform or not missing.python_version:
                continue
            coordinate = (
                missing.sublime_text,
                missing.platform,
                missing.python_version,
            )
            if coordinate in seen:
                continue
            seen.add(coordinate)
            coordinates.append(coordinate)
    return coordinates


def print_unmatched_release_definitions(
    definitions: list[UnmatchedReleaseDefinition],
) -> None:
    if not definitions:
        return
    print("Unmatched release definitions:")
    for index, definition in enumerate(definitions):
        if index:
            print("")
        for line in format_unmatched_release_definition(definition):
            print(line)


def format_unmatched_release_definition(
    definition: UnmatchedReleaseDefinition,
) -> list[str]:
    lines = []
    missing_values = missing_values_by_field(definition)
    for line in json.dumps(definition.raw, indent=2, ensure_ascii=False).splitlines():
        lines.append(line)
        if underline := missing_value_underline(line, missing_values):
            lines.append(underline)
    lines.extend(format_missing_matches(definition.missing))
    return lines


def missing_values_by_field(
    definition: UnmatchedReleaseDefinition,
) -> dict[str, set[str]]:
    values: dict[str, set[str]] = defaultdict(set)
    raw = definition.raw
    for missing in definition.missing:
        if "sublime_text" in raw:
            values["sublime_text"].add(missing.sublime_text)
        if missing.platform:
            values["platforms"].add(missing.platform)
        if missing.python_version:
            values["python_versions"].add(missing.python_version)
    return values


def missing_value_underline(line: str, missing_values: dict[str, set[str]]) -> str:
    underline = [" "] * len(line)
    for values in missing_values.values():
        for value in values:
            marker = json.dumps(value, ensure_ascii=False)
            start = line.find(marker)
            while start >= 0:
                for index in range(start, start + len(marker)):
                    underline[index] = "~"
                start = line.find(marker, start + len(marker))
    if any(char == "~" for char in underline):
        return "".join(underline)
    return ""


def format_missing_matches(missing_matches: list[ExpectedReleaseMatch]) -> list[str]:
    label = "Missing match" if len(missing_matches) == 1 else "Missing matches"
    return [f"{label}: {format_expected_match(match)}" for match in missing_matches]


def format_expected_match(match: ExpectedReleaseMatch) -> str:
    parts = [f"sublime_text={match.sublime_text}"]
    if match.platform:
        parts.append(f"platform={match.platform}")
    if match.python_version:
        parts.append(f"python_version={match.python_version}")
    return ", ".join(parts)


def format_change_message(
    added_names: list[str],
    updated_names: list[str]
) -> str:
    parts: list[str] = []
    if added_names:
        parts.append(format_added_message(added_names))
    if updated_names:
        parts.append(format_updated_message(updated_names))
    if not parts:
        return "Nothing new."
    return "\n".join(parts)


def format_added_message(names: list[str]) -> str:
    if len(names) > 5:
        return f"Added {len(names)} libraries."
    return f"Added {format_name_list(names)}."


def format_updated_message(names: list[str]) -> str:
    if len(names) == 1:
        return f"{names[0]} has been updated."
    return f"{format_name_list(names)} have been updated."


if __name__ == "__main__":
    main()
