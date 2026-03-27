import aiohttp
import argparse
import asyncio
from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from functools import partial
from itertools import product
import json
import os
import re
import sys
from typing import Any, Literal, Mapping, NotRequired, Required, TypedDict

import packaging
from packaging.specifiers import SpecifierSet

from .bitbucket import fetch_bitbucket_info, RepoInfo as BitbucketRepoInfo
from .generate_registry import Registry, PackageEntry as RegistryEntry
from .github import (
    fetch_github_info, rate_limit_info,
    RepoInfo as GithubRepoInfo, ReleaseAssetInfo
)
from .gitlab import fetch_gitlab_info, RepoInfo as GitlabRepoInfo
from .codeberg import fetch_codeberg_info, RepoInfo as CodebergRepoInfo
from ._resolve_lib import (
    match_tag_version,
    normalize_st_build,
    normalize_version_spec,
)
from ._utils import (
    format_name_list, parse_version, resolve_url, update_url, write_json, pl, pick,
    VersionInfo,
)
from ._explain_package import print_package_explain
import traceback


DEFAULT_REGISTRY = "./registry.json"
DEFAULT_WORKSPACE = "./workspace.json"
EXPLAIN_EFFECTIVE_ENV = "EFFECTIVE"
UTC_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
STYLIZED_DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S"
MAIN_REPOSITORY_SOURCE = (
    "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
)
TRUSTED_SOURCES = {
    MAIN_REPOSITORY_SOURCE,
    "https://raw.githubusercontent.com/sublimelsp/repository/main/repository.json",
    "https://raw.githubusercontent.com/SublimeLinter/package_control_channel/master/packages.json",
}

type PackageName = str
type Url = str
type IsoTimestamp = str
type Version = str
type BuildDescriptor = str
type Platform = Literal["*", "windows", "osx", "linux"]
type ErrorMsg = str
type ReleaseDescription = dict
type HubRepoInfo = GithubRepoInfo | BitbucketRepoInfo | GitlabRepoInfo | CodebergRepoInfo


class Release(TypedDict, total=False):
    sublime_text: BuildDescriptor
    platforms: list[str]
    version: Version
    url: Url
    date: IsoTimestamp


class WorkspaceEntry(TypedDict, total=False):
    id: NotRequired[str]
    name: Required[str]
    details: NotRequired[Url]
    releases: list[Release]

    source: Url
    schema_version: str

    fetching_source_failed: NotRequired[IsoTimestamp]  # fetching repo source failed
    removed: NotRequired[IsoTimestamp]                 # not listed in the registry anymore
    first_seen: IsoTimestamp
    last_seen: IsoTimestamp
    next_crawl: IsoTimestamp
    last_modified: IsoTimestamp
    update_detected: IsoTimestamp
    failing_since: IsoTimestamp
    fail_reason: str

    # 'hints' are meant as a storage for additional 'hub' info
    hints: NotRequired[list[str]]


class Workspace(TypedDict):
    packages: dict[PackageName, WorkspaceEntry]
    libraries: dict


class HeartAttack(Exception):
    """Raised when a repository ID mismatch is detected."""
    pass


class DeniedUpdating(Exception):
    """Raised when a package update is denied but should be recoverable."""
    pass


class SkipCrawling(Exception):
    """Raised when a package crawl should be skipped while keeping prior state."""
    pass


def err(*args, **kwargs) -> None:
    print(*args, **kwargs, file=sys.stderr)


def explain_main(registry: str, name: str) -> int:
    if not os.path.exists(registry):
        err(f"FATAL: Registry file '{registry}' does not exist.")
        return 1

    try:
        with open(registry, "r") as reg_file:
            registry_data = json.load(reg_file)
    except Exception as e:
        err(f"FATAL: Could not read registry file '{registry}': {e}")
        return 1

    package = find_registry_package(registry_data, name)
    if not package:
        err(f"Package '{name}' not found in registry.")
        return 1

    normalized = normalize_registry_entry(deepcopy(package))
    if env_flag(EXPLAIN_EFFECTIVE_ENV):
        print_package_explain_effective(name, normalized)  # type: ignore[arg-type]
        return 0

    print_package_explain(name, package, normalized)  # type: ignore[arg-type]
    return 0


