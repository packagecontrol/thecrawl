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
from typing import Any, Callable, Iterable, Mapping, NotRequired, TypedDict

from ._utils import flatten, resolve_urls, update_url, write_json, pl


DEFAULT_OUTPUT_FILE = "./registry.json"
DEFAULT_CHANNEL = (
    "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/channel.json"
)
MAX_CONCURRENCY = 32
GLOBAL_TIMEOUT = 60  # seconds
UTC_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

type Url = str
type IsoTimestamp = str


class PackageEntry(TypedDict, total=False):
    source: Url
    schema_version: str
    name: str
    details: NotRequired[str]
    labels: NotRequired[list[str]]
    first_seen: NotRequired[IsoTimestamp]
    removed: NotRequired[IsoTimestamp]
    fetching_source_failed: NotRequired[IsoTimestamp]


class Registry(TypedDict):
    repositories: list[str]
    packages: list[PackageEntry]
    libraries: list[PackageEntry]


class RepositorySchema(TypedDict):
    self: Url
    schema_version: str
    packages: list[PackageEntry]
    libraries: list[PackageEntry]


@dataclass
class SeedLoad:
    db: dict[str, Any]
    available: bool


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
            "If not given, uses the official channel from wbond/package_control_channel."
        ),
    )
    parser.add_argument(
        "--seed",
        nargs="?",
        const="",
        default=None,
        help=(
            "Optional path to seed JSON. If provided without a value, defaults to --output. "
            "Explicit seed paths must exist and be readable."
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
    effective_seed_path, explicit_seed = resolve_seed_path(
        output_file=output_file,
        seed_path=seed_path,
    )
    seed = read_seed_db(effective_seed_path, explicit=explicit_seed)

    try:
        async with asyncio.timeout(GLOBAL_TIMEOUT):
            db = await fetch_packages(channels, seed.db if seed.available else {})
            if seed.available and not no_seed:
                db["packages"] = apply_seed_lifecycle(
                    db["packages"],
                    seed.db,
                    now_utc_string(),
                )
            write_json(output_file, db, pretty=True, ensure_ascii=True)
            print(f"Saved registry as {output_file}")
    except asyncio.TimeoutError:
        print(f"Timeout: script took more than {GLOBAL_TIMEOUT} seconds")


async def fetch_packages(channels: list[str], db: Mapping[str, Any] | None = None) -> Registry:
    print("Fetching registered packages...")
    now = time.monotonic()
    now_string = now_utc_string()

    async with aiohttp.ClientSession() as session:
        # Fetch repositories from all channels in parallel
        repos_lists = await asyncio.gather(*[
            get_repositories(channel, session) for channel in channels
        ])
        repos: list[str] = list(flatten(repos_lists))
        unseen = Unseen(repos)
        sem = asyncio.Semaphore(MAX_CONCURRENCY)
        result: dict[Url, RepositorySchema] = {}
        result = {
            repo["self"]: repo
            for repo in await asyncio.gather(*[
                asyncio.create_task(fetch_repository(url, unseen, sem, session))
                for url in repos
            ])
            if repo
            if not repo.get("schema_version", "1.").startswith("1.")
        }

    # Flatten packages and libraries, adding source, schema_version, and
    # ensuring a unique name.

    def add_unique_(container: list[PackageEntry], kind: str) -> Callable[[PackageEntry], None]:
        seen = set()

        def add(entry: PackageEntry) -> None:
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

    packages: list[PackageEntry] = []
    libraries: list[PackageEntry] = []
    add_package = add_unique_(packages, "Package")
    add_library = add_unique_(libraries, "Library")
    for url in repos:
        if repo := result.get(url):
            repo_info: PackageEntry
            repo_info = {
                "source": repo["self"],
                "schema_version": repo["schema_version"],
            }
            for pkg in repo["packages"]:
                add_package(pkg | repo_info)

            for library in repo["libraries"]:
                add_library(library | repo_info)

        elif db:
            # recreate the repo from db
            fail_info: PackageEntry
            fail_info = {"fetching_source_failed": now_string}
            for pkg in iter_seed_entries(db, "packages"):
                if pkg.get("source") == url:
                    add_package(fail_info | pkg)

            for library in iter_seed_entries(db, "libraries"):
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
    sem: asyncio.Semaphore,
    session: aiohttp.ClientSession
) -> RepositorySchema | None:
    try:
        result = await __fetch_repo(location, sem, session)
    except Exception as e:
        err(f"Error fetching {location}: {e}")
        return None

    repository: RepositorySchema = {
        "self": location,
        "schema_version": result.get("schema_version", "3.0.0"),
        "packages": result.get("packages", []),
        "libraries": result.get("libraries", []),
    }
    if includes := result.get("includes"):
        for result in await asyncio.gather(*[
            __fetch_repo(include, sem, session)
            for include in unseen(resolve_urls(location, includes))
        ]):
            repository["packages"].extend(result.get("packages", []))
            repository["libraries"].extend(result.get("libraries", []))
    return repository


async def __fetch_repo(
    location: str, sem: asyncio.Semaphore, session: aiohttp.ClientSession
) -> dict:
    async with sem:
        return await http_get_json(location, session)


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


def read_seed_db(path: str, *, explicit: bool) -> SeedLoad:
    try:
        text = open(path, "r", encoding="utf-8").read()
    except OSError as exc:
        if explicit:
            raise FileNotFoundError(f"Could not read explicit seed path: {path}") from exc
        return SeedLoad(db={}, available=False)

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        if explicit:
            raise ValueError(f"Explicit seed is not valid JSON: {path}") from exc
        return SeedLoad(db={}, available=False)

    if not isinstance(data, dict):
        if explicit:
            raise ValueError(f"Explicit seed JSON must be an object: {path}")
        return SeedLoad(db={}, available=False)

    return SeedLoad(db=data, available=True)


def apply_seed_lifecycle(
    packages: list[PackageEntry],
    seed_db: Mapping[str, Any],
    now_string: IsoTimestamp,
) -> list[PackageEntry]:
    seed_packages = extract_seed_packages(seed_db)
    current = {
        pkg["name"]: dict(pkg)
        for pkg in packages
        if isinstance(pkg.get("name"), str)
    }

    for name, package in current.items():
        seed = seed_packages.get(name)
        if seed and (first_seen := seed.get("first_seen")):
            package["first_seen"] = first_seen
        elif "removed" not in package:
            package["first_seen"] = now_string

        if "removed" not in package:
            package.pop("removed", None)

    for name, seed in seed_packages.items():
        if name not in current:
            current[name] = build_tombstone(seed, now_string)

    return sorted(current.values(), key=package_name_sort_key)


def extract_seed_packages(seed_db: Mapping[str, Any]) -> dict[str, PackageEntry]:
    out: dict[str, PackageEntry] = {}
    for entry in iter_seed_entries(seed_db, "packages"):
        if not isinstance(name := entry.get("name"), str):
            continue

        seed: PackageEntry = {"name": name}
        if isinstance(source := entry.get("source"), str):
            seed["source"] = source
        if isinstance(first_seen := entry.get("first_seen"), str):
            seed["first_seen"] = first_seen
        if isinstance(removed := entry.get("removed"), str):
            seed["removed"] = removed
        if isinstance(labels := entry.get("labels"), list):
            seed["labels"] = [str(label) for label in labels]

        out[name] = seed
    return out


def iter_seed_entries(seed_db: Mapping[str, Any], kind: str) -> Iterable[PackageEntry]:
    entries = seed_db.get(kind)
    if isinstance(entries, list):
        for entry in entries:
            if isinstance(entry, dict):
                yield entry
        return

    if isinstance(entries, dict):
        for name, entry in entries.items():
            if isinstance(entry, dict):
                yield {"name": str(name)} | entry
        return

    if kind == "packages" and "packages" not in seed_db:
        for name, entry in seed_db.items():
            if isinstance(entry, dict):
                yield {"name": str(name)} | entry


def build_tombstone(seed: PackageEntry, now_string: IsoTimestamp) -> PackageEntry:
    tombstone: PackageEntry = {
        "name": seed["name"],
        "source": str(seed.get("source", "")),
        "first_seen": str(seed.get("first_seen", now_string)),
        "removed": str(seed.get("removed", now_string)),
    }
    if labels := seed.get("labels"):
        tombstone["labels"] = labels
    return tombstone


def package_name_sort_key(entry: Mapping[str, Any]) -> str:
    return str(entry.get("name", "")).casefold()


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
