import argparse
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from itertools import chain
from zoneinfo import ZoneInfo
import json
import sys
import os
from typing import TypedDict, Literal, NotRequired

from ._utils import pick, pl, write_json

type RepositoryUrl = str
type Platform = Literal["*", "windows", "osx", "linux"]
type Url = str
type IsoTimestamp = str
type Version = str
type BuildDescriptor = str


class Release(TypedDict, total=False):
    sublime_text: BuildDescriptor
    platforms: list[Platform]
    version: Version
    url: Url
    date: IsoTimestamp


class Package(TypedDict, total=False):
    name: str
    description: str
    author: list[str]
    homepage: Url
    last_modified: IsoTimestamp
    releases: list[Release]
    previous_names: list[str]
    labels: list[str]
    readme: Url | None
    issues: Url | None
    donate: Url | None
    buy: Url | None


class LibRelease(TypedDict):
    sublime_text: BuildDescriptor
    platforms: list[str]
    python_versions: list[str]
    version: Version
    url: Url
    date: IsoTimestamp
    sha256: NotRequired[str]


class Library(TypedDict):
    name: str
    releases: list[LibRelease]
    author: NotRequired[str]
    homepage: NotRequired[str]
    description: NotRequired[str]
    issues: NotRequired[Url]


class Channel(TypedDict, total=False):
    schema_version: str
    repositories: list[RepositoryUrl]
    packages_cache: dict[RepositoryUrl, list[Package]]
    libraries_cache: dict[RepositoryUrl, list[Library]]


DEFAULT_REGISTRY = "./registry.json"
DEFAULT_WORKSPACE = "./workspace.json"
DEFAULT_CHANNEL = "./channel.json"

# Note: Workspace is the source of truth and keeps all crawl output for the website.
# This step filters out removed/fatal/invalid packages and normalizes releases for channel.json.
# A package is minimally defined with: name, author, last_modified, releases.
# At least one release is required with the info: sublime_text, platforms, version, url, date.
# Targeted ST3/ST4 filtering happens later in compress_channel.py.


def parse_args():
    parser = argparse.ArgumentParser(description="Generate channel from workspace and registry.")
    parser.add_argument(
        "--registry",
        type=str,
        default=DEFAULT_REGISTRY,
        help=f"Path to the registry JSON file (default: {DEFAULT_REGISTRY})")
    parser.add_argument(
        "--workspace",
        type=str,
        default=DEFAULT_WORKSPACE,
        help=f"Path to the workspace JSON file (default: {DEFAULT_WORKSPACE})")
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default=DEFAULT_CHANNEL,
        help=f"Path to the output channel JSON file (default: {DEFAULT_CHANNEL})")
    parser.add_argument(
        "--wd",
        type=str,
        default=".",
        help="Working directory to resolve file paths (default: .)"
    )
    parser.add_argument(
        "--berlin",
        action="store_true",
        help="Format relative times in Europe/Berlin (default: UTC)"
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print channel JSON output"
    )
    return parser.parse_args()


