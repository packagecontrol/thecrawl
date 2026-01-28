import aiohttp
import argparse
import asyncio
from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from itertools import product
import json
import os
import re
import sys
from typing import Iterable, Literal, NotRequired, Required, TypedDict
from packaging.specifiers import SpecifierSet


from .bitbucket import fetch_bitbucket_info, RepoInfo as BitbucketRepoInfo
from .generate_registry import Registry, PackageEntry as PackageEntryV1
from .github import (
    fetch_github_info, rate_limit_info,
    QueryScope, RepoInfo as GithubRepoInfo, ReleaseAssetInfo
)
from .gitlab import fetch_gitlab_info, RepoInfo as GitlabRepoInfo
from .codeberg import fetch_codeberg_info, RepoInfo as CodebergRepoInfo
from ._resolve_lib import (
    match_tag_version,
    normalize_st_build,
    normalize_version_spec,
)
from ._utils import next_run, parse_version, resolve_url, update_url, write_json, pl
import traceback


DEFAULT_REGISTRY = "./registry.json"
DEFAULT_WORKSPACE = "./workspace.json"
UTC_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
STYLIZED_DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S"

type PackageName = str
type Url = str
type IsoTimestamp = str
type Version = str
type BuildDescriptor = str
type Platform = Literal["*", "windows", "osx", "linux"]
type ReleaseDescription = dict


class Release(TypedDict, total=False):
    sublime_text: BuildDescriptor
    platforms: list[str]
    version: Version
    url: Url
    date: IsoTimestamp
    libraries: NotRequired[list[str]]  # ? really, actually not used


class PackageEntry(TypedDict, total=False):
    id: NotRequired[str]
    name: Required[str]
    details: NotRequired[Url]
    releases: list[Release]

    source: Url
    schema_version: str

    fetching_source_failed: NotRequired[IsoTimestamp]  # fetching repo source failed
    removed: NotRequired[IsoTimestamp]  # not listed in the registry anymore
    invalid: NotRequired[bool]
    first_seen: IsoTimestamp
    last_seen: IsoTimestamp
    next_crawl: IsoTimestamp
    last_modified: IsoTimestamp
    failing_since: IsoTimestamp
    fail_reason: str

    # 'hints' are meant as a storage for additional 'hub' info
    hints: NotRequired[list[str]]


class Workspace(TypedDict):
    packages: dict[PackageName, PackageEntry]
    libraries: dict


class HeartAttack(Exception):
    """Raised when a repository ID mismatch is detected."""
    pass


def err(*args, **kwargs) -> None:
    print(*args, **kwargs, file=sys.stderr)


async def main(
    registry: str,
    workspace: str,
    name: str | None,
    limit: int = 200,
    presto: bool = False
) -> None:
    if not os.path.exists(registry):
        err(f"FATAL: Registry file '{registry}' does not exist.")
        sys.exit(1)
    try:
        with open(registry, 'r') as reg_file:
            registry_data = json.load(reg_file)
    except Exception as e:
        err(f"FATAL: Could not read registry file '{registry}': {e}")
        sys.exit(1)

    if os.path.exists(workspace):
        with open(workspace, 'r') as ws_file:
            workspace_data = json.load(ws_file)
    else:
        workspace_data = {"packages": {}}

    try:
        await main_(registry_data, workspace_data, name, limit, presto)
    finally:
        write_json(workspace, workspace_data, pretty=True, ensure_ascii=True)


async def main_(
    registry: Registry,
    workspace: Workspace,
    name: str | None,
    limit: int,
    presto: bool = False
) -> None:
    name_requested = bool(name)
    if name:
        for entry in registry["packages"]:
            if entry.get("name") == name:
                tocrawl = [entry]
                break
        else:
            err(f"Package '{name}' not found in registry.")
            return
    else:
        maintenance(registry, workspace)
        tocrawl = next_packages_to_crawl(registry, workspace, limit=limit, presto=presto)

    async with aiohttp.ClientSession() as session:
        tasks = [
            crawl(
                session,
                package,
                workspace["packages"].get(name, {"name": name})
            )
            for package in tocrawl
            if (name := package["name"])
        ]
        results = await asyncio.gather(*tasks)
        for new_entry in results:
            workspace["packages"][new_entry["name"]] = new_entry
            if name_requested:
                print(json.dumps(new_entry, indent=2, ensure_ascii=False))

    print("---")
    print(
        f"{pl(len(workspace['packages'].keys()), 'packages')} "
        f"and {pl(len(workspace.get('libraries', {}).keys()), 'libraries')} "
        f"in db."
    )

    if len(tocrawl) > 0:
        print("GitHub", rate_limit_info)


