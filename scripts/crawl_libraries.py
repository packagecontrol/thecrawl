from __future__ import annotations

import argparse
import asyncio
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from functools import partial
from pathlib import Path
from typing import NotRequired, Required, TypedDict

import aiohttp
from rich.console import Console
from rich.progress import (
    BarColumn,
    Progress,
    TaskProgressColumn,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)

from ._resolve_lib import (
    ReleaseInfo,
    ReleaseDef,
    ResolvedLibraryInfo,
    SourceInfo,
    dump_json,
    explain_library,
    load_json,
    resolve_library,
)
from .utils import err


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
    releases: Required[list[ReleaseDef]]


class WorkspaceEntry(_Entry, total=False):
    name: Required[str]
    # releases: Required[list[ReleaseInfo]]

    added: IsoTimestamp
    removed: IsoTimestamp
    last_crawl: IsoTimestamp

    failing_since: IsoTimestamp
    fail_reason: str

    latest_version: VersionString
    last_update: str
    last_update_at: IsoTimestamp


def parse_args() -> argparse.Namespace:
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
    return parser.parse_args()


def main() -> None:
    raise SystemExit(asyncio.run(run()))


def is_allowed_source(library: RegistryEntry, allowed_sources: set[str]) -> bool:
    if not allowed_sources:
        return True
    source = library.get("source")
    return bool(source) and source in allowed_sources


async def run() -> int:
    args = parse_args()
    registry_path = Path(os.path.abspath(args.registry))
    if not registry_path.exists():
        raise FileNotFoundError(f"{registry_path} not found.")

    if args.explain and args.name:
        raise ValueError("Use either --name or --explain, not both.")

    registry: Registry = load_json(registry_path)  # type: ignore[assignment]
    allowed_sources = set(args.allowed_source)

    if args.explain:
        library = find_library(registry, args.explain)
        if not library:
            raise ValueError(
                f'Library "{args.explain}" not found in {registry_path.name}.'
            )
        concrete_defs = explain_library(library)
        print(json.dumps(concrete_defs, indent=2, ensure_ascii=True))
        return 0

    timestamp = now_timestamp()
    updated_names: list[str] = []

    workspace_path = Path(os.path.abspath(args.workspace))
    workspace: Workspace = load_workspace(workspace_path)
    dump_workspace = partial(dump_json, workspace_path, workspace)  # type: ignore[arg-type]
    workspace_entries = workspace["libraries"]
    registered_entries = {
        lib["name"]: lib
        for lib in registry["libraries"]
    }

    if args.name:
        library = find_library(registry, args.name)
        if not library:
            raise ValueError(f'Library "{args.name}" not found in {registry_path.name}.')

        if not is_allowed_source(library, allowed_sources):
            print("Library is not on an allowed source.")
            return 0

        try:
            async with aiohttp.ClientSession() as aio_session:
                info, sources = await resolve_library(
                    library, Path(args.cache_dir), aio_session
                )

            entry: WorkspaceEntry = \
                workspace_entries.get(args.name, {"name": args.name}).copy()
            entry.update(info)
            mark_added(entry, timestamp)
            latest_version = latest_version_from_releases(info["releases"])
            if mark_success(entry, timestamp, latest_version):
                updated_names.append(args.name)
            workspace_entries[args.name] = entry
            dump_workspace()

            source_label = ", ".join(sources) if sources else "cache"
            version_label = f" {latest_version}" if latest_version else ""
            print(json.dumps(entry, indent=2, ensure_ascii=True))
            print(f"Resolved {args.name}{version_label} using {source_label}.")
            print(format_updated_message(updated_names))
            return 0
        except Exception as exc:
            if args.name in workspace_entries:
                mark_failure(workspace_entries[args.name], timestamp, str(exc))
                dump_workspace()
            raise

    ignored_by_source: dict[str, int] = defaultdict(int)
    if allowed_sources:
        for library in registry.get("libraries", []):
            source = library.get("source", "")
            ignored_by_source[source] += 1
        for source, count in sorted(ignored_by_source.items()):
            if source:
                print(f"Ignoring {count} libraries from {source}")
            else:
                print(f"Ignoring {count} libraries without a source.")

    removed = set(workspace_entries) - set(registered_entries)
    for name in removed:
        if entry := workspace_entries.get(name):  # type: ignore[assignment]
            mark_removed(entry, timestamp)

    for name, lib in registered_entries.items():
        if is_allowed_source(lib, allowed_sources):
            if entry := workspace_entries.get(name):  # type: ignore[assignment]
                mark_added(entry, timestamp)

    active_libs = (
        entry
        for name, entry in registered_entries.items()
        if is_allowed_source(entry, allowed_sources)
        if not workspace_entries.get(name, {}).get("removed")  # type: ignore[call-overload]
    )

    def sorter(name: Name):
        return (
            workspace_entries  # type: ignore[call-overload]
            .get(name, {})
            .get("last_crawl", "0000-00-00T00:00:00Z"),
            name.lower()
        )

    selected_libs = sorted(
        active_libs,
        key=lambda entry: sorter(entry["name"])
    )[:args.limit]
    if not selected_libs:
        print("Nothing to crawl.")
        return 0

    console = Console(stderr=True)
    disable_progress = not console.is_terminal or os.environ.get("CI") == "true"
    with Progress(
        TextColumn("[bold blue]Crawling Libraries:"),
        BarColumn(),
        TaskProgressColumn(),
        TimeElapsedColumn(),
        TimeRemainingColumn(),
        console=console,
        transient=False,
        disable=disable_progress,
    ) as progress:
        task_id = progress.add_task("Crawling Libraries", total=len(selected_libs))
        async with aiohttp.ClientSession() as aio_session:
            async def _resolve_named(
                library: RegistryEntry,
            ) -> tuple[str, tuple[ResolvedLibraryInfo, list[SourceInfo]] | Exception]:
                name = library["name"]
                task = resolve_library(library, Path(args.cache_dir), aio_session)
                try:
                    return name, await task
                except Exception as exc:
                    return name, exc

            tasks = [_resolve_named(library) for library in selected_libs]
            for task in asyncio.as_completed(tasks):
                name, result = await task
                progress.advance(task_id)

                if isinstance(result, Exception):
                    if name in workspace_entries:
                        mark_failure(workspace_entries[name], timestamp, str(result))
                    print(f"Failed {name}: {result}")
                    continue

                info, sources = result
                entry = workspace_entries.get(name, {"name": name}).copy()
                entry.update(info)
                mark_added(entry, timestamp)
                latest_version = latest_version_from_releases(info["releases"])
                if mark_success(entry, timestamp, latest_version):
                    updated_names.append(name)
                workspace_entries[name] = entry
                source_label = ", ".join(sources) if sources else "cache"
                version_label = f" {latest_version}" if latest_version else ""
                err(f"Resolved {name}{version_label} using {source_label}.")

    dump_workspace()
    print(f"Crawled {len(selected_libs)} libraries.")
    print(format_updated_message(updated_names))
    return 0


def parse_last_crawl(value: str | None) -> datetime:
    if not value:
        return datetime.min
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return datetime.min


def latest_version_from_releases(releases: list[ReleaseInfo]) -> str | None:
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
) -> bool:
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
    return updated


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


def format_updated_message(names: list[str]) -> str:
    if not names:
        return "Nothing new."
    if len(names) == 1:
        return f"{names[0]} has been updated."
    if len(names) == 2:
        return f"{names[0]} and {names[1]} have been updated."
    return f"{', '.join(names[:-1])}, and {names[-1]} have been updated."


if __name__ == "__main__":
    main()