def main(registry_path, workspace_path, channel_path, berlin: bool, pretty: bool):
    # Load registry
    try:
        with open(registry_path, "r", encoding="utf-8") as f:
            registry = json.load(f)
    except Exception as e:
        err(f"FATAL: Could not read registry file '{registry_path}': {e}")
        sys.exit(1)

    # Load workspace
    try:
        with open(workspace_path, "r", encoding="utf-8") as f:
            workspace = json.load(f)
    except Exception as e:
        err(f"FATAL: Could not read workspace file '{workspace_path}': {e}")
        sys.exit(1)

    # Prepare channel structure
    channel: Channel = {
        "schema_version": "4.0.0",
        "repositories": [],
        "packages_cache": {},
        "libraries_cache": {},
    }

    # Group packages by source
    packages_by_source: defaultdict[RepositoryUrl, list[Package]] = defaultdict(list)
    drop_count_pkg = 0
    removed_count_pkg = 0
    for pkg in workspace.get("packages", {}).values():
        if pkg.get("removed"):
            removed_count_pkg += 1
            continue
        if pkg.get("fail_reason", "").startswith("fatal: "):
            removed_count_pkg += 1
            continue
        norm_pkg = normalize_package(pkg)
        if not norm_pkg:
            drop_count_pkg += 1
            continue
        source: Url = pkg["source"]
        packages_by_source[source].append(norm_pkg)

    libraries_by_source: defaultdict[RepositoryUrl, list[Library]] = defaultdict(list)
    drop_count_lib = 0
    removed_count_lib = 0
    for lib in workspace.get("libraries", {}).values():
        if lib.get("removed"):
            removed_count_lib += 1
            continue
        norm_lib = normalize_library(lib)
        if not norm_lib:
            drop_count_lib += 1
            continue
        source = lib["source"]
        libraries_by_source[source].append(norm_lib)

    # Sort packages in each source by name
    for source, pkgs in packages_by_source.items():
        pkgs_sorted = sorted(pkgs, key=lambda p: p.get("name", ""))
        channel["packages_cache"][source] = pkgs_sorted
    for source, libs in libraries_by_source.items():
        libs_sorted = sorted(libs, key=lambda p: p.get("name", ""))
        channel["libraries_cache"][source] = libs_sorted

    # Add repositories to channel in order of appearance in the registry
    channel["repositories"] = [
        r
        for r in registry.get("repositories", [])
        if r in packages_by_source or r in libraries_by_source
    ]

    # Write channel.json
    write_json(channel_path, channel, pretty=pretty, ensure_ascii=False)

    source_count = len(packages_by_source) + len(libraries_by_source)
    package_count = sum(len(pkgs) for pkgs in packages_by_source.values())
    library_count = sum(len(libs) for libs in libraries_by_source.values())
    print(f"Wrote {channel_path}")
    print(
        f"Collated {pl(source_count, 'sources')} with "
        f"{pl(package_count, 'packages')} and "
        f"{pl(library_count, 'libraries')}."
    )
    print(
        f"Dropped {pl(drop_count_pkg, 'incomplete packages')}.  "
        f"{pl(removed_count_pkg, 'are')} currently tombstoned."
    )
    print(
        f"Dropped {pl(drop_count_lib, 'incomplete libraries')}.  "
        f"{pl(removed_count_lib, 'are')} currently tombstoned."
    )
    # Extract failing packages for reporting
    if failing := [
        pkg for pkg in chain(
            workspace.get("packages", {}).values(),
            workspace.get("libraries", {}).values()
        )
        if pkg.get("failing_since") and not pkg.get("removed")
    ]:
        failing_info = "\n".join(
            f"- **{pkg['name']}** [{failing_since(pkg, berlin)}]\n"
            f"    {pkg['fail_reason'].strip().replace('\n', '\n    ')}"
            for pkg in sorted(failing, key=lambda p: p['name'].lower())
        )
        print(f"\n#### Currently failing\n{failing_info}")


def normalize_package(pkg) -> Package | None:
    name = pkg.get("name")
    if not name:
        err(f"Drop package with no name: {pkg}")
        return None

    # releases must be a non-empty list and each must be valid
    releases: list[Release] = []
    for rel in pkg.get("releases", []):
        # platforms must be a non-empty list of Platform, and if '*' is present,
        # it must be the only value
        platforms = rel.get("platforms")
        if not isinstance(platforms, list) or not platforms:
            continue
        if "*" in platforms and len(platforms) > 1:
            continue
        # required release fields
        if not all(k in rel and rel[k] for k in ("sublime_text", "version", "url", "date")):
            continue
        releases.append({
            "sublime_text": rel["sublime_text"],
            "platforms": platforms,
            "version": rel["version"],
            "url": rel["url"],
            "date": format_utc_datetime(rel["date"]),
        })
    if not releases:
        err(f"Drop package {name} with no valid releases")
        return None

    # Only accept packages with all required fields
    required_fields = [
        "name", "author", "last_modified", "releases"
    ]
    # Check required fields
    for field in required_fields:
        if field not in pkg or not pkg[field]:
            err(f"Drop package {name} with missing field '{field}'")
            return None

    # Author must be a non-empty list[str]
    author = pkg["author"]
    if isinstance(author, str):
        author = [author]
    if not all(isinstance(a, str) for a in author):
        err(f"Drop package {name} with invalid author field: {author}")
        return None

    out: Package = {
        "name": pkg["name"],
        "author": author,
        "last_modified": format_utc_datetime(pkg["last_modified"]),
        "releases": releases,

        # mandatory with fallback
        "homepage": pkg.get("homepage", pkg.get("details", pkg.get("source"))),

        # mandatory keys but with null or empty defaults
        "description": pkg.get("description"),
        "previous_names": pkg.get("previous_names", []),
        "labels": pkg.get("labels", []),
        "readme": pkg.get("readme"),
        "issues": pkg.get("issues"),
        "donate": pkg.get("donate"),
        "buy": pkg.get("buy"),
    }
    return out


