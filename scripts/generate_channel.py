import argparse
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import json
import sys
import os
from typing import TypedDict, Literal


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


class Channel(TypedDict, total=False):
    schema_version: str
    repositories: list[RepositoryUrl]
    packages_cache: dict[RepositoryUrl, list[Package]]


DEFAULT_REGISTRY = "./registry.json"
DEFAULT_WORKSPACE = "./workspace.json"
DEFAULT_CHANNEL = "./channel.json"

# Note: Workspace is the source of truth and keeps all crawl output for the website.
# This step filters out removed/fatal/invalid packages and normalizes releases for channel.json.
# A package is minimally defined with: name, author, last_modified, releases.
# At least one release is required with the info: sublime_text, platforms, version, url, date.
# Targeted ST3/ST4 filtering happens later in collate_channel.py.


def main(registry_path, workspace_path, channel_path, berlin: bool):
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
    }

    # Group packages by source
    packages_by_source: defaultdict[RepositoryUrl, list[Package]] = defaultdict(list)
    drop_count = 0
    removed_count = 0
    for pkg in workspace.get("packages", {}).values():
        if pkg.get("removed"):
            removed_count += 1
            continue
        if pkg.get("fail_reason", "").startswith("fatal: "):
            removed_count += 1
            continue
        norm = normalize_package(pkg)
        if not norm:
            drop_count += 1
            continue
        source: Url = pkg["source"]
        packages_by_source[source].append(norm)

    # Sort packages in each source by name
    for source, pkgs in packages_by_source.items():
        pkgs_sorted = sorted(pkgs, key=lambda p: p.get("name", ""))
        channel["packages_cache"][source] = pkgs_sorted

    # Add repositories to channel in order of appearance in the registry
    channel["repositories"] = [
        r
        for r in registry.get("repositories", [])
        if r in packages_by_source
    ]

    # Write channel.json
    with open(channel_path, "w", encoding="utf-8") as f:
        json.dump(channel, f, indent=2, ensure_ascii=False)
    print(f"Wrote {channel_path}")
    print(
        f"Collated {len(packages_by_source)} sources with "
        f"{sum(len(pkgs) for pkgs in packages_by_source.values())} packages."
    )
    print(
        f"Dropped {drop_count} incomplete packages.  "
        f"{removed_count} are currently tombstoned."
    )
    # Extract failing packages for reporting
    if failing_packages := [
        pkg for pkg in workspace.get("packages", {}).values()
        if pkg.get("failing_since") and not pkg.get("removed")
    ]:
        failing_info = "\n".join(
            f"- **{pkg['name']}:** [{failing_since(pkg, berlin)}]\n"
            f"    {pkg['fail_reason'].strip().replace('\n', '\n    ')}"
            for pkg in sorted(failing_packages, key=lambda p: p['name'].lower())
        )
        print(f"\n**Currently failing**:\n{failing_info}")


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
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    wd = os.path.abspath(args.wd)
    os.makedirs(wd, exist_ok=True)
    args.registry = os.path.normpath(os.path.join(wd, args.registry))
    args.workspace = os.path.normpath(os.path.join(wd, args.workspace))
    args.output = os.path.normpath(os.path.join(wd, args.output))
    main(args.registry, args.workspace, args.output, args.berlin)
