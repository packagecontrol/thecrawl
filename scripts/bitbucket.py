from __future__ import annotations
import json
import aiohttp
import asyncio
import os
from urllib.parse import urlparse

from typing import AsyncIterable, TypedDict, Literal, Iterable

from .utils import drop_falsy, err, normalize_tz_aware_datetime


type QueryScope = Literal["METADATA", "TAGS", "BRANCHES"]
type Url = str
type IsoTimestamp = str


class RepoMetadata(TypedDict, total=False):
    id: str
    name: str
    description: str
    homepage: Url
    author: str
    readme: Url
    issues: Url
    donate: Url
    default_branch: str
    stars: int
    created_at: IsoTimestamp
    archived_at: IsoTimestamp | None


class TagInfo(TypedDict):
    name: str
    url: Url
    date: IsoTimestamp


class BranchInfo(TypedDict):
    name: str
    url: Url
    date: IsoTimestamp


class RepoInfo(TypedDict):
    metadata: RepoMetadata
    tags: AsyncIterable[TagInfo]
    branches: AsyncIterable[BranchInfo]


BITBUCKET_API_URL = "https://api.bitbucket.org/2.0"
_readme_filenames = {
    'readme', 'readme.txt', 'readme.md', 'readme.mkd', 'readme.mdown',
    'readme.markdown', 'readme.textile', 'readme.creole', 'readme.rst'
}

if not os.getenv("BITBUCKET_TOKEN"):
    err(
        "Note: BITBUCKET_TOKEN environment variable is not set. "
        "Running anonymously."
    )