def normalize_library(lib) -> Library | None:
    name = lib.get("name")
    if not name:
        err(f"Drop library with no name: {lib}")
        return None

    releases: list[LibRelease] = []
    for rel in lib.get("releases", []):
        required_lib_rel_fields = (
            "sublime_text",
            "platforms",
            "python_versions",
            "version",
            "url",
            "date"
        )
        if not all(k in rel and rel[k] for k in required_lib_rel_fields):
            continue

        r: LibRelease = pick(required_lib_rel_fields + ("sha256",), rel)  # type: ignore[assignment]
        r["date"] = format_utc_datetime(r["date"])
        releases.append(r)

    if not releases:
        err(f"Drop library {name} with no valid releases")
        return None

    required_main_fields = ("name", "releases")
    for field in required_main_fields:
        if field not in lib or not lib[field]:
            err(f"Drop library {name} with missing field '{field}'")
            return None

    out: Library = pick(  # type: ignore[assignment]
        ("name", "author", "description", "homepage", "issues"),
        lib
    )
    out["releases"] = releases
    return out


def format_utc_datetime(value: str) -> str:
    if "T" not in value:
        return value
    return value[:19].replace("T", " ")


def failing_since(pkg, berlin: bool):
    extra = ""
    if failing_since := pkg.get("failing_since"):
        try:
            dt = datetime.strptime(failing_since, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            rel = relative_time(dt, berlin)
            extra = f"since {rel}"
        except Exception as e:
            err(f"computing relative_time for *{pkg['name']}* raised {e}.")
    return extra


def relative_time(dt: datetime, berlin: bool) -> str:
    tz = ZoneInfo("Europe/Berlin") if berlin else timezone.utc
    now = datetime.now(tz)
    local_dt = dt.astimezone(tz)
    delta = now - local_dt
    days = delta.days
    if 0 <= delta.total_seconds() < 300:
        return "now"
    elif local_dt.date() == now.date():
        return local_dt.strftime('%H:%M today')
    elif local_dt.date() == (now.date() - timedelta(days=1)):
        return local_dt.strftime('%H:%M yesterday')
    elif days < 14:
        return f"{days} day{'s' if days != 1 else ''}"
    elif days < 60:
        weeks = days // 7
        return f"{weeks} week{'s' if weeks != 1 else ''}"
    elif days < 365:
        months = days // 30
        return f"{months} month{'s' if months != 1 else ''}"
    else:
        years = days // 365
        return f"{years} year{'s' if years != 1 else ''}"


def err(*args, **kwargs):
    print(*args, **kwargs, file=sys.stderr)


if __name__ == "__main__":
    args = parse_args()
    wd = os.path.abspath(args.wd)
    os.makedirs(wd, exist_ok=True)
    args.registry = os.path.normpath(os.path.join(wd, args.registry))
    args.workspace = os.path.normpath(os.path.join(wd, args.workspace))
    args.output = os.path.normpath(os.path.join(wd, args.output))
    main(args.registry, args.workspace, args.output, args.berlin, args.pretty)
