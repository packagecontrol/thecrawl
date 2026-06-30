from __future__ import annotations

import argparse
import asyncio
import aiohttp
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
import sys
import time
from urllib.parse import urlparse
from typing import Any, Callable, Iterable, Mapping, NotRequired, TypedDict, TypeGuard

from ._utils import flatten, pick, resolve_urls, update_url, write_json, pl


DEFAULT_OUTPUT_FILE = "./registry.json"
DEFAULT_CHANNEL = (
    "https://raw.githubusercontent.com/sublimehq/package_control_channel/refs/heads/master/channel.json"
)
MAX_CONCURRENCY = 32
GLOBAL_TIMEOUT = 60  # seconds
UTC_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

type Url = str
type IsoTimestamp = str


class RawRepositoryEntry(TypedDict, total=False):
    name: str
    details: NotRequired[str]
    labels: NotRequired[list[str]]


class RegistryEntry(TypedDict, total=False):
    source: Url
    schema_version: str
    name: str
    details: NotRequired[str]
    labels: NotRequired[list[str]]
    first_seen: NotRequired[IsoTimestamp]
    removed: NotRequired[IsoTimestamp]
    fetching_source_failed: NotRequired[IsoTimestamp]


class SeedEntry(TypedDict):
    name: str
    first_seen: IsoTimestamp
    source: NotRequired[Url | None]
    removed: NotRequired[IsoTimestamp]
    labels: NotRequired[list[str]]


class Registry(TypedDict):
    repositories: list[str]
    packages: list[RegistryEntry]
    libraries: list[RegistryEntry]


class RepositorySchema(TypedDict):
    self: Url
    schema_version: str
    packages: list[RawRepositoryEntry]
    libraries: list[RawRepositoryEntry]


@dataclass
class SeedDb:
    db: dict[str, Any]
    has_registry_shape: bool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a registry of Sublime Text packages."
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default=DEFAULT_OUTPUT_FILE,
        help=f"Output file path (default: {DEFAULT_OUTPUT_FILE}).",
    )
    parser.add_argument(
        "--channel",
        "-c",
        action="append",
        help=(
            "URL to a Channel or Repository to pull from (can be used multiple times). "
            "If not given, uses the official channel from sublimehq/package_control_channel."
        ),
    )
    parser.add_argument(
        "--seed",
        nargs="?",
        const="",
        default=None,
        help=(
            "Seed input for lifecycle enrichment. Omit to use implicit seed mode: "
            "read --output if available, otherwise continue without lifecycle fields. "
            "Provide without a value to require --output as seed (fail if unreadable), "
            "or provide a path to require that file. Supports registry.json, "
            "workspace.json, or seed.json-style package maps."
        ),
    )
    parser.add_argument(
        "--no-seed",
        action="store_true",
        help="Disable lifecycle enrichment and emit raw registry output.",
    )
    return parser.parse_args()


async def main(
    output_file: str,
    channels: list[str],
    *,
    seed_path: str | None = None,
    no_seed: bool = False,
) -> None:
    effective_seed_path, strict_seed = resolve_seed_path(
        output_file=output_file,
        seed_path=seed_path,
    )
    seed = read_seed_db(effective_seed_path, strict=strict_seed)
    failure_recovery = resolve_failure_recovery_db(
        output_file,
        effective_seed_path,
        seed,
    )

    try:
        async with asyncio.timeout(GLOBAL_TIMEOUT):
            db = await fetch_packages(
                channels,
                failure_recovery,
                seed=seed,
                no_seed=no_seed,
            )
            if seed and not no_seed:
                apply_seed_lifecycle(db, seed, now_utc_string())

            write_json(output_file, db, pretty=True, ensure_ascii=True)
            print(f"Saved registry as {output_file}")
    except asyncio.TimeoutError:
        print(f"Timeout: script took more than {GLOBAL_TIMEOUT} seconds")


