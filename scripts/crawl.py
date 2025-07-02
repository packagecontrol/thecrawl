import aiohttp
import argparse
import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import json
import os
import sys
from typing import Iterable, Literal, NotRequired, Required, TypedDict


from .bitbucket import fetch_bitbucket_info
from .generate_registry import Registry, PackageEntry as PackageEntryV1
from .github import fetch_github_info, fetch_batched_github_info, create_safe_alias, is_semver, rate_limit_info, strip_possible_prefix, QueryScope
from .gitlab import fetch_gitlab_info
from .utils import resolve_url, update_url
import traceback


DEFAULT_REGISTRY = "./registry.json"
DEFAULT_WORKSPACE = "./workspace.json"

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
    name: Required[str]
    details: NotRequired[Url]
    releases: list[Release]

    source: Url
    schema_version: str

    tombstoned: NotRequired[bool]       # fetching the repository failed
    removed: NotRequired[IsoTimestamp]  # not listed in the registry anymore
    invalid: NotRequired[bool]
    first_seen: IsoTimestamp
    last_seen: IsoTimestamp
    next_crawl: IsoTimestamp
    last_modified: IsoTimestamp
    failing_since: IsoTimestamp
    fail_reason: str


class Workspace(TypedDict):
    packages: dict[PackageName, PackageEntry]
    dependencies: list[PackageEntry]


def err(*args, **kwargs) -> None:
    print(*args, **kwargs, file=sys.stderr)


async def main(registry: str, workspace: str, name: str | None, limit: int = 200) -> None:
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
        workspace_data = {"packages": {}, "dependencies": []}

    try:
        await main_(registry_data, workspace_data, name, limit)
    finally:
        with open(workspace, 'w') as ws_file:
            json.dump(workspace_data, ws_file, indent=2)


async def main_(registry: Registry, workspace: Workspace, name: str | None, limit: int) -> None:
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
        tocrawl = next_packages_to_crawl(registry, workspace, limit=limit)

    async with aiohttp.ClientSession() as session:
        # Use batched crawling for better API efficiency
        batch_size = 10  # Number of GitHub repos to batch together
        results = await crawl_packages_batched(
            session, tocrawl, workspace["packages"], batch_size
        )
        
        for new_entry in results:
            workspace["packages"][new_entry["name"]] = new_entry
            if name_requested:
                print(new_entry)

    print("---")
    print(f"{len(workspace['packages'].keys())} packages in db.")

    if len(tocrawl) > 0:
        print("GitHub", rate_limit_info)


