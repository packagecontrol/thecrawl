from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections import defaultdict, namedtuple
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import partial
from pathlib import Path
from typing import Literal, Required, TypedDict

import aiohttp
from rich.console import Console
from rich.progress import track

from ._lib_doctor import (
    ExpectedReleaseMatch,
    UnmatchedReleaseDefinition,
    unmatched_release_definitions,
)
from ._lib_matrix_printer import format_library_matrix
from ._resolve_lib import (
    Release,
    ReleaseEntry,
    SUPPORTED_PLATFORMS,
    explain_library,
    load_json,
    resolve_library,
)
from ._utils import err, format_name_list, write_json
from ._explain_package import print_library_explain


DEFAULT_REGISTRY = "./registry.json"
DEFAULT_WORKSPACE = "./workspace.json"
TRY_PLATFORM_ALIASES = {
    os_name: [
        platform
        for platform in SUPPORTED_PLATFORMS
        if platform.startswith(f"{os_name}-")
    ]
    for os_name in ("windows", "osx", "linux")
}


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
    try_definition: str | None
    try_definition_shortcut: bool
    write: bool
    verbose: bool
    limit: int
    workspace: Path
    cache_dir: Path


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
        nargs="?",
        const="",
        metavar="NAME",
        help="Library name to print resolved release definitions for",
    )
    parser.add_argument(
        "--try",
        dest="try_definition",
        nargs="?",
        const="-",
        metavar="DEF",
        help=(
            "Use an in-memory release definition with --name or --explain. "
            "Inline DEF accepts JSON or key: value shorthand with ';' "
            "separators. Use '-' or omit DEF to read from stdin."
        ),
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

    if ns.explain is not None and ns.name:
        parser.error("Use either --name or --explain, not both.")
    try_definition_shortcut = ns.try_definition not in (None, "-")
    if (
        ns.try_definition is not None
        and not (ns.name or ns.explain is not None)
        and not try_definition_shortcut
    ):
        parser.error("--try from stdin requires --name or --explain.")
    if ns.write and not ns.name:
        parser.error("--write requires --name.")
    if ns.write and ns.try_definition is not None:
        parser.error("--write cannot be used with --try.")
    if ns.limit < 1:
        parser.error("--limit must be a positive integer.")

    if ns.try_definition == "-":
        ns.try_definition = sys.stdin.read()

    registry_path = Path(os.path.abspath(ns.registry))
    if not registry_path.exists() and ns.try_definition is None:
        parser.error(f"{registry_path} not found.")

    return Args(
        registry=registry_path,
        allowed_sources=set(ns.allowed_source),
        name=ns.name,
        explain=ns.explain,
        try_definition=ns.try_definition,
        try_definition_shortcut=try_definition_shortcut,
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

    if args.explain is not None:
        name = args.explain or infer_try_name_or_report_error(args)
        if not name:
            return 1
        return await handle_explain(name, args)

    if args.try_definition is not None:
        name = infer_try_name_or_report_error(args)
        if not name:
            return 1
        return await handle_name(name, args)

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


def infer_try_name_or_report_error(args: Args) -> str | None:
    if args.try_definition is None:
        print("Could not infer library name without --try definition.")
        return None
    try:
        name = infer_try_library_name(
            args.try_definition,
            split_semicolon=args.try_definition_shortcut,
        )
    except ValueError as exc:
        print(f"Invalid --try definition: {exc}")
        return None
    if not name:
        print("Could not infer library name from --try definition.")
        return None
    return name


def infer_try_library_name(
    definition: str,
    *,
    split_semicolon: bool,
) -> str | None:
    releases = parse_try_definition(definition, split_semicolon=split_semicolon)
    for release in releases:
        name = infer_try_library_name_from_release(release)
        if name:
            return name
    return None


def infer_try_library_name_from_release(release: ReleaseEntry) -> str | None:
    base = release.get("base")
    if not isinstance(base, str):
        return None
    if base.startswith("pypi:"):
        return base.split(":", 1)[1] or None
    if base.startswith("github:"):
        return base.rstrip("/").rsplit("/", 1)[-1] or None
    if "pypi.org/project/" in base:
        return base.rstrip("/").rsplit("/", 1)[-1] or None
    if "github.com/" in base:
        return base.rstrip("/").rsplit("/", 1)[-1] or None
    return None


async def handle_name(name: str, args: Args) -> int:
    library = find_or_build_library(name, args)
    if not library:
        return 1

    if args.try_definition is None and not is_allowed_source(
        library,
        args.allowed_sources,
    ):
        print("Library is not on an allowed source.")
        return 0

    return await crawl_single_library(name, library, args)


async def handle_explain(name: str, args: Args) -> int:
    library = find_or_build_library(name, args)
    if not library:
        return 1

    explain_rows = explain_library(library)
    metadata = {key: value for key, value in library.items() if key != "releases"}
    print_library_explain(name, explain_rows, metadata=metadata)
    return 0


def find_or_build_library(name: str, args: Args) -> RegistryEntry | None:
    registry: Registry = (
        load_json(args.registry)  # type: ignore[assignment]
        if args.registry.exists()
        else {"libraries": []}
    )
    if args.try_definition is not None:
        try:
            return synthesize_library_entry(
                name,
                find_library(registry, name),
                args.try_definition,
                split_semicolon=args.try_definition_shortcut,
                expand_platform_aliases=args.try_definition_shortcut,
            )
        except ValueError as exc:
            print(f"Invalid --try definition: {exc}")
            return None

    library = find_library(registry, name)
    if not library:
        print(f'Library "{name}" not found in {args.registry.name}.')
        return None
    return library


async def crawl_single_library(
    name: str,
    library: RegistryEntry,
    args: Args,
) -> int:
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
            print(f"Resolved {name}{version_label} using {source_label}.")
        else:
            print(
                format_library_matrix(
                    name=name,
                    latest_version=latest_version,
                    sources=sources,
                    releases=info["releases"],
                    unmatched_definitions=unmatched,
                )
            )
        if args.write:
            print(format_change_message(added_names, updated_names))
        return 0
    except Exception as exc:
        if args.write:
            entry = workspace_entries.get(name, {"name": name}).copy()
            mark_added(entry, timestamp)
            mark_failure(entry, timestamp, str(exc))
            workspace_entries[name] = entry
            write_json(args.workspace, workspace, pretty=True, ensure_ascii=True)
        raise


def synthesize_library_entry(
    name: str,
    registry_entry: RegistryEntry | None,
    definition: str,
    *,
    split_semicolon: bool = False,
    expand_platform_aliases: bool = False,
) -> RegistryEntry:
    releases = parse_try_definition(
        definition,
        split_semicolon=split_semicolon,
        expand_platform_aliases=expand_platform_aliases,
    )
    library: RegistryEntry = {"name": name, "releases": releases}
    if registry_entry:
        return registry_entry.copy() | library
    return library


def parse_try_definition(
    definition: str,
    *,
    split_semicolon: bool = False,
    expand_platform_aliases: bool = False,
) -> list[ReleaseEntry]:
    definition = definition.strip()
    if not definition:
        raise ValueError("empty release definition")

    parsed_from_shorthand = False
    try:
        parsed = json.loads(definition)
    except json.JSONDecodeError:
        parsed = parse_try_key_value_definition(
            definition,
            split_semicolon=split_semicolon,
        )
        parsed_from_shorthand = True

    if isinstance(parsed, dict) and "releases" in parsed:
        parsed = parsed["releases"]
    elif isinstance(parsed, dict):
        parsed = [parsed]

    if not isinstance(parsed, list) or not parsed:
        raise ValueError("expected a release object or a non-empty release list")
    if not all(isinstance(item, dict) for item in parsed):
        raise ValueError("release entries must be objects")
    if expand_platform_aliases and parsed_from_shorthand:
        normalize_try_shorthand_aliases(parsed)
    return parsed


def normalize_try_shorthand_aliases(releases: list[dict]) -> None:
    for release in releases:
        if "platform" in release and "platforms" not in release:
            release["platforms"] = release.pop("platform")
        if "platforms" in release:
            release["platforms"] = expand_try_platform_alias(release["platforms"])
        if "python" in release and "python_versions" not in release:
            release["python_versions"] = release.pop("python")


def expand_try_platform_alias(platforms: object) -> object:
    if isinstance(platforms, str):
        return TRY_PLATFORM_ALIASES.get(platforms, platforms)
    if isinstance(platforms, list):
        expanded: list[object] = []
        for platform in platforms:
            replacement = (
                TRY_PLATFORM_ALIASES.get(platform)
                if isinstance(platform, str) else
                None
            )
            if replacement:
                expanded.extend(replacement)
            else:
                expanded.append(platform)
        return expanded
    return platforms


def parse_try_key_value_definition(
    definition: str,
    *,
    split_semicolon: bool = False,
) -> dict | list[dict]:
    """
    Parse the lightweight ``--try`` shorthand.

    This intentionally supports only the small subset that is useful at the
    command line: ``key: value`` pairs, blank lines, comments, optional
    semicolon separators, and top-level list items introduced with ``-``. It is
    YAML-ish for convenience, but it is not a YAML parser:
    there are no nested mappings, continuation lines, escape handling for
    single-quoted strings, or indentation semantics. Values stay as strings
    except for booleans/null, JSON double-quoted strings, and simple bracketed
    lists.

    Use JSON for anything more structured or ambiguous.
    """
    entries: list[dict] = []
    current: dict | None = None
    saw_list_marker = False

    for raw_line in split_try_definition_lines(
        definition,
        split_semicolon=split_semicolon,
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("- "):
            if raw_line.startswith((" ", "\t")):
                raise ValueError(f"nested list items are not supported: {raw_line!r}")
            saw_list_marker = True
            if current is not None:
                entries.append(current)
            current = {}
            line = line[2:].strip()
            if not line:
                continue
        elif current is None:
            current = {}

        key, separator, value = line.partition(":")
        key = key.strip()
        if not separator or not is_try_key(key):
            raise ValueError(f"expected 'key: value', got {raw_line!r}")
        current[key] = parse_try_value(value)

    if current is not None:
        entries.append(current)
    if not entries:
        raise ValueError("empty release definition")
    return entries if saw_list_marker else entries[0]


def split_try_definition_lines(
    definition: str,
    *,
    split_semicolon: bool = False,
) -> list[str]:
    lines: list[str] = []
    for raw_line in definition.splitlines():
        if split_semicolon:
            lines.extend(split_try_definition_line(raw_line))
        else:
            lines.append(raw_line)
    return lines


def split_try_definition_line(raw_line: str) -> list[str]:
    parts: list[str] = []
    start = 0
    quote = ""
    escaped = False
    bracket_depth = 0

    for index, char in enumerate(raw_line):
        if quote:
            if quote == '"' and char == "\\" and not escaped:
                escaped = True
                continue
            if char == quote and not escaped:
                quote = ""
            escaped = False
            continue
        if char in ('"', "'"):
            quote = char
            continue
        if char in "[{(":
            bracket_depth += 1
            continue
        if char in "]})" and bracket_depth:
            bracket_depth -= 1
            continue
        if char == ";" and bracket_depth == 0:
            parts.append(raw_line[start:index])
            start = index + 1

    parts.append(raw_line[start:])
    return parts


def is_try_key(key: str) -> bool:
    return bool(key) and all(char.isalnum() or char == "_" for char in key)


def parse_try_value(value: str) -> object:
    value = value.strip()
    if not value:
        return ""

    lowered = value.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if lowered == "null":
        return None

    if value[0] == value[-1:] and value[0] in ('"', "'"):
        if value[0] == '"':
            return json.loads(value)
        return value[1:-1]

    if value.startswith("[") and value.endswith("]"):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            inner = value[1:-1].strip()
            if not inner:
                return []
            return [parse_try_value(part) for part in inner.split(",")]

    return value


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


def print_unmatched_release_definitions(
    definitions: list[UnmatchedReleaseDefinition],
) -> None:
    if not definitions:
        return

    console = Console(markup=False, highlight=False, soft_wrap=True)
    console.print("\nUnmatched release definitions:")
    for index, definition in enumerate(definitions):
        if index:
            console.print("")
        missing_values = missing_values_by_field(definition)
        for line in format_unmatched_release_definition(definition):
            console.print(
                line,
                style=unmatched_definition_line_style(line, missing_values),
            )
    console.print("")


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


def unmatched_definition_line_style(
    line: str,
    missing_values: dict[str, set[str]],
) -> str | None:
    if is_missing_value_underline(line):
        return "yellow"
    if line.startswith("Missing match"):
        return None
    if missing_value_underline(line, missing_values):
        return None
    return "#777777"


def is_missing_value_underline(line: str) -> bool:
    return line.strip(" ~") == "" and "~" in line


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