async def fetch_packages(
    channels: list[str],
    recovery_db: Registry | None = None,
    *,
    seed: SeedDb | None = None,
    no_seed: bool = False,
) -> Registry:
    print("Fetching registered packages...")
    now = time.monotonic()
    now_string = now_utc_string()

    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENCY)
    async with aiohttp.ClientSession(connector=connector) as session:
        # Fetch repositories from all channels in parallel
        repos_lists = await asyncio.gather(*[
            get_repositories(channel, session) for channel in channels
        ])
        repos: list[str] = list(flatten(repos_lists))
        unseen = Unseen(repos)
        repo_results = await asyncio.gather(*[
            asyncio.create_task(fetch_repository(url, unseen, session))
            for url in repos
        ], return_exceptions=True)

        result: dict[Url, RepositorySchema] = {}
        for url, repo_result in zip(repos, repo_results):
            if isinstance(repo_result, Exception):
                err(f"Error fetching {url}: {repo_result}")
                warn_unrecoverable_seed_entries(
                    url,
                    recovery_db=recovery_db,
                    seed=seed,
                    no_seed=no_seed,
                )
                continue
            if isinstance(repo_result, BaseException):
                raise repo_result

            if not repo_result.get("schema_version", "1.").startswith("1."):
                result[repo_result["self"]] = repo_result

    # Flatten packages and libraries, adding source, schema_version, and
    # ensuring a unique name.

    def add_unique_(container: list[RegistryEntry], kind: str) -> Callable[[RegistryEntry], None]:
        seen = set()

        def add(entry: RegistryEntry) -> None:
            name = extract_package_name(entry)
            if name and name not in seen:
                seen.add(name)
                container.append(entry | {"name": name})
            else:
                msg = (
                    f"{kind} {name} from {entry['source']} already seen, skipping"
                    if name else
                    f"{kind} {entry} in {entry['source']} has no name, skipping"
                )
                err(msg)

        return add

    packages: list[RegistryEntry] = []
    libraries: list[RegistryEntry] = []
    add_package = add_unique_(packages, "Package")
    add_library = add_unique_(libraries, "Library")
    for url in repos:
        if repo := result.get(url):
            repo_info: RegistryEntry
            repo_info = {
                "source": repo["self"],
                "schema_version": repo["schema_version"],
            }
            for pkg in repo["packages"]:
                add_package(pkg | repo_info)  # type: ignore[arg-type]

            for library in repo["libraries"]:
                add_library(library | repo_info)  # type: ignore[arg-type]

        elif recovery_db:
            # recreate the repo from recovery_db (always registry-shaped)
            fail_info: RegistryEntry
            fail_info = {"fetching_source_failed": now_string}
            for pkg in recovery_db.get("packages", []):
                if pkg.get("source") == url:
                    add_package(fail_info | pkg)

            for library in recovery_db.get("libraries", []):
                if library.get("source") == url:
                    add_library(fail_info | library)

    print(
        f"Found {pl(len(packages), 'packages')} "
        f"and {pl(len(libraries), 'libraries')} "
        f"in {pl(len(result), 'repositories')}."
    )
    elapsed = time.monotonic() - now
    print(f"Prepared registry in {elapsed:.2f} seconds.")
    return {
        "repositories": repos,
        "packages": packages,
        "libraries": libraries,
    }


def extract_package_name(package: Mapping) -> str | None:
    """
    Extract the package name from a package entry.
    Tries 'name' key first, then parses the repo name from 'details' if it's a *Hub URL.
    """
    if name := package.get("name"):
        return name

    if details := package.get("details"):
        try:
            _, repo = parse_owner_repo(details)
        except ValueError:
            return None
        else:
            return repo
    return None