def next_packages_to_crawl(
    registry: Registry, workspace: Workspace, limit: int = 200, presto: bool = False
) -> list[PackageEntryV1]:
    """
    Returns a list of packages to crawl, sorted by next_crawl timestamp.
    If next_crawl is not set, it defaults to the current time.
    """
    now = datetime.now(timezone.utc)
    now_string = now.strftime(UTC_FORMAT)
    packages = registry["packages"]
    packages_to_crawl = [
        entry
        for entry in packages
        if not entry.get("fetching_source_failed")
        if presto or (
            workspace["packages"]  # type: ignore[call-overload]
            .get(entry["name"], {})
            .get("next_crawl", now_string)
            <= now_string
        )
    ]
    print(
        f"Found {pl(len(packages_to_crawl), 'packages')} to crawl.",
        f"Pick {limit} of them." if limit < len(packages_to_crawl) else ""
    )
    if len(packages_to_crawl) == 0:
        if next_package := next(iter(sorted(
            (
                entry
                for entry in packages
                if not entry.get("fetching_source_failed")
            ),
            key=lambda pkg: (
                workspace["packages"]  # type: ignore[call-overload]
                .get(pkg["name"], {})
                .get("next_crawl", now_string)
            )
        )), None):
            next_crawl_time = (
                workspace["packages"]  # type: ignore[call-overload]
                .get(next_package["name"], {})
                .get("next_crawl", now_string)
            )
            next_crawl_dt = (
                datetime
                .strptime(next_crawl_time, UTC_FORMAT)
                .replace(tzinfo=timezone.utc)
            )
            delta = next_crawl_dt - now
            minutes = int(delta.total_seconds() // 60)
            if minutes > 0:
                print(f"Next package runs in {pl(minutes, 'minutes')}.")
            else:
                print(
                    f"Next package runs in {pl(round(delta.total_seconds()), 'seconds')}."
                )

    if presto:
        key = lambda pkg: (
            workspace["packages"]  # type: ignore[call-overload]
            .get(pkg["name"], {})
            .get("last_seen", "0000-00-00T00:00:00Z")
        )
    else:
        key = lambda pkg: (
            workspace["packages"]  # type: ignore[call-overload]
            .get(pkg["name"], {})
            .get("next_crawl", now_string)
        )

    return sorted(packages_to_crawl, key=key)[:limit]


def maintenance(registry: Registry, workspace: Workspace) -> None:
    workspace.pop("dependencies", None)  # type: ignore[typeddict-item]

    # lookup all packages in workspace and mark them as `removed`
    # if they have been removed from the registry
    now = datetime.now(timezone.utc)
    now_string = now.strftime(UTC_FORMAT)
    current_package_names = {entry["name"] for entry in registry["packages"]}
    packages = workspace["packages"]
    for name in packages.keys() - current_package_names:
        packages[name].setdefault("removed", now_string)


async def crawl(
    session: aiohttp.ClientSession,
    package: PackageEntryV1,
    existing: PackageEntry
) -> PackageEntry:
    out: PackageEntry
    now = datetime.now(timezone.utc)
    now_string = now.strftime(UTC_FORMAT)

    try:
        out = await crawl_package(session, package, existing)
    except Exception as e:
        out = {**existing}
        out["failing_since"] = existing.get("failing_since", now_string)

        # We mark errors as fatal if we MUST de-list the package immediately.
        # - 404s because all release assets we might have collected will also 404.
        # - HeartAttacks because of a vulnerability
        if isinstance(e, aiohttp.ClientResponseError):
            err(
                f"HTTP error during crawl for {package['name']}: "
                f"{e.status} {e.message.removesuffix('.')}", end=". "
            )
            fatal = "fatal: " if e.status == 404 else ""
            out["fail_reason"] = f"{fatal}{e.status} {e.message}"
        elif isinstance(e, HeartAttack):
            err(f"Heart attack during crawl for {package['name']}: {e}")
            out["fail_reason"] = f"fatal: {e}"
        else:
            err(f"Exception while crawling {package['name']}")
            tb = traceback.format_exc()
            out["fail_reason"] = f"Unhandled exception: {type(e).__name__}: {e}\n{tb}"

        # Determine next_crawl interval
        failing_since_dt = (
            datetime
            .strptime(out["failing_since"], UTC_FORMAT)
            .replace(tzinfo=timezone.utc)
        )
        age = now - failing_since_dt

        if age <= timedelta(hours=3):
            interval = timedelta(hours=1)
        elif age <= timedelta(hours=24):
            interval = timedelta(hours=3)
        elif age <= timedelta(days=14):
            interval = timedelta(hours=6)
        else:
            interval = timedelta(hours=24)

        out["next_crawl"] = (now + interval).strftime(UTC_FORMAT)
        hours = int(interval.total_seconds() // 3600)
        err(f"Retrying in {pl(hours, 'hours')}.")
        return out

    out["first_seen"] = existing.get("first_seen", now_string)
    out["last_seen"] = now_string
    # TODO: We need to think about if "fatal" states can be recovered from.
    #       The tendency is that 404's and `HeartAttack`s are final states.
    if not out.get("fail_reason", "").startswith("fatal: "):
        out.pop("failing_since", None)
        out.pop("fail_reason", None)

    releases = out["releases"]
    if not releases:
        err(f"No releases found for {out['name']}")
        out["invalid"] = True
        out["next_crawl"] = (now + timedelta(hours=3)).strftime(UTC_FORMAT)
    else:
        out["last_modified"] = max((r["date"] for r in releases))

        # Determine next_crawl interval
        last_modified_dt = (
            datetime
            .strptime(out["last_modified"], UTC_FORMAT)
            .replace(tzinfo=timezone.utc)
        )
        age = now - last_modified_dt

        if age <= timedelta(days=14):
            next_crawl = now + timedelta(hours=1)
        elif age <= timedelta(days=90):
            next_crawl = now + timedelta(hours=2)
        elif age <= timedelta(days=365 * 4):
            next_crawl = next_run(out["name"], window=timedelta(hours=3), now=now)
        else:
            next_crawl = next_run(out["name"], window=timedelta(days=1), now=now)

        out["next_crawl"] = next_crawl.strftime(UTC_FORMAT)

    return out


async def crawl_package(
    session: aiohttp.ClientSession,
    entry: PackageEntryV1,
    existing: PackageEntry
) -> PackageEntry:
    out: PackageEntry = {**entry}  # type: ignore[typeddict-item]
    if "readme" in out:
        out["readme"] = update_url(  # type: ignore[typeddict-unknown-key]
            resolve_url(out["source"], out["readme"])  # type: ignore[typeddict-item]
        )
    details = out.get("details")
    release_definitions: list[ReleaseDescription] = \
        out.get("releases", [])  # type: ignore[assignment]
    migrate_release_definitions_from_v2(release_definitions)
    normalize_release_definition(release_definitions, out["source"], details)

    uow: defaultdict[Url, set[QueryScope]] = defaultdict(set)
    if details:
        uow[details].add("METADATA")

    for r in release_definitions[:]:
        if is_fulfilled_release_definition(r):
            continue
        if base := r.get("base"):
            uow[base].add("METADATA")
            if "tags" in r:
                uow[base].add("TAGS")
            if "branch" in r:
                uow[base].add("BRANCHES")
            if "asset" in r:
                uow[base].add("RELEASES")

    type HubRepoInfo = GithubRepoInfo | BitbucketRepoInfo | GitlabRepoInfo | CodebergRepoInfo
    for url, scopes in uow.items():
        info: HubRepoInfo
        match which_hub(url):
            case "github":
                hints = existing.get("hints", [])
                info = await fetch_github_info(session, url, scopes, hints=hints)
            case "bitbucket":
                info = await fetch_bitbucket_info(session, url, scopes)  # type: ignore[arg-type]
            case "gitlab":
                info = await fetch_gitlab_info(session, url, scopes)  # type: ignore[arg-type]
            case "codeberg":
                info = await fetch_codeberg_info(session, url, scopes)  # type: ignore[arg-type]
            case _:
                err(f"Backend for {url} not implemented yet")
                continue

        if url == details:
            if info["metadata"].get("homepage", "").startswith(
                "https://packagecontrol.io/packages/"
            ):
                info["metadata"].pop("homepage")

            out = info["metadata"] | out  # type: ignore[assignment]
            if (
                existing.get("id")
                and existing.get("id") != out.get("id")
                and existing.get("details") == details
            ):
                # Allowed: URL changes with same ID (renames/transfers).
                # Allowed: URL+ID both change (registry move).
                # Allowed: missing existing ID on first crawl.
                # Deny: same URL with different ID (takeover risk).
                raise HeartAttack(
                    f"Repository ID mismatch for {details}: "
                    f"{existing.get('id')} != {out.get('id')}"
                )

            if existing.get("hints", []) != out.get("hints", []):
                hints = out.get("hints", [])
                err(f"Hints for {url} changed to: {', '.join(hints) if hints else 'None'}")

        for r in release_definitions[:]:
            if is_fulfilled_release_definition(r):
                continue
            if r.get("base") != url:
                continue

            if asset_pattern := r.get("asset"):
                if "releases" not in info:
                    err(f"Release assets are not supported for {url}")
                    release_definitions.remove(r)
                    continue

                st_builds = r.get("sublime_text", "*")
                if isinstance(st_builds, str):
                    st_builds = [st_builds]
                platforms = r.get("platforms", ["*"])
                targets = list(product(platforms, st_builds))

                tag_definition = r.get("tags", True)
                tag_prefix = "" if tag_definition is True else tag_definition

                spec_set = None
                if version_spec := r.get("version"):
                    normalized_spec = normalize_version_spec(version_spec)
                    spec_set = SpecifierSet(normalized_spec) if normalized_spec else None

                resolved_releases: list[dict] = []
                async for release in info["releases"]:  # type: ignore[typeddict-item]
                    if release.get("is_draft"):
                        continue
                    tag_name = release.get("tag_name")
                    if not tag_name:
                        continue
                    tag_match = match_tag_version(tag_name, tag_prefix)
                    if not tag_match:
                        continue
                    version, version_str = tag_match
                    if spec_set and not spec_set.contains(version, prereleases=True):
                        continue
                    assets = release.get("assets", [])

                    for platform, st_build in targets[:]:
                        if asset := match_release_asset_pattern(
                            assets,
                            asset_pattern,
                            version_str,
                            normalize_st_build(st_build),
                            "any" if platform == "*" else platform
                        ):
                            r_ = {
                                "sublime_text": st_build,
                                "platforms": [platform],
                                "version": version_str,
                                "url": asset["url"],
                                "date": release["date"],
                            }
                            resolved_releases.append(r_)
                            targets.remove((platform, st_build))

                    if not targets:
                        break

                if targets:
                    missing_formatted = (
                        f"({platform}, st_build={build})"
                        for platform, st_build in sorted(targets)
                        if (
                            build := st_build
                            if st_build == "*" or st_build.isnumeric()
                            else repr(st_build)
                        )
                    )
                    err(f"Missing release assets for {url} for: {', '.join(missing_formatted)}")

                if resolved_releases:
                    first = resolved_releases[0]
                    r.clear()
                    r.update(first)
                    for extra in resolved_releases[1:]:
                        release_definitions.append(extra)
                else:
                    err(f"No matching release asset found for {url}")
                    release_definitions.remove(r)
                continue

            tag_error = None

            if tag_definition := r.get("tags"):
                tag_prefix = "" if tag_definition is True else tag_definition
                # preleases are rare, but if used there can be many pre-releases
                # before a valid final release.  We only need the first (newest)
                # one, and `prerelease_pushed` is used to track that.
                prerelease_pushed = False
                prerelease_version = None
                async for tag in info["tags"]:
                    if (
                        tag["name"].startswith(tag_prefix)
                        and (version_string := (
                            tag["name"].removeprefix(tag_prefix)
                            if tag_prefix
                            else tag["name"].removeprefix("v")
                        ))
                        and (version := parse_version(version_string))  # type: ignore[assignment]
                    ):
                        if version.is_prerelease and not prerelease_pushed:
                            r_ = deepcopy(r)
                            r_.pop("tags")
                            r_ |= pluck(tag, ("url", "date"))  # type: ignore[arg-type]
                            r_ |= {"version": version_string}
                            release_definitions.append(r_)
                            prerelease_pushed = True
                            prerelease_version = version_string
                            continue

                        elif version.is_final:
                            r.pop("tags")
                            r |= pluck(tag, ("url", "date"))  # type: ignore[arg-type]
                            r |= {"version": version_string}
                            break

                if "version" in r:
                    continue

                if prerelease_pushed:
                    version_note = f" {prerelease_version}" if prerelease_version else ""
                    err(f"No final tag found for {url}; using prerelease{version_note}.")
                    continue

                if tag_prefix:
                    tag_error = f"No tag found for {url} matching the prefix ^{tag_prefix}"
                else:
                    tag_error = f"No valid version found for {url}"

            # `True` == Fallback to the default branch
            branches_definition = r.get("branch", True)
            default_branch = info["metadata"].get("default_branch", "master")
            wanted_branch = (
                default_branch
                if branches_definition is True
                else branches_definition
            )
            async for branch in info["branches"]:
                if branch["name"] == wanted_branch:
                    r.pop("branch", None)
                    branch_version = re.sub(r"\D", ".", branch["date"]).rstrip(".")
                    r |= pluck(branch, ("url", "date"))  # type: ignore[arg-type]
                    r |= {"version": branch_version}
                    break

            if "version" in r:
                if tag_error:
                    err(f"{tag_error}.  Falling back to tip of {wanted_branch}.")
                continue

            if tag_error:
                err(f"{tag_error}.  Release definition cannot be fulfilled.")
            else:
                err(
                    f"No branch named {wanted_branch} found on {url}.  "
                    f"Release definition cannot be fulfilled."
                )
            release_definitions.remove(r)

    for r in release_definitions[:]:
        if missing_keys := missing_from_release_definition(r):
            s = "s" if len(missing_keys) > 1 else ""
            err(
                f"Release definition for *{entry['name']}* incomplete.  "
                f"Got `{r}`. "
                f"Missing key{s}: `{', '.join(missing_keys)}`."
            )
            release_definitions.remove(r)

    return out


def pluck[K, V](d: dict[K, V], keys: Iterable[K]) -> dict[K, V]:
    return {
        k: v
        for k, v in d.items()
        if k in keys
    }


def missing_from_release_definition(release: ReleaseDescription) -> set[str]:
    return {"sublime_text", "platforms", "version", "url", "date"} - release.keys()


def is_fulfilled_release_definition(release: ReleaseDescription) -> bool:
    return not (
        "tags" in release
        or "branch" in release
        or missing_from_release_definition(release)
    )


def normalize_release_definition(
    releases: list[ReleaseDescription],
    repo_url: str,
    details: str | None = None
):
    for r in releases[:]:
        r.setdefault("platforms", ["*"])
        if isinstance(r["platforms"], str):
            r["platforms"] = [r["platforms"]]

        r.setdefault("sublime_text", "*")
        if isinstance(r["sublime_text"], list):
            if "asset" not in r:
                err(f"sublime_text as a list is only valid in conjunction with 'asset', {repo_url}")
                releases.remove(r)

        if base := r.get("base", details):
            r["base"] = resolve_url(repo_url, base)

        if "url" in r:
            r["url"] = update_url(resolve_url(repo_url, r["url"]))

        if "date" in r:
            try:
                r["date"] = normalize_datetime_str(r["date"])
            except ValueError:
                err(f"date {r['date']} is not formatted correctly, {repo_url}")
                releases.remove(r)


def compile_release_asset_pattern(
    pattern: str,
    version: str,
    st_build: str,
    platform: str,
) -> re.Pattern:
    pattern = pattern.replace("${version}", version)
    pattern = pattern.replace("${st_build}", st_build)
    pattern = pattern.replace("${platform}", platform)
    pattern = pattern.replace(".", r"\.")
    pattern = pattern.replace("?", r".")
    pattern = pattern.replace("*", r".*?")
    return re.compile(pattern)


def match_release_asset_pattern(
    assets: list[ReleaseAssetInfo],
    pattern: str,
    version: str,
    st_build: str,
    platform: str,
) -> ReleaseAssetInfo | None:
    re_pattern = compile_release_asset_pattern(pattern, version, st_build, platform)
    for asset in assets:
        asset_name = asset.get("name")
        if asset_name and re_pattern.match(asset_name):
            return asset
    return None


def normalize_datetime_str(dt_str: str) -> str:
    formats = [
        STYLIZED_DATETIME_FORMAT,  # full format
        "%Y-%m-%d %H:%M",          # missing seconds
        "%Y-%m-%d",                # date only
    ]
    try:
        datetime.strptime(dt_str, UTC_FORMAT)
    except ValueError:
        for fmt in formats:
            try:
                dt = datetime.strptime(dt_str, fmt)
                return dt.strftime(UTC_FORMAT)
            except ValueError:
                continue
    else:
        return dt_str

    raise ValueError(f"Unrecognized datetime format: {dt_str!r}")


def migrate_release_definitions_from_v2(releases: list[ReleaseDescription]) -> str | None:
    # if details is set it is a hub url
    #  e.g. https://github.com/accerqueira/sublime-test-runner/tags to fetch tags
    #       translates to {
    #           "tags": true,
    #           "base": "https://github.com/accerqueira/sublime-test-runner"
    #       }
    #  or   https://github.com/Andr3as/Sublime-SurroundWith/tree/master to fetch a branch
    #       translates to {
    #           "branch": "master",
    #           "base": "https://github.com/Andr3as/Sublime-SurroundWith"
    #       }
    for r in releases[:]:
        if details := r.pop("details", None):
            match which_hub(details):
                case "github":
                    # Handle GitHub tags URL
                    if details.endswith("/tags"):
                        r.update({"tags": True, "base": details[:-5]})
                    # Handle GitHub branch URL
                    elif "/tree/" in details:
                        base, branch = details.split("/tree/", 1)
                        r.update({"branch": branch, "base": base})
                    else:
                        r.update({"branch": True, "base": details})
                case _:
                    # The current registry does not list any other hub types
                    # so we don't have to handle them
                    err("v2 migration not implemented for", details)
                    releases.remove(r)

    return next((r["base"] for r in releases if "base" in r), None)


def which_hub(url: str) -> str:
    # Determine the hub type based on the URL
    if "github.com" in url:
        return "github"
    if "gitlab.com" in url:
        return "gitlab"
    if "bitbucket.org" in url:
        return "bitbucket"
    if "codeberg.org" in url:
        return "codeberg"
    return "unknown"


def parse_args():
    parser = argparse.ArgumentParser(description="Crawl the registry and update the workspace.")
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
        "--name",
        type=str,
        default=None,
        help=(
            "Optional name of a package to crawl. "
            "If not provided, all packages will be crawled."))
    parser.add_argument(
        "--limit", "-n",
        type=int,
        default=200,
        help="Maximum number of packages to crawl (default: 200)")
    parser.add_argument(
        "--presto",
        action=argparse.BooleanOptionalAction,
        default=env_flag("PRESTO_PRESTO_CRAWL", False),
        help=(
            "Bypass next_crawl scheduling and take up to --limit packages. "
            "Defaults to PRESTO_PRESTO_CRAWL env var."
        ),
    )
    parser.add_argument(
        "--wd",
        type=str,
        default=".",
        help="Working directory to resolve file paths (default: .)"
    )
    return parser.parse_args()


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


if __name__ == "__main__":
    args = parse_args()
    wd = os.path.abspath(args.wd)
    os.makedirs(wd, exist_ok=True)
    args.registry = os.path.normpath(os.path.join(wd, args.registry))
    args.workspace = os.path.normpath(os.path.join(wd, args.workspace))
    asyncio.run(main(args.registry, args.workspace, args.name, args.limit, args.presto))