async def fetch_json(session: aiohttp.ClientSession, url: str) -> dict:
    headers = {}
    if token := os.getenv("BITBUCKET_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    async with session.get(url, headers=headers) as resp:
        resp.raise_for_status()
        return await resp.json()


def parse_owner_repo(url: str):
    parts = urlparse(url)
    path_parts = parts.path.strip("/").split("/")
    if len(path_parts) < 2:
        raise ValueError("Invalid Bitbucket repo URL")
    return path_parts[0], path_parts[1]


async def fetch_repo_metadata(session: aiohttp.ClientSession, owner: str, repo: str) -> RepoMetadata:
    url = f"{BITBUCKET_API_URL}/repositories/{owner}/{repo}"
    data = await fetch_json(session, url)
    default_branch = data.get("mainbranch", {}).get("name", "master")
    readme_url = await find_readme_url(session, owner, repo, default_branch)
    # Watchers count as proxy for stars in Bitbucket
    watchers_url = data.get("links", {}).get("watchers", {}).get("href")
    stars = None
    if watchers_url:
        try:
            watchers_data = await fetch_json(session, watchers_url)
            stars = watchers_data.get("size")
        except aiohttp.ClientResponseError:
            stars = None
    return drop_falsy({
        "id": data.get("uuid"),
        "name": data.get("name"),
        "description": data.get("description"),
        "homepage": data.get("website"),
        "author": (
            data.get("owner", {}).get("nickname")
            or data.get("owner", {}).get("username")
        ),
        "readme": readme_url,
        "issues": data.get("links", {}).get("issues", {}).get("href"),
        "donate": None,  # Not available
        "default_branch": default_branch,
        "stars": stars,
        "created_at": normalize_tz_aware_datetime(data.get("created_on") or ""),
        #                               ^^ funny, isn't it?
        "archived_at": None,  # Not available
    })


async def find_readme_url(session, owner, repo, branch) -> Url | None:
    """
    Fetch the root directory file listing and return the raw URL of the README if found.
    """
    files_url = f"{BITBUCKET_API_URL}/repositories/{owner}/{repo}/src/{branch}/?max_depth=1"
    files_data = await fetch_json(session, files_url)
    entries = files_data.get("values", [])
    for entry in entries:
        if entry.get("type") == "commit_file" and entry["path"].lower() in _readme_filenames:
            return f"https://bitbucket.org/{owner}/{repo}/raw/{branch}/{entry['path']}"
    return None


class TagPager:
    def __init__(self, session: aiohttp.ClientSession, owner: str, repo: str):
        self._session = session
        self.owner = owner
        self.repo = repo
        self._next_url = f"{BITBUCKET_API_URL}/repositories/{owner}/{repo}/refs/tags"
        self._cache = []

    def __aiter__(self):
        return self._generator()

    async def _generator(self):
        for tag in self._cache:
            yield tag

        while self._next_url:
            data = await fetch_json(self._session, self._next_url)
            new_tags = []
            for tag in data.get("values", []):
                raw_date = tag.get("target", {}).get("date", "")
                if not raw_date:
                    err(
                        f"Skip tag `{tag}` from https://bitbucket.org/{self.owner}/{self.repo} "
                        "which has no date"
                    )
                    continue
                new_tags.append({
                    "name": tag["name"],
                    "url": f"https://bitbucket.org/{self.owner}/{self.repo}/get/{tag['name']}.zip",
                    "date": normalize_tz_aware_datetime(raw_date),
                })
            self._cache.extend(new_tags)
            self._next_url = data.get("next")

            for tag_obj in new_tags:
                yield tag_obj


class BranchesPager:
    def __init__(self, session: aiohttp.ClientSession, owner: str, repo: str):
        self._session = session
        self.owner = owner
        self.repo = repo
        self._next_url = f"{BITBUCKET_API_URL}/repositories/{owner}/{repo}/refs/branches"
        self._cache = []

    def __aiter__(self):
        return self._generator()

    async def _generator(self):
        for branch in self._cache:
            yield branch

        while self._next_url:
            data = await fetch_json(self._session, self._next_url)
            new_branches = []
            for branch in data.get("values", []):
                raw_date = branch.get("target", {}).get("date", "")
                if not raw_date:
                    err(
                        f"Skip branch `{branch}` from https://bitbucket.org/{self.owner}/{self.repo} "
                        "which has no date"
                    )
                    continue
                new_branches.append({
                    "name": branch["name"],
                    "url": f"https://bitbucket.org/{self.owner}/{self.repo}/get/{branch['name']}.zip",
                    "date": normalize_tz_aware_datetime(raw_date),
                })
            self._cache.extend(new_branches)
            self._next_url = data.get("next")

            for branch_obj in new_branches:
                yield branch_obj


async def fetch_bitbucket_info(
    session: aiohttp.ClientSession, bitbucket_url: str, scopes: Iterable[QueryScope]
) -> RepoInfo:
    owner, repo = parse_owner_repo(bitbucket_url)
    tags = TagPager(session, owner, repo)
    branches = BranchesPager(session, owner, repo)

    metadata_task = (
        fetch_repo_metadata(session, owner, repo)
        if "METADATA" in scopes
        else ready({})
    )
    tags_task = (
        async_next_or_none(tags._generator()) if "TAGS" in scopes else ready()
    )
    branches_task = (
        async_next_or_none(branches._generator())
        if "BRANCHES" in scopes
        else ready()
    )
    metadata, _, _ = await asyncio.gather(metadata_task, tags_task, branches_task)

    return {
        "metadata": metadata,
        "tags": tags,
        "branches": branches,
    }


async def async_next_or_none(aiter):
    try:
        return await aiter.__anext__()
    except StopAsyncIteration:
        return None


async def ready(value=None):
    return value


if __name__ == "__main__":
    import sys

    async def main():
        if len(sys.argv) > 1:
            arg = sys.argv[1]
            if arg.startswith("https://"):
                url = arg
            else:
                owner_repo = arg.strip("/")
                url = f"https://bitbucket.org/{owner_repo}"
        else:
            url = "https://bitbucket.org/hxss/html2scss"

        print(f"Fetching Bitbucket info for: {url}")
        async with aiohttp.ClientSession() as session:
            info = await fetch_bitbucket_info(session, url, ("METADATA", "TAGS", "BRANCHES"))
            print("Metadata", json.dumps(info["metadata"], indent=2, ensure_ascii=False))
            print("Tags:")
            async for tag in info["tags"]:
                print(tag)
            print("Branches:")
            async for branch in info["branches"]:
                print(branch)
    asyncio.run(main())