def parse_owner_repo(url: str) -> tuple[str, str]:
    """
    Extract owner and repo name from a *Hub URL.
    Example: https://github.com/timbrel/GitSavvy -> ("timbrel", "GitSavvy")
             https://github.com/timbrel/GitSavvy/tree/dev -> ("timbrel", "GitSavvy")
             https://github.com/timbrel/GitSavvy/releases/tag/2.50.0 -> ("timbrel", "GitSavvy")
             https://gitlab.com/jiehong/sublime_jq -> ("jiehong", "sublime_jq")
             https://bitbucket.org/hmml/jsonlint -> ("hmml", "jsonlint")
             https://codeberg.org/TobyGiacometti/SublimeDirectorySettings
               -> ("TobyGiacometti", "SublimeDirectorySettings")
    """
    parts = urlparse(url)
    path_parts = parts.path.strip("/").split("/")
    if len(path_parts) < 2:
        raise ValueError("Invalid *Hub repo URL")
    return path_parts[0], path_parts[1]


async def fetch_repository(
    location: Url,
    unseen: Unseen[Url],
    session: aiohttp.ClientSession,
) -> RepositorySchema:
    result = await http_get_json(location, session)

    repository: RepositorySchema = {
        "self": location,
        "schema_version": result.get("schema_version", "3.0.0"),
        "packages": result.get("packages", []),
        "libraries": result.get("libraries", []),
    }
    if includes := result.get("includes"):
        for result in await asyncio.gather(*[
            http_get_json(include, session)
            for include in unseen(resolve_urls(location, includes))
        ]):
            repository["packages"].extend(result.get("packages", []))
            repository["libraries"].extend(result.get("libraries", []))
    return repository


async def get_repositories(channel_url: str, session: aiohttp.ClientSession) -> list[str]:
    channel_info = await http_get_json(channel_url, session)
    if "repositories" not in channel_info:
        # Assume the url was not a channel but a "repository" (in Package Control speak)
        return [channel_url]

    return [
        update_url(url)
        for url in resolve_urls(channel_url, channel_info['repositories'])
    ]


async def http_get_json(location: str, session: aiohttp.ClientSession) -> dict:
    text = await http_get(location, session)
    return json.loads(text)


async def http_get(location: str, session: aiohttp.ClientSession) -> str:
    headers = {'User-Agent': 'Mozilla/5.0'}
    async with session.get(location, headers=headers, raise_for_status=True) as resp:
        return await resp.text()


def resolve_seed_path(output_file: str, seed_path: str | None) -> tuple[str, bool]:
    if seed_path is None:
        return output_file, False

    if seed_path == "":
        return output_file, True

    return os.path.abspath(seed_path), True


def read_seed_db(path: str, *, strict: bool) -> SeedDb | None:
    try:
        text = open(path, "r", encoding="utf-8").read()
    except OSError as exc:
        if strict:
            raise FileNotFoundError(f"Could not read seed path: {path}") from exc
        return None

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        if strict:
            raise ValueError(f"Seed is not valid JSON: {path}") from exc
        return None

    if not isinstance(data, dict):
        if strict:
            raise ValueError(f"Seed JSON must be an object: {path}")
        return None

    return SeedDb(
        db=data,
        has_registry_shape=is_registry_recovery_db(data),
    )


def resolve_failure_recovery_db(
    output_file: str,
    effective_seed_path: str,
    seed: SeedDb | None,
) -> Registry | None:
    if seed and seed.has_registry_shape:
        return seed.db  # type: ignore[return-value]

    output_is_seed = os.path.abspath(output_file) == os.path.abspath(effective_seed_path)
    if not output_is_seed:
        output_db = read_seed_db(output_file, strict=False)
        if output_db and output_db.has_registry_shape:
            return output_db.db  # type: ignore[return-value]

    return None


def is_registry_recovery_db(db: Mapping[str, Any]) -> TypeGuard[Registry]:
    return (
        isinstance(db.get("packages"), list)
        and isinstance(db.get("libraries"), list)
    )


def apply_seed_lifecycle(
    registry: Registry,
    seed: SeedDb,
    now_string: IsoTimestamp,
) -> None:
    seed_packages = {
        entry["name"]: entry
        for entry in iter_package_entries(seed.db)
    }
    current = {
        pkg["name"]: pkg
        for pkg in registry["packages"]
    }

    for name, package in current.items():
        entry = seed_packages.get(name)
        if entry and (first_seen := entry.get("first_seen")):
            package["first_seen"] = first_seen
        elif "first_seen" not in package:
            package["first_seen"] = now_string

    for name, entry in seed_packages.items():
        if name not in current:
            current[name] = build_tombstone(entry, now_string)

    registry["packages"] = \
        sorted(current.values(), key=lambda entry: entry["name"].casefold())