def next_packages_to_crawl(
    registry: Registry, workspace: Workspace, limit: int = 200
) -> list[PackageEntryV1]:
    """
    Returns a list of packages to crawl, sorted by next_crawl timestamp.
    If next_crawl is not set, it defaults to the current time.
    """
    now = datetime.now(timezone.utc)
    now_string = now.strftime("%Y-%m-%d %H:%M:%S")
    packages = registry["packages"]
    packages_to_crawl = [
        entry
        for entry in packages
        if not entry.get("tombstoned", False)
        if (
            workspace["packages"]
            .get(entry["name"], {})
            .get("next_crawl", now_string)
            <= now_string
        )
    ]
    print(
        f"Found {len(packages_to_crawl)} packages to crawl.",
        f"Pick {limit} of them." if limit < len(packages_to_crawl) else ""
    )
    if len(packages_to_crawl) == 0:
        if next_package := next(iter(sorted(
            (
                entry
                for entry in packages
                if not entry.get("tombstoned", False)
            ),
            key=lambda pkg: (
                workspace["packages"]
                .get(pkg["name"], {})
                .get("next_crawl", now_string)
            )
        )), None):
            next_crawl_time = (
                workspace["packages"]
                .get(next_package["name"], {})
                .get("next_crawl", now_string)
            )
            next_crawl_dt = (
                datetime
                .strptime(next_crawl_time, "%Y-%m-%d %H:%M:%S")
                .replace(tzinfo=timezone.utc)
            )
            delta = next_crawl_dt - now
            minutes = int(delta.total_seconds() // 60)
            if minutes > 0:
                print(f"Next package runs in {minutes} minutes.")
            else:
                print(f"Next package runs in {round(delta.total_seconds())} seconds.")


    return sorted(
        packages_to_crawl,
        key=lambda pkg: (
            workspace["packages"]
            .get(pkg["name"], {})
            .get("next_crawl", now_string)
        )
    )[:limit]

def maintenance(registry: Registry, workspace: Workspace) -> None:
    # lookup all packages in workspace and mark them as `removed`
    # if they have been removed from the registry
    now = datetime.now(timezone.utc)
    now_string = now.strftime("%Y-%m-%d %H:%M:%S")
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
    now_string = now.strftime("%Y-%m-%d %H:%M:%S")

    try:
        out = await crawl_package(session, package, existing)
    except Exception as e:
        out = {**existing}
        out["failing_since"] = existing.get("failing_since", now_string)

        if isinstance(e, aiohttp.ClientResponseError):
            err(
                f"HTTP error during crawl for {package['name']}: "
                f"{e.status} {e.message.removesuffix(".")}", end=". "
            )
            out["fail_reason"] = f"{e.status} {e.message}"
        else:
            err(f"Exception while crawling {package['name']}")
            tb = traceback.format_exc()
            out["fail_reason"] = f"Unhandled exception: {type(e).__name__}: {e}\n{tb}"

        # Determine next_crawl interval
        failing_since_dt = (
            datetime
            .strptime(out["failing_since"], "%Y-%m-%d %H:%M:%S")
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

        out["next_crawl"] = (now + interval).strftime("%Y-%m-%d %H:%M:%S")
        hours_str = str(interval.total_seconds() / 3600).removesuffix(".0")
        s = "s" if hours_str != "1" else ""
        err(f"Retrying in {hours_str} hour{s}.")
        return out

    out["first_seen"] = existing.get("first_seen", now_string)
    out["last_seen"] = now_string

    releases = out["releases"]
    if not releases:
        err(f"No releases found for {out['name']}")
        out["invalid"] = True
        out["next_crawl"] = (now + timedelta(hours=3)).strftime("%Y-%m-%d %H:%M:%S")
    else:
        out["last_modified"] = max((r["date"] for r in releases))

        # Determine next_crawl interval
        last_modified_dt = (
            datetime
            .strptime(out["last_modified"], "%Y-%m-%d %H:%M:%S")
            .replace(tzinfo=timezone.utc)
        )
        age = now - last_modified_dt

        if age <= timedelta(days=14):
            interval = timedelta(hours=1)
        elif age <= timedelta(days=90):
            interval = timedelta(hours=2)
        elif age <= timedelta(days=365 * 4):
            interval = timedelta(hours=3)
        else:
            interval = timedelta(hours=24)

        out["next_crawl"] = (now + interval).strftime("%Y-%m-%d %H:%M:%S")

    return out


async def crawl_package(
    session: aiohttp.ClientSession,
    entry: PackageEntryV1,
    existing: PackageEntry
) -> PackageEntry:
    out: PackageEntry = {**entry}
    if "readme" in out:
        out["readme"] = update_url(resolve_url(out["source"], out["readme"]))
    details = out.get("details")
    release_definitions: list[ReleaseDescription] = out.get("releases", [])  # type: ignore[assignment]
    migrate_release_definitions_from_v2(release_definitions)
    reject_asset_definitions_from_v4(release_definitions)
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

    for url, scopes in uow.items():
        match which_hub(url):
            case "github":
                info = await fetch_github_info(session, url, scopes)
            case "bitbucket":
                info = await fetch_bitbucket_info(session, url, scopes)
            case "gitlab":
                info = await fetch_gitlab_info(session, url, scopes)
            case _:
                err(f"Backend for {url} not implemented yet")
                continue

        if url == details:
            out = info["metadata"] | out

        for r in release_definitions[:]:
            if is_fulfilled_release_definition(r):
                continue
            if r.get("base") != url:
                continue

            if tag_defintion := r.get("tags"):
                tag_prefix = "" if tag_defintion is True else tag_defintion
                async for tag in info["tags"]:
                    if (
                        tag["name"].startswith(tag_prefix)
                        and (version := (
                            tag["name"].removeprefix(tag_prefix)
                            if tag_prefix
                            else strip_possible_prefix(tag["name"])
                        ))
                        and is_semver(version)
                    ):
                        r.pop("tags")
                        r |= pluck(tag, ("url", "date"))  # type: ignore[arg-type]
                        r |= {"version": version}
                        break
                if "version" in r:
                    continue

                if tag_prefix:
                    err(f"No prefixed tag found for {url} matching ^{tag_prefix}")
                else:
                    err(f"No tagged version found for {url}")

            # Fallback to the default branch
            branches_defintion = r.get("branch", True)
            default_branch = info["metadata"].get("default_branch", "master")
            wanted_branch = (
                default_branch
                if branches_defintion is True
                else branches_defintion
            )
            async for branch in info["branches"]:
                if branch["name"] == wanted_branch:
                    r.pop("branch", None)
                    r |= pluck(branch, ("version", "url", "date"))  # type: ignore[arg-type]
                    break
            if "version" in r:
                continue

            err(
                f"No branch named {wanted_branch} found on {url}.  "
                f"Release definition cannot be fulfilled."
            )
            release_definitions.remove(r)

    for r in release_definitions[:]:
        if missing_keys := missing_from_release_definition(r):
            s = "s" if len(missing_keys) > 1 else ""
            err(
                f"Release definition {r} for {entry['name']} incomplete.  "
                f"Missing key{s}: {missing_keys}"
            )
            release_definitions.remove(r)

    return out


def pluck[K, V](d: dict[K, V], keys: Iterable[K]) -> dict[K, V]:
    return {
        k: v
        for k, v in d.items()
        if k in keys
    }


def reject_asset_definitions_from_v4(releases: list[ReleaseDescription]):
    for r in releases[:]:
        if "asset" in r:
            err(
                "asset is a v4 thing and not supported right now "
                "(the official registry is still v3)"
            )
            releases.remove(r)


def missing_from_release_definition(release: ReleaseDescription) -> set[str]:
    return {"sublime_text", "platforms", "version", "url", "date"} - release.keys()


def is_fulfilled_release_definition(release: ReleaseDescription) -> bool:
    return not(
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


def normalize_datetime_str(dt_str: str) -> str:
    formats = [
        "%Y-%m-%d %H:%M",     # missing seconds
        "%Y-%m-%d",           # date only
    ]
    try:
        datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")  # full format
    except ValueError:
        for fmt in formats:
            try:
                dt = datetime.strptime(dt_str, fmt)
                return dt.strftime("%Y-%m-%d %H:%M:%S")
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
        if "sublime_text" not in r:
            err("'sublime_text' key not present {r}")
            releases.remove(r)

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
        "--wd",
        type=str,
        default=".",
        help="Working directory to resolve file paths (default: .)"
    )
    return parser.parse_args()


def group_github_requests_for_batching(uow: dict[str, set[QueryScope]], batch_size: int = 10) -> list[dict[str, tuple[str, str, set[QueryScope]]]]:
    """
    Group GitHub repository requests for batching.
    
    Args:
        uow: Dict mapping URL -> set of required scopes
        batch_size: Maximum number of repositories per batch
        
    Returns:
        List of batches, where each batch is a dict mapping alias -> (owner, repo, scopes)
    """
    github_requests = {}
    
    # Filter for GitHub URLs and extract owner/repo
    for url, scopes in uow.items():
        if which_hub(url) == "github":
            try:
                from .github import parse_owner_repo
                owner, repo = parse_owner_repo(url)
                alias = create_safe_alias(owner, repo)
                github_requests[alias] = (owner, repo, scopes)
            except Exception:
                # Skip invalid URLs
                continue
    
    # Group by scope requirements to batch similar requests together
    scope_groups = defaultdict(list)
    for alias, (owner, repo, scopes) in github_requests.items():
        # Create a key from sorted scopes for grouping
        scope_key = tuple(sorted(scopes))
        scope_groups[scope_key].append((alias, owner, repo, scopes))
    
    # Create batches within each scope group
    batches = []
    for scope_key, requests in scope_groups.items():
        # Split into chunks of batch_size
        for i in range(0, len(requests), batch_size):
            batch_requests = requests[i:i + batch_size]
            batch = {}
            for alias, owner, repo, scopes in batch_requests:
                batch[alias] = (owner, repo, scopes)
            batches.append(batch)
    
    return batches


async def crawl_packages_batched(
    session: aiohttp.ClientSession,
    packages: list[PackageEntryV1],
    workspace_packages: dict[str, PackageEntry],
    batch_size: int = 10
) -> list[PackageEntry]:
    """
    Crawl multiple packages using batched GitHub API requests.
    
    Args:
        session: aiohttp session
        packages: List of packages to crawl
        workspace_packages: Existing workspace package data
        batch_size: Number of GitHub repositories to batch together
        
    Returns:
        List of updated PackageEntry objects
    """
    results = []
    
    # Pre-process all packages to gather GitHub repository requirements
    all_github_urls = defaultdict(set)  # url -> scopes
    package_url_mapping = {}  # package_name -> {url: scopes}
    
    for package in packages:
        package_name = package["name"]
        existing = workspace_packages.get(package_name, {"name": package_name})
        
        # Replicate the logic from crawl_package to build uow
        out: PackageEntry = {**package}
        if "readme" in out:
            out["readme"] = update_url(resolve_url(out["source"], out["readme"]))
        details = out.get("details")
        release_definitions: list[ReleaseDescription] = out.get("releases", [])  # type: ignore[assignment]
        migrate_release_definitions_from_v2(release_definitions)
        reject_asset_definitions_from_v4(release_definitions)
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
        
        # Store the URL requirements for this package
        package_url_mapping[package_name] = dict(uow)
        
        # Add GitHub URLs to the global collection
        for url, scopes in uow.items():
            if which_hub(url) == "github":
                # Always add SUPPORTED_SYNTAX scope for GitHub repos to find syntax files
                # Also ensure METADATA is included since SUPPORTED_SYNTAX depends on its $branch_ex variable
                scopes_with_syntax = scopes | {"SUPPORTED_SYNTAX", "METADATA"}
                all_github_urls[url].update(scopes_with_syntax)
    
    # Batch GitHub requests
    github_batches = group_github_requests_for_batching(dict(all_github_urls), batch_size)
    
    # Execute batched GitHub requests
    github_results = {}  # url -> RepoInfo
    for batch in github_batches:
        try:
            batch_results = await fetch_batched_github_info(session, batch)
            # Convert alias-based results back to URL-based results
            for alias, (owner, repo, scopes) in batch.items():
                # Reconstruct the original URL
                url = f"https://github.com/{owner}/{repo}"
                if alias in batch_results:
                    github_results[url] = batch_results[alias]
        except Exception as e:
            err(f"Batch GitHub request failed: {e}")
            # Fall back to individual requests for this batch
            for alias, (owner, repo, scopes) in batch.items():
                url = f"https://github.com/{owner}/{repo}"
                try:
                    github_results[url] = await fetch_github_info(session, url, scopes)
                except Exception as individual_error:
                    err(f"Individual GitHub request failed for {url}: {individual_error}")
    
    # Now process each package with the pre-fetched GitHub data
    for package in packages:
        package_name = package["name"]
        existing = workspace_packages.get(package_name, {"name": package_name})
        
        try:
            result = await crawl_package_with_prefetched_data(
                session, package, existing, package_url_mapping[package_name], github_results
            )
            results.append(result)
        except Exception as e:
            # Handle individual package failures
            now = datetime.now(timezone.utc)
            now_string = now.strftime("%Y-%m-%d %H:%M:%S")
            out = {**existing}
            out["failing_since"] = existing.get("failing_since", now_string)
            
            if isinstance(e, aiohttp.ClientResponseError):
                err(
                    f"HTTP error during crawl for {package['name']}: "
                    f"{e.status} {e.message.removesuffix(".")}", end=". "
                )
                out["fail_reason"] = f"{e.status} {e.message}"
            else:
                err(f"Exception while crawling {package['name']}")
                tb = traceback.format_exc()
                out["fail_reason"] = f"Unhandled exception: {type(e).__name__}: {e}\n{tb}"
            
            # Set retry timing
            failing_since_dt = (
                datetime
                .strptime(out["failing_since"], "%Y-%m-%d %H:%M:%S")
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
            
            out["next_crawl"] = (now + interval).strftime("%Y-%m-%d %H:%M:%S")
            hours_str = str(interval.total_seconds() / 3600).removesuffix(".0")
            s = "s" if hours_str != "1" else ""
            err(f"Retrying in {hours_str} hour{s}.")
            results.append(out)
    
    return results


async def crawl_package_with_prefetched_data(
    session: aiohttp.ClientSession,
    package: PackageEntryV1,
    existing: PackageEntry,
    uow: dict[str, set[QueryScope]],
    github_results: dict[str, dict]
) -> PackageEntry:
    """
    Process a single package using pre-fetched GitHub data.
    """
    out: PackageEntry = {**package}
    if "readme" in out:
        out["readme"] = update_url(resolve_url(out["source"], out["readme"]))
    details = out.get("details")
    release_definitions: list[ReleaseDescription] = out.get("releases", [])  # type: ignore[assignment]
    migrate_release_definitions_from_v2(release_definitions)
    reject_asset_definitions_from_v4(release_definitions)
    normalize_release_definition(release_definitions, out["source"], details)

    # Process URLs using pre-fetched data
    for url, scopes in uow.items():
        info = None
        
        if which_hub(url) == "github" and url in github_results:
            info = github_results[url]
            # Extract syntax files from GitHub data
            if info and "syntax_files" in info:
                out["syntax_files"] = info["syntax_files"]
        elif which_hub(url) == "bitbucket":
            info = await fetch_bitbucket_info(session, url, scopes)
        elif which_hub(url) == "gitlab":
            info = await fetch_gitlab_info(session, url, scopes)
        else:
            if which_hub(url) != "github":  # Only warn for non-GitHub
                err(f"Backend for {url} not implemented yet")
            continue

        if not info:
            continue

        if url == details:
            out = info["metadata"] | out

        for r in release_definitions[:]:
            if is_fulfilled_release_definition(r):
                continue
            if r.get("base") != url:
                continue

            if tag_defintion := r.get("tags"):
                tag_prefix = "" if tag_defintion is True else tag_defintion
                async for tag in info["tags"]:
                    if (
                        tag["name"].startswith(tag_prefix)
                        and (version := (
                            tag["name"].removeprefix(tag_prefix)
                            if tag_prefix
                            else strip_possible_prefix(tag["name"])
                        ))
                        and is_semver(version)
                    ):
                        r.pop("tags")
                        r |= pluck(tag, ("url", "date"))  # type: ignore[arg-type]
                        r |= {"version": version}
                        break
                if "version" in r:
                    continue

                if tag_prefix:
                    err(f"No prefixed tag found for {url} matching ^{tag_prefix}")
                else:
                    err(f"No tagged version found for {url}")

            # Fallback to the default branch
            branches_defintion = r.get("branch", True)
            default_branch = info["metadata"].get("default_branch", "master")
            wanted_branch = (
                default_branch
                if branches_defintion is True
                else branches_defintion
            )
            async for branch in info["branches"]:
                if branch["name"] == wanted_branch:
                    r.pop("branch", None)
                    r |= pluck(branch, ("version", "url", "date"))  # type: ignore[arg-type]
                    break
            if "version" in r:
                continue

            err(
                f"No branch named {wanted_branch} found on {url}.  "
                f"Release definition cannot be fulfilled."
            )
            release_definitions.remove(r)

    for r in release_definitions[:]:
        if missing_keys := missing_from_release_definition(r):
            s = "s" if len(missing_keys) > 1 else ""
            err(
                f"Release definition {r} for {package['name']} incomplete.  "
                f"Missing key{s}: {missing_keys}"
            )
            release_definitions.remove(r)

    return out


if __name__ == "__main__":
    args = parse_args()
    wd = os.path.abspath(args.wd)
    os.makedirs(wd, exist_ok=True)
    args.registry = os.path.normpath(os.path.join(wd, args.registry))
    args.workspace = os.path.normpath(os.path.join(wd, args.workspace))
    asyncio.run(main(args.registry, args.workspace, args.name, args.limit))
