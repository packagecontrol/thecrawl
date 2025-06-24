import argparse
from collections import defaultdict
from datetime import datetime, timezone
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

# Note: This drops ST2 packages for smaller download.  For the website, this would
# probably not the right thing to do, as we generally want to keep the history
# of packages intact and available to users.  (We even show removed packages in the UI!)


def main(registry_path, workspace_path, channel_path):
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
    for pkg in workspace.get("packages", {}).values():
        if pkg.get("removed"):
            drop_count += 1
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
    print(f"Dropped {drop_count} invalid packages.")


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
            "date": rel["date"],
        })
    if not releases:
        err(f"Drop package {name} with no valid releases{failing_since(pkg)}")
        return None

    # Only accept packages with all required fields
    required_fields = [
        "name", "author", "last_modified", "releases"
    ]
    # Check required fields
    for field in required_fields:
        if field not in pkg or not pkg[field]:
            err(f"Drop package {name} with missing field '{field}'{failing_since(pkg)}")
            return None

    # Author must be a non-empty list[str]
    author = pkg["author"]
    if isinstance(author, str):
        author = [author]
    if not all(isinstance(a, str) for a in author):
        err(f"Drop package {name} with invalid author field: {author}{failing_since(pkg)}")
        return None

    out: Package = {
        "name": pkg["name"],
        "author": author,
        "last_modified": pkg["last_modified"],
        "releases": releases,

        # mandatory with fallback
        "homepage": pkg.get("homepage", pkg.get("source")),

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


def failing_since(pkg):
    extra = ""
    if failing_since := pkg.get("failing_since"):
        try:
            dt = datetime.strptime(failing_since, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            rel = relative_time(dt)
            extra = f"  *(failing since {rel})*"
        except Exception:
            pass
    return extra


def relative_time(dt: datetime) -> str:
    now = datetime.now(timezone.utc)
    delta = now - dt
    days = delta.days
    if days < 1:
        return "today"
    elif days < 30:
        return f"{days} day{'s' if days != 1 else ''}"
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
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    wd = os.path.abspath(args.wd)
    os.makedirs(wd, exist_ok=True)
    args.registry = os.path.normpath(os.path.join(wd, args.registry))
    args.workspace = os.path.normpath(os.path.join(wd, args.workspace))
    args.output = os.path.normpath(os.path.join(wd, args.output))
    main(args.registry, args.workspace, args.output)
