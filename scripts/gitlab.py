from __future__ import annotations
import aiohttp
import asyncio
import os
import re
from datetime import datetime, timedelta
from urllib.parse import urlparse, quote
from typing import AsyncIterable, TypedDict, Literal, Iterable

from .utils import drop_falsy, err

QueryScope = Literal["METADATA", "TAGS", "BRANCHES"]
Url = str
Sha = str
IsoTimestamp = str


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


GITLAB_API_URL = "https://gitlab.com/api/v4"
_readme_filenames = {
    'readme', 'readme.txt', 'readme.md', 'readme.mkd', 'readme.mdown',
    'readme.markdown', 'readme.textile', 'readme.creole', 'readme.rst'
}

if not os.getenv("GITLAB_TOKEN"):
    err(
        "Warning: GITLAB_TOKEN environment variable is not set. "
        "Running anonymously."
    )


def parse_owner_repo(url: str):
    parts = urlparse(url)
    path_parts = parts.path.strip("/").split("/")
    if len(path_parts) < 2:
        raise ValueError("Invalid GitLab repo URL")
    return path_parts[0], path_parts[1]


async def fetch_(session: aiohttp.ClientSession, url: str):
    headers = {}
    if token := os.getenv("GITLAB_TOKEN"):
        headers["PRIVATE-TOKEN"] = token
    async with session.get(url, headers=headers) as resp:
        resp.raise_for_status()
        data = await resp.json()
        return data, dict(resp.headers)


async def fetch_json(session: aiohttp.ClientSession, url: str):
    data, _ = await fetch_(session, url)
    return data


async def fetch_repo_metadata(session: aiohttp.ClientSession, owner: str, repo: str) -> RepoMetadata:
    encoded_path = quote(f"{owner}/{repo}", safe="")
    url = f"{GITLAB_API_URL}/projects/{encoded_path}"
    data = await fetch_json(session, url)
    default_branch = data.get("default_branch", "master")
    readme_url = await find_readme_url(session, owner, repo, default_branch)
    return drop_falsy({
        "name": data.get("name"),
        "description": data.get("description"),
        "homepage": data.get("web_url"),
        "author": data.get("namespace", {}).get("path"),
        "readme": readme_url,
        "issues": data.get("web_url") + "/-/issues" if data.get("web_url") else None,
        "donate": None,  # Not available
        "default_branch": default_branch,
    })


async def find_readme_url(session, owner, repo, branch) -> Url | None:
    encoded_path = quote(f"{owner}/{repo}", safe="")
    url = f"{GITLAB_API_URL}/projects/{encoded_path}/repository/tree?ref={branch}&per_page=100"
    data = await fetch_json(session, url)
    for entry in data:
        if entry.get("type") == "blob" and entry["name"].lower() in _readme_filenames:
            return f"https://gitlab.com/{owner}/{repo}/-/raw/{branch}/{entry['name']}"
    return None


class _Pager:
    _next_url: Url | None

    def _get_next_url(self, headers: dict) -> Url | None:
        # GitLab paginates with 'X-Next-Page' header
        assert self._next_url
        next_page = headers.get('X-Next-Page')
        if next_page:
            next_url = re.sub(r'([&?])page=\d+', r'\1page=' + next_page, self._next_url)
            if 'page=' not in next_url:
                next_url += ('&' if '?' in next_url else '?') + f'page={next_page}'
            return next_url
        else:
            return None


class TagPager(_Pager):
    def __init__(self, session: aiohttp.ClientSession, owner: str, repo: str):
        self._session = session
        self.owner = owner
        self.repo = repo
        self._next_url = f"{GITLAB_API_URL}/projects/{quote(owner + '/' + repo, safe='')}/repository/tags?per_page=100"
        self._cache = []

    def __aiter__(self):
        return self._generator()

    async def _generator(self):
        for tag in self._cache:
            yield tag

        while self._next_url:
            data, headers = await fetch_(self._session, self._next_url)
            new_tags = [
                {
                    "name": tag["name"],
                    # "version": re.sub(r'^(v|release-)', '', tag["name"]),
                    "url": tag.get("web_url") or f"https://gitlab.com/{self.owner}/{self.repo}/-/archive/{tag['name']}/{self.repo}-{tag['name']}.zip",
                    "date": tag.get("commit", {}).get("committed_date", "")[:19].replace('T', ' '),
                    "sha": tag.get("commit", {}).get("id", ""),
                }
                for tag in data
            ]
            self._cache.extend(new_tags)
            self._next_url = self._get_next_url(headers)

            for tag_obj in new_tags:
                yield tag_obj


class BranchesPager(_Pager):
    def __init__(self, session: aiohttp.ClientSession, owner: str, repo: str):
        self._session = session
        self.owner = owner
        self.repo = repo
        self._next_url = f"{GITLAB_API_URL}/projects/{quote(owner + '/' + repo, safe='')}/repository/branches?per_page=100"
        self._cache = []

    def __aiter__(self):
        return self._generator()

    async def _generator(self):
        for branch in self._cache:
            yield branch
        next_url = self._next_url
        while next_url:
            data, headers = await fetch_(self._session, next_url)
            new_branches = [
                {
                    "name": branch["name"],
                    "version": re.sub(r"\\D", ".", branch.get("commit", {}).get("committed_date", "")[:19].replace('T', ' ')),
                    "url": f"https://gitlab.com/{self.owner}/{self.repo}/-/tree/{branch['name']}",
                    "date": branch.get("commit", {}).get("committed_date", "")[:19].replace('T', ' '),
                    "sha": branch.get("commit", {}).get("id", ""),
                }
                for branch in data
            ]
            self._cache.extend(new_branches)
            self._next_url = self._get_next_url(headers)

            for branch_obj in new_branches:
                yield branch_obj


async def fetch_gitlab_info(
    session: aiohttp.ClientSession, gitlab_url: str, scopes: Iterable[QueryScope]
) -> RepoInfo:
    owner, repo = parse_owner_repo(gitlab_url)
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
        url = "https://gitlab.com/jiehong/sublime_jq"
        async with aiohttp.ClientSession() as session:
            info = await fetch_gitlab_info(session, url, ("METADATA", "TAGS", "BRANCHES"))
            print("Metadata:", info["metadata"])
            print("Tags:")
            async for tag in info["tags"]:
                print(tag)
            print("Branches:")
            async for branch in info["branches"]:
                print(branch)
    asyncio.run(main())