def iter_package_entries(db: Mapping[str, Any]) -> Iterable[SeedEntry]:
    entries = db.get("packages")
    # Shape: registry.json
    if isinstance(entries, list):
        for entry in entries:
            yield entry

    # Shape: workspace.json
    elif isinstance(entries, dict):
        for name, entry in entries.items():
            yield entry

    # Shape: seed.json
    elif "packages" not in db:
        for name, entry in db.items():
            yield entry


def warn_unrecoverable_seed_entries(
    source_url: str,
    *,
    recovery_db: Registry | None,
    seed: SeedDb | None,
    no_seed: bool,
) -> None:
    if seed is None:
        return

    if has_recovery_entries_for_source(recovery_db, source_url):
        return

    mode_outcome = "dropped" if no_seed else "tombstoned"

    if is_compact_seed(seed.db):
        err(
            "ATTENTION: repository recovery cannot be guaranteed with a compact seed. "
            "Check the output. Consider using a full registry.json seed for complete "
            f"recovery; missing packages are {mode_outcome}."
        )
        return

    if lost_names := seed_package_names_for_source(seed.db, source_url):
        err(
            "ATTENTION: seed file knows "
            f"{pl(len(lost_names), 'packages')} in the failed repository "
            "but has no data to recover full entries; "
            f"these are {mode_outcome}."
        )


def has_recovery_entries_for_source(
    recovery_db: Registry | None,
    source_url: str,
) -> bool:
    if not recovery_db:
        return False

    for kind in ("packages", "libraries"):
        for entry in recovery_db[kind]:
            if entry.get("source") == source_url:
                return True

    return False


def seed_package_names_for_source(seed_db: Mapping[str, Any], source_url: str) -> list[str]:
    names = {
        entry["name"]
        for entry in iter_package_entries(seed_db)
        if entry.get("source") == source_url
    }
    return sorted(names, key=str.casefold)


def is_compact_seed(seed_db: Mapping[str, Any]) -> bool:
    return "packages" not in seed_db


def build_tombstone(seed: Mapping[str, Any], now_string: IsoTimestamp) -> RegistryEntry:
    return (
        pick(("name", "labels", "source"), seed)
        | {"first_seen": now_string, "removed": now_string}  # type: ignore[operator]
        | pick(("first_seen", "removed"), seed)
    )


def now_utc_string() -> IsoTimestamp:
    return datetime.now(timezone.utc).strftime(UTC_FORMAT)


def err(*args, **kwargs) -> None:
    print(*args, **kwargs, file=sys.stderr)


class Unseen[T]:
    def __init__(self, seen: Iterable[T]) -> None:
        """
        Initialize an Unseen tracker.

        Args:
            seen (Iterable[T] | None): Optional iterable of items to mark as seen initially.
        """
        self._seen = set(seen)

    def extend(self, items: Iterable[T]) -> Iterable[T]:
        """
        Yield items from the given iterable that have not been seen before,
        and mark them as seen.

        Args:
            items (Iterable[T]): An iterable of items to check.

        Yields:
            T: Items not previously seen.
        """
        rv = [
            item
            for item in items
            if item not in self._seen
        ]
        self._seen.update(items)
        return rv
    __call__ = extend


if __name__ == "__main__":
    args = parse_args()
    output_file = os.path.abspath(args.output)
    channels = args.channel if args.channel else [DEFAULT_CHANNEL]
    seed_path = (
        None
        if args.seed is None
        else (output_file if args.seed == "" else os.path.abspath(args.seed))
    )
    asyncio.run(
        main(
            output_file,
            channels,
            seed_path=seed_path,
            no_seed=args.no_seed,
        )
    )
