from __future__ import annotations
import aiohttp
import asyncio
import os
import re
from urllib.parse import urlparse

from typing import AsyncIterable, TypedDict, Literal, Iterable

from .utils import drop_falsy, err


type QueryScope = Literal["METADATA", "TAGS", "BRANCHES"]
type Url = str
type Sha = str
type IsoTimestamp = str


class RepoMetadata(TypedDict, total=False):
    name: str
    description: str
    homepage: Url
    author: str
    readme: Url
    issues: Url
    donate: Url
    default_branch: str


class TagInfo(TypedDict):
    name: str
    version: str
    url: Url
    date: IsoTimestamp
    sha: Sha


class BranchInfo(TypedDict):
    name: str
    version: str
    url: Url
    date: IsoTimestamp
    sha: Sha


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
        "Warning: BITBUCKET_TOKEN environment variable is not set. "
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
    return drop_falsy({
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
            new_tags = [
                {
                    "name": tag["name"],
                    # "version": re.sub(r'^(v|release-)', '', tag["name"]),
                    "url": f"https://bitbucket.org/{self.owner}/{self.repo}/get/{tag['name']}.zip",
                    "date": tag["target"]["date"][:19].replace('T', ' '),
                    "sha": tag.get("target", {}).get("hash", ""),
                }
                for tag in data.get("values", [])
            ]
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
            new_branches = [
                {
                    "name": branch["name"],
                    "version": re.sub(r"\D", ".", branch.get("target", {}).get("date", "")[:19].replace('T', ' ')),
                    "url": f"https://bitbucket.org/{self.owner}/{self.repo}/get/{branch['name']}.zip",
                    "date": branch.get("target", {}).get("date", "")[:19].replace('T', ' '),
                    "sha": branch.get("target", {}).get("hash", ""),
                }
                for branch in data.get("values", [])
            ]
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
    async def main():
        url = "https://bitbucket.org/hxss/html2scss"
        async with aiohttp.ClientSession() as session:
            info = await fetch_bitbucket_info(session, url, ("METADATA", "TAGS", "BRANCHES"))
            print("Metadata:", info["metadata"])
            print("Tags:")
            async for tag in info["tags"]:
                print(tag)
            print("Branches:")
            async for branch in info["branches"]:
                print(branch)
    asyncio.run(main())