def print_package_explain_effective(name: str, normalized: dict[str, Any]) -> None:
    releases = normalized.get("releases", [])
    sorted_releases = sorted_release_definitions(releases)
    tags_mode = classify_tags_mode(sorted_releases)

    normalized_effective = deepcopy(normalized)
    normalized_effective["releases"] = keep_newest_release_definitions(sorted_releases)

    if tags_mode:
        effectively = "(effectively) " if tags_mode == "effective" else ""
        print(f"{name} uses {effectively}the tags-mode.")
    print(json.dumps(normalized_effective, ensure_ascii=False, sort_keys=True))


def classify_tags_mode(
    sorted_releases: list[dict[str, Any]],
) -> bool | Literal["effective"]:
    if not sorted_releases:
        return False

    if all(release_uses_tags_mode(release) for release in sorted_releases):
        return True

    if release_uses_tags_mode(sorted_releases[-1]):
        return "effective"

    return False


def sorted_release_definitions(releases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(releases, key=release_definition_sort_key)


def keep_newest_release_definitions(
    releases: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not releases:
        return []

    newest_build = parse_sublime_text_max(releases[-1].get("sublime_text"))
    return [
        release
        for release in releases
        if parse_sublime_text_max(release.get("sublime_text")) == newest_build
    ]


def release_definition_sort_key(release: dict[str, Any]) -> tuple[float, str]:
    return (
        parse_sublime_text_max(release.get("sublime_text")),
        tags_sort_value(release.get("tags")),
    )


def tags_sort_value(value: Any) -> str:
    # Place plain `True` after common prefixes like `st2-`.
    if value is True:
        return "~~true"
    if isinstance(value, str):
        return value
    return ""


def release_uses_tags_mode(release: dict[str, Any]) -> bool:
    return bool(release.get("tags", False))


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
        package = find_registry_package(registry, name)
        if not package:
            err(f"Package '{name}' not found in registry.")
            return
        tocrawl = [package]
    else:
        maintenance(registry, workspace)
        tocrawl = next_packages_to_crawl(registry, workspace, limit=limit, presto=presto)

    updated_packages: list[str] = []
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
            if "update_detected" in new_entry:
                updated_packages.append(new_entry["name"])
            if name_requested:
                print(json.dumps(new_entry, indent=2, ensure_ascii=False))

    print("---")
    print(
        f"{pl(len(workspace['packages'].keys()), 'packages')} "
        f"and {pl(len(workspace.get('libraries', {}).keys()), 'libraries')} "
        f"in db."
    )

    updated_packages = sorted(updated_packages)
    if updated_packages:
        s = "" if len(updated_packages) == 1 else "s"
        print(f"Found update{s} for {format_name_list(updated_packages)}.")

    if len(tocrawl) > 0:
        print("GitHub", rate_limit_info)


def next_packages_to_crawl(
    registry: Registry, workspace: Workspace, limit: int = 200, presto: bool = False
) -> list[RegistryEntry]:
    """
    Returns a list of packages to crawl, sorted by next_crawl timestamp.
    If next_crawl is not set, it defaults to the current time.
    """
    now = now_ts()
    now_string = now.strftime(UTC_FORMAT)
    packages = registry["packages"]
    packages_to_crawl = [
        entry
        for entry in packages
        if not entry.get("fetching_source_failed")
        if "removed" not in entry
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
                if "removed" not in entry
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
    # lookup all packages in workspace and mark them as `removed`
    # if they have been removed from the registry
    now = now_ts()
    now_string = now.strftime(UTC_FORMAT)
    current_package_names = {entry["name"] for entry in registry["packages"]}
    packages = workspace["packages"]
    for name in packages.keys() - current_package_names:
        packages[name].setdefault("removed", now_string)


async def crawl(
    session: aiohttp.ClientSession,
    package: RegistryEntry,
    existing: WorkspaceEntry
) -> WorkspaceEntry:
    out: WorkspaceEntry
    now = now_ts()
    now_string = now.strftime(UTC_FORMAT)

    try:
        out = await crawl_package(session, package, existing)
    except Exception as e:
        out = {**existing}

        # Keep existing source authoritative when present (important for denied
        # source moves). Only backfill source from the registry package when
        # the existing workspace entry has never had one.
        out.setdefault("source", package["source"])

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
        elif isinstance(e, SkipCrawling):
            err(f"skip *{package['name']}*: {e}")
        elif isinstance(e, DeniedUpdating):
            err(f"Denied update during crawl for {package['name']}: {e}")
            out["fail_reason"] = f"denied: {e}"
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

    releases = out["releases"]
    if not releases:
        err(f"No releases found for {out['name']}")
        out["next_crawl"] = (now + timedelta(hours=3)).strftime(UTC_FORMAT)
    else:
        out["last_modified"] = max((r["date"] for r in releases))

        previous_last_modified = existing.get("last_modified")
        if previous_last_modified and out["last_modified"] != previous_last_modified:
            out["update_detected"] = now_string

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
            next_crawl = now + timedelta(hours=3)
        else:
            next_crawl = now + timedelta(days=1)

        out["next_crawl"] = next_crawl.strftime(UTC_FORMAT)

    return out


async def crawl_package(
    session: aiohttp.ClientSession,
    entry: RegistryEntry,
    existing: WorkspaceEntry
) -> WorkspaceEntry:
    now = now_ts()
    maybe_skip_crawling(entry, existing, now)
    ensure_secure_source(entry, existing)

    out = normalize_registry_entry(entry)
    details = out.get("details")
    release_definitions: list[ReleaseDescription] = \
        out.get("releases", [])  # type: ignore[assignment]

    releases: list[Release] = []

    def extend(new_releases: list[Release]):
        for r in new_releases:
            if missing_keys := keys_missing_from_release(r):
                s = "s" if len(missing_keys) > 1 else ""
                err(
                    f"Release for *{entry['name']}* incomplete.  "
                    f"Got `{r}`. "
                    f"Missing key{s}: `{', '.join(missing_keys)}`."
                )
            else:
                releases.append(r)

    uow: defaultdict[Url, list[ReleaseDescription]] = defaultdict(list)
    if details:
        uow[details] = []

    for r in release_definitions:
        if is_fulfilled_release_definition(r):
            extend([r])  # type: ignore[list-item]
        elif base := r.get("base"):
            uow[base].append(r)

    for url, defs in uow.items():
        scopes = {"METADATA"}
        for d in defs:
            if "tags" in r:
                scopes.add("TAGS")
            if "branch" in r:
                scopes.add("BRANCHES")
            if "asset" in r:
                scopes.add("RELEASES")

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

        for r in defs:
            if r.get("asset"):
                resolved_releases = await resolve_assets(info, r)
                extend(resolved_releases)
                if not resolved_releases:
                    err(f"No matching release asset found for {url}")
                continue

            tag_error = None
            if r.get("tags"):
                resolved_releases, tag_error = await resolve_tags(info, r)
                extend(resolved_releases)
                if resolved_releases:
                    continue

            branch_release, wanted_branch = await resolve_branches(info, r)
            if branch_release:
                extend([branch_release])
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

    out["releases"] = releases
    return out


def find_registry_package(registry: Registry, name: str) -> RegistryEntry | None:
    for entry in registry.get("packages", []):
        if entry.get("name") == name:
            return entry
    return None


def normalize_registry_entry(entry: RegistryEntry) -> WorkspaceEntry:
    out: WorkspaceEntry = {**entry}  # type: ignore[typeddict-item]
    if "readme" in out:
        out["readme"] = update_url(  # type: ignore[typeddict-unknown-key]
            resolve_url(out["source"], out["readme"])  # type: ignore[typeddict-item]
        )

    details = out.get("details")
    release_definitions: list[ReleaseDescription] = \
        out.setdefault("releases", [])  # type: ignore[assignment]
    migrate_release_definitions_from_v2(release_definitions)
    normalize_release_definition(release_definitions, out["source"], details)
    return out


async def resolve_tags(
    info: HubRepoInfo,
    definition: ReleaseDescription,
) -> tuple[list[Release], ErrorMsg | None]:
    tag_definition = definition.get("tags")
    if not tag_definition:
        return [], None

    tag_prefix = "" if tag_definition is True else tag_definition
    version_set = None
    if version_spec := definition.get("version"):
        version_set = SpecifierSet(version_spec)

    resolved_releases: list[Release] = []
    now = now_ts()
    cutoff = now - timedelta(weeks=53)

    # We take all releases from the current (rolling) year, but if there
    # aren't any, things get trickier; and we get at most one leading
    # prerelease before exactly one final version.
    prerelease_found: str | None = None
    found_final = False
    async for tag in info["tags"]:
        tag_name = tag["name"]

        is_prerelease = False
        if version_set:
            # For constrained tags, use packaging.Version against SpecifierSet.
            tag_match = match_tag_version(tag_name, tag_prefix)
            if not tag_match:
                continue
            version: packaging.version.Version
            version, version_string = tag_match
            if not version_set.contains(version, prereleases=True):
                continue
            is_final_version = not (version.is_prerelease or version.is_devrelease)
            is_prerelease = version.is_prerelease
        else:
            # Standard tag semantics use our custom, strict semver parser.
            if not tag_name.startswith(tag_prefix):
                continue
            version_string = (
                tag_name.removeprefix(tag_prefix)
                if tag_prefix
                else tag_name.removeprefix("v")
            )
            version_: VersionInfo | None
            version_ = parse_version(version_string)
            if not version_:
                continue
            is_final_version = version_.is_final
            is_prerelease = version_.is_prerelease

        tag_date = datetime.strptime(tag["date"], UTC_FORMAT).replace(tzinfo=timezone.utc)
        if tag_date < cutoff and found_final:
            break

        if tag_date >= cutoff or (is_final_version or (is_prerelease and not prerelease_found)):
            r_ = deepcopy(definition)
            r_.pop("tags")
            r_ |= pick(("url", "date"), tag)
            r_ |= {"version": version_string}
            resolved_releases.append(r_)  # type: ignore[arg-type]
            if is_final_version:
                found_final = True
            elif is_prerelease:
                prerelease_found = version_string

    if found_final:
        return resolved_releases, None

    if prerelease_found:
        version_note = f" {prerelease_found}" if prerelease_found else ""
        the = "the" if version_note else "a"
        base_url = definition.get("base")
        err(f"No final tag found for {base_url}.  Using {the} pre-release{version_note}.")
        return resolved_releases, None

    base_url = definition.get("base")
    if tag_prefix:
        return [], f"No tag found for {base_url} matching the prefix *{tag_prefix}*"
    return [], f"No valid version found for {base_url}"


async def resolve_branches(
    info: HubRepoInfo,
    definition: ReleaseDescription,
) -> tuple[Release | None, str]:
    # `True` == Fallback to the default branch
    branches_definition = definition.get("branch", True)
    default_branch = info["metadata"].get("default_branch", "master")
    wanted_branch = (
        default_branch
        if branches_definition is True
        else branches_definition
    )
    async for branch in info["branches"]:
        if branch["name"] == wanted_branch:
            resolved = deepcopy(definition)
            resolved.pop("branch", None)
            branch_version = re.sub(r"\D", ".", branch["date"]).rstrip(".")
            resolved |= pick(("url", "date"), branch)
            resolved |= {"version": branch_version}
            return resolved, wanted_branch  # type: ignore[return-value]
    return None, wanted_branch


async def resolve_assets(
    info: HubRepoInfo,
    definition: ReleaseDescription,
) -> list[Release]:
    base_url = definition.get("base")
    asset_pattern = definition.get("asset")
    if not asset_pattern:
        return []
    if "releases" not in info:
        err(f"Release assets are not supported for {base_url}")
        return []

    st_builds = definition.get("sublime_text", "*")
    if isinstance(st_builds, str):
        st_builds = [st_builds]
    platforms = definition.get("platforms", ["*"])
    targets = list(product(platforms, st_builds))

    tag_definition = definition.get("tags", True)
    tag_prefix = "" if tag_definition is True else tag_definition

    spec_set = None
    if version_spec := definition.get("version"):
        spec_set = SpecifierSet(version_spec)

    resolved_releases: list[Release] = []
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
                resolved_releases.append({
                    "sublime_text": st_build,
                    "platforms": [platform],
                    "version": version_str,
                    "url": asset["url"],
                    "date": release["date"],
                })
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
        err(f"Missing release assets for {base_url} for: {', '.join(missing_formatted)}")

    return resolved_releases


def maybe_skip_crawling(
    entry: RegistryEntry,
    existing: WorkspaceEntry,
    now: datetime
) -> None:
    fail_reason = existing.get("fail_reason", "")
    if not fail_reason.startswith("fatal: "):
        return
    resurrecting = (
        (existing_details := existing.get("details"))
        and (entry_details := entry.get("details"))
        and (entry_source := entry.get("source"))
        and existing_details != entry_details
        and (
            entry_source == existing.get("source")
            or entry_source in TRUSTED_SOURCES
        )
    )
    if resurrecting:
        return
    if fail_reason.startswith("fatal: 404"):
        # For 404's we have "auto-resurrection" aka retries for 30 days
        if failing_since := existing.get("failing_since"):
            try:
                failing_since_dt = datetime.strptime(failing_since, UTC_FORMAT)
            except ValueError:
                pass
            else:
                failing_since_dt = failing_since_dt.replace(tzinfo=timezone.utc)
                if now - failing_since_dt >= timedelta(days=30):
                    raise SkipCrawling(fail_reason)
    else:
        raise SkipCrawling(fail_reason)


def ensure_secure_source(
    entry: RegistryEntry,
    existing: WorkspaceEntry
) -> None:
    existing_source = source_for_security_check(existing)
    entry_source = entry.get("source")
    if (
        existing_source
        and entry_source
        and existing_source != entry_source
        and entry_source not in TRUSTED_SOURCES
    ):
        source_display = existing.get("source") or "<not-set>"
        raise DeniedUpdating(
            f"Repository source changed for *{entry.get('name')}* from "
            f"{source_display} to untrusted {entry_source}"
        )


def source_for_security_check(existing: WorkspaceEntry) -> str | None:
    source = existing.get("source")
    if source:
        return source

    if existing.get("removed"):
        # Old imported tombstones can miss source.
        # For security checks we treat them as coming from the main trusted source.
        return MAIN_REPOSITORY_SOURCE

    return None


def keys_missing_from_release(release: Mapping) -> set[str]:
    return {"sublime_text", "platforms", "version", "url", "date"} - release.keys()


def is_fulfilled_release_definition(release: ReleaseDescription) -> bool:
    return not (
        "tags" in release
        or "branch" in release
        or keys_missing_from_release(release)
    )


def normalize_release_definition(
    releases: list[ReleaseDescription],
    repo_url: str,
    details: str | None = None
):
    normalize_ = partial(normalize_release_entry, releases, repo_url, details)

    if not releases:
        releases.append({
            "sublime_text": "*",
            "tags": True
        })

    auto_release = maybe_make_auto_open_ended_tags_release(releases)

    for release in releases[:]:
        normalize_(release)

    if auto_release:
        normalize_(auto_release)
        releases.append(auto_release)


def normalize_release_entry(
    releases: list[ReleaseDescription],
    repo_url: str,
    details: str | None,
    release: ReleaseDescription,
) -> None:
    release.setdefault("platforms", ["*"])
    if isinstance(release["platforms"], str):
        release["platforms"] = [release["platforms"]]

    release.setdefault("sublime_text", "*")
    if isinstance(release["sublime_text"], list) and "asset" not in release:
        err(f"sublime_text as a list is only valid in conjunction with 'asset', {repo_url}")
        releases.remove(release)
        return

    if release.keys().isdisjoint({"url", "asset", "branch", "tags"}):
        release["tags"] = True

    if "url" not in release and (version_spec := release.get("version")):
        release["version"] = normalize_version_spec(version_spec)

    if base := release.get("base", details):
        release["base"] = resolve_url(repo_url, base)

    if "url" in release:
        release["url"] = update_url(resolve_url(repo_url, release["url"]))

    if "date" in release:
        try:
            release["date"] = normalize_datetime_str(release["date"])
        except ValueError:
            err(f"date {release['date']} is not formatted correctly, {repo_url}")
            releases.remove(release)


def maybe_make_auto_open_ended_tags_release(
    releases: list[ReleaseDescription],
) -> ReleaseDescription | None:
    max_build = -1

    for release in releases:
        if release.get("version", "") in ("*", ""):
            return None

        if "url" in release or "asset" in release or "branch" in release:
            return None

        if release.get("tags") is True:
            return None

        st_max = parse_sublime_text_max(release.get("sublime_text"))
        if st_max == float("inf"):
            return None

        max_build = max(max_build, int(st_max))

    if max_build < 0:
        return None

    return {
        "sublime_text": f">{max_build}",
        "tags": True,
    }


def parse_sublime_text_max(selector) -> float:
    if not isinstance(selector, str):
        return float("inf")

    s = re.sub(r"\s+", "", selector)
    if s in ("", "*"):
        return float("inf")

    range_index = s.find("-")
    if range_index != -1:
        right = s[range_index + 1:]
        n = parse_int_prefix(right)
        return float(n) if n is not None else float("inf")

    if s.startswith("<="):
        n = parse_int_prefix(s[2:])
        return float(n) if n is not None else float("inf")

    if s.startswith("<"):
        n = parse_int_prefix(s[1:])
        return float(max(0, n - 1)) if n is not None else float("inf")

    if s.startswith(">=") or s.startswith(">"):
        return float("inf")

    n = parse_int_prefix(s)
    return float(n) if n is not None else float("inf")


def parse_int_prefix(text: str) -> int | None:
    if match := re.match(r"^\d+", text):
        return int(match.group(0))
    return None


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


def parse_args(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(
        description="Crawl the registry and update the workspace.",
        epilog="Numeric shorthand: -<n> sets crawl limit, e.g. -1000 == --limit 1000.",
    )
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
        "--explain",
        type=str,
        default=None,
        help=(
            "Show the normalized package entry for the named package and "
            "exit without writing the workspace. Set "
            f"{EXPLAIN_EFFECTIVE_ENV}=1 to print a short machine-friendly variant."
        ),
    )
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
    normalized_argv = normalize_limit_argv(sys.argv[1:] if argv is None else argv)
    if count_limit_occurrences(normalized_argv) > 1:
        parser.error("--limit/-n can only be specified once")

    args = parser.parse_args(normalized_argv)
    if args.name and args.explain:
        parser.error("Use either --name or --explain, not both")
    return args


def normalize_limit_argv(argv: list[str]) -> list[str]:
    normalized = []
    for arg in argv:
        if re.fullmatch(r"-\d+", arg):
            normalized.extend(["--limit", arg[1:]])
            continue
        normalized.append(arg)
    return normalized


def count_limit_occurrences(argv: list[str]) -> int:
    count = 0
    for arg in argv:
        if arg in {"--limit", "-n"}:
            count += 1
        elif arg.startswith("--limit="):
            count += 1
    return count


def now_ts() -> datetime:
    if value := os.getenv("NOW_TS"):
        return datetime.fromtimestamp(float(value.strip()), tz=timezone.utc)
    return datetime.now(timezone.utc)


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

    if args.explain:
        raise SystemExit(explain_main(args.registry, args.explain))

    asyncio.run(main(args.registry, args.workspace, args.name, args.limit, args.presto))
