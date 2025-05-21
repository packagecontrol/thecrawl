from __future__ import annotations

import argparse
import asyncio
import aiohttp
from functools import partial
import json
import os
import re
import sys
import time
from urllib.parse import urljoin, urlparse
from typing import Callable, Iterable, Mapping, NotRequired, TypedDict
from itertools import chain

DEFAULT_OUTPUT_FILE = "./registry.json"
DEFAULT_CHANNEL = (
    "https://raw.githubusercontent.com/wbond/package_control_channel"
    "/refs/heads/master/channel.json"
)
MAX_CONCURRENCY = 32
GLOBAL_TIMEOUT = 60  # seconds

type Url = str


class PackageEntry(TypedDict, total=False):
    source: Url
    schema_version: str
    tombstoned: NotRequired[bool]


class PackageDb(TypedDict):
    repositories: list[str]
    packages: list[PackageEntry]
    dependencies: list[PackageEntry]


class RepositorySchema(TypedDict):
    self: Url
    schema_version: str
    packages: list[PackageEntry]
    dependencies: list[PackageEntry]


async def main(output_file: str, channels: list[str]) -> None:
    # Try to read previous db if it exists
    try:
        with open(output_file, 'r') as f:
            prev_db = json.load(f)
    except (OSError, json.JSONDecodeError):
        prev_db = {}

    try:
        async with asyncio.timeout(GLOBAL_TIMEOUT):
            db = await fetch_packages(channels, prev_db)
            with open(output_file, 'w') as f:
                json.dump(db, f, indent=2)
            print(f"Saved registry as {output_file}")
    except asyncio.TimeoutError:
        print(f"Timeout: script took more than {GLOBAL_TIMEOUT} seconds")


async def fetch_packages(channels: list[str], db: PackageDb = None) -> PackageDb:
    print("Fetching registered packages...")
    now = time.monotonic()

    async with aiohttp.ClientSession() as session:
        # Fetch repositories from all channels in parallel
        repos_lists = await asyncio.gather(*[
            get_repositories(channel, session) for channel in channels
        ])
        # Flatten the list of lists
        repos: list[str] = flatten(repos_lists)
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

    # Flatten packages and dependencies, adding source and schema_version
    packages: list[PackageEntry] = []
    dependencies: list[PackageEntry] = []
    add_package = partial(add_unique, "Package", packages, set(), extract_package_name)
    add_dependency = partial(add_unique, "Dependency", dependencies, set(), extract_package_name)
    for url in repos:
        if repo := result.get(url):
            repo_info: PackageEntry
            repo_info = {
                "source": repo["self"],
                "schema_version": repo["schema_version"],
            }
            for pkg in repo["packages"]:
                add_package(pkg | repo_info)

            for dep in repo["dependencies"]:
                add_dependency(dep | repo_info)

        elif db:
            # recreate the repo from db
            tombstoned: PackageEntry
            tombstoned = {"tombstoned": True}
            for pkg in db.get("packages", []):
                if pkg.get("source") == url:
                    add_package(pkg | tombstoned)

            for dep in db.get("dependencies", []):
                if dep.get("source") == url:
                    add_dependency(dep | tombstoned)

    print(
        f"Found {len(packages)} packages "
        f"and {len(dependencies)} dependencies "
        f"in {len(result)} repositories."
    )
    elapsed = time.monotonic() - now
    print(f"Prepared packages in {elapsed:.2f} seconds.")
    return {
        "repositories": repos,
        "packages": packages,
        "dependencies": dependencies,
    }


def add_unique[T, K](
    topic: str,
    container: list[PackageEntry],
    seen: set[K],
    key_fn: Callable[[PackageEntry], K],
    item: PackageEntry
):
    key = key_fn(item)
    if not key:
        print(f"{topic} {item} in {item['source']} has no name, skipping", file=sys.stderr)
    elif key in seen:
        print(f"{topic} {key} from {item['source']} already seen, skipping", file=sys.stderr)
    else:
        seen.add(key)
        container.append(item)


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
        print(f"Error fetching {location}: {e}", file=sys.stderr)
        return None

    repository: RepositorySchema = {
        "self": location,
        "schema_version": result.get("schema_version", "3.0.0"),
        "packages": result.get("packages", []),
        "dependencies": result.get("dependencies", []),
    }
    if includes := result.get("includes"):
        for result in await asyncio.gather(*[
            __fetch_repo(include, sem, session)
            for include in unseen(resolve_urls(location, includes))
        ]):
            repository["packages"].extend(result.get("packages", []))
            repository["dependencies"].extend(result.get("dependencies", []))
    return repository


async def __fetch_repo(
    location: str, sem: asyncio.Semaphore, session: aiohttp.ClientSession
) -> dict:
    async with sem:
        return await http_get_json(location, session)


async def get_repositories(channel_url: str, session: aiohttp.ClientSession) -> list[str]:
    channel_info = await http_get_json(channel_url, session)
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


def resolve_urls(root_url, uris):
    for url in uris:
        if not url:
            continue
        if url.startswith('./') or url.startswith('../'):
            url = urljoin(root_url, url)
        yield url


def update_url(url: str) -> str:
    if not url:
        return url
    url = url.replace('://raw.github.com/', '://raw.githubusercontent.com/')
    url = url.replace('://nodeload.github.com/', '://codeload.github.com/')
    url = re.sub(
        r'^(https://codeload\.github\.com/[^/#?]+/[^/#?]+/)zipball(/.*)$',
        '\\1zip\\2',
        url
    )
    if url in {
        'https://sublime.wbond.net/repositories.json',
        'https://sublime.wbond.net/channel.json',
    }:
        url = 'https://packagecontrol.io/channel_v3.json'
    return url


def flatten[T](list_of_lists: list[list[T]]) -> list[T]:
    """Flatten a list of lists into a single list."""
    return list(chain.from_iterable(list_of_lists))


class Unseen[T]:
    def __init__(self, items: Iterable[T] | None = None) -> None:
        """
        Initialize an Unseen tracker.

        Args:
            items (Iterable[T] | None): Optional iterable of items to mark as seen initially.
        """
        self._seen: set[T] = set()
        if items:
            self.extend(items)

    def extend(self, items: Iterable[T]) -> Iterable[T]:
        """
        Yield items from the given iterable that have not been seen before,
        and mark them as seen.

        Args:
            items (Iterable[T]): An iterable of items to check.

        Yields:
            T: Items not previously seen.
        """
        return (
            item
            for item in items
            if not self.see(item)
        )
    __call__ = extend

    def see(self, item: T) -> bool:
        """
        Mark an item as seen. Returns True if the item was already seen, False otherwise.

        Args:
            item (T): The item to check and mark as seen.

        Returns:
            bool: True if the item was already seen, False if it was not.
        """
        if item not in self._seen:
            self._seen.add(item)
            return False
        return True


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
            "Channel URL to pull from (can be used multiple times). "
            "If not given, uses the official channel from wbond/package_control_channel."
        ),
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    output_file = os.path.abspath(args.output)
    channels = args.channel if args.channel else [DEFAULT_CHANNEL]
    asyncio.run(main(output_file, channels))
