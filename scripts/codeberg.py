from __future__ import annotations
import json
import aiohttp
import asyncio
import os
from urllib.parse import urlparse, urlencode, quote

from typing import AsyncIterable, TypedDict, Literal, Iterable

from ._utils import drop_falsy, err, normalize_tz_aware_datetime, USER_AGENT


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
    readme_content: str
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


CODEBERG_API_URL = "https://codeberg.org/api/v1"
_readme_filenames = {
    'readme', 'readme.txt', 'readme.md', 'readme.mkd', 'readme.mdown',
    'readme.markdown', 'readme.textile', 'readme.creole', 'readme.rst'
}

if not os.getenv("CODEBERG_TOKEN"):
    err(
        "Note: CODEBERG_TOKEN environment variable is not set. "
        "Running anonymously."
    )


def parse_owner_repo(url: str):
    parts = urlparse(url)
    path_parts = parts.path.strip("/").split("/")
    if len(path_parts) < 2:
        raise ValueError("Invalid Codeberg repo URL")
    return path_parts[0], path_parts[1]


def _auth_headers() -> dict[str, str]:
    headers: dict[str, str] = {'User-Agent': USER_AGENT}
    # Codeberg (Forgejo/Gitea) supports Authorization: token <TOKEN>
    if token := os.getenv("CODEBERG_TOKEN"):
        headers["Authorization"] = f"token {token}"
    return headers


async def fetch_json(session: aiohttp.ClientSession, url: str) -> dict:
    async with session.get(url, headers=_auth_headers()) as resp:
        resp.raise_for_status()
        return await resp.json()


async def fetch_text(session: aiohttp.ClientSession, url: str) -> str:
    async with session.get(url, headers=_auth_headers()) as resp:
        resp.raise_for_status()
        return await resp.text()


async def fetch_repo_metadata(
    session: aiohttp.ClientSession,
    owner: str,
    repo: str
) -> RepoMetadata:
    url = f"{CODEBERG_API_URL}/repos/{owner}/{repo}"
    data = await fetch_json(session, url)
    default_branch = data.get("default_branch", "master")
    readme_url, readme_content = await find_readme(
        session,
        owner,
        repo,
        default_branch,
    )
    return drop_falsy({
        "id": str(data.get("id")) if data.get("id") is not None else None,
        "name": data.get("name") or repo,
        "description": data.get("description"),
        "homepage":
            data.get("website")
            or data.get("html_url")
            or f"https://codeberg.org/{owner}/{repo}"
        ,
        "author":
            data.get("owner", {}).get("login")
            or data.get("owner", {}).get("username")
            or owner
        ,
        "readme": readme_url,
        "readme_content": readme_content,
        "issues": f"https://codeberg.org/{owner}/{repo}/issues",
        "donate": None,  # Not available via API
        "default_branch": default_branch,
        "stars":
            data.get("stars_count")
            or data.get("stargazers_count")
            or data.get("watchers_count")
        ,
        "created_at": normalize_tz_aware_datetime(data.get("created_at") or ""),
        "archived_at":
            normalize_tz_aware_datetime(archived_at)
            if (
                data.get("archived", False)
                and (archived_at := data.get("archived_at"))
                # That must be a bug on codebergs side
                and not archived_at.startswith("1970-01-01T")
            )
            else None
        ,
    })


async def find_readme(session, owner, repo, branch) -> tuple[Url | None, str | None]:
    """
    Fetch the root directory listing and return the raw README URL and text.
    """
    # Forgejo/Gitea contents API
    params = urlencode({"ref": branch})
    files_url = f"{CODEBERG_API_URL}/repos/{owner}/{repo}/contents?{params}"
    try:
        entries = await fetch_json(session, files_url)
    except aiohttp.ClientResponseError:
        return None, None
    for entry in entries or []:
        name = (entry.get("name") or "").lower()
        entry_type = entry.get("type")
        if entry_type == "file" and name in _readme_filenames:
            # Raw URL format on Codeberg/Forgejo
            readme_url = f"https://codeberg.org/{owner}/{repo}/raw/branch/{branch}/{entry['name']}"
            return readme_url, await fetch_readme_content(session, readme_url)
    return None, None


async def fetch_readme_content(session, readme_url: str) -> str | None:
    try:
        return await fetch_text(session, readme_url)
    except aiohttp.ClientResponseError:
        return None


class TagPager:
    def __init__(self, session: aiohttp.ClientSession, owner: str, repo: str):
        self._session = session
        self.owner = owner
        self.repo = repo
        self._page = 1
        self._cache: list[TagInfo] = []

    def __aiter__(self):
        return self._generator()

    async def _generator(self):
        for tag in self._cache:
            yield tag

        while True:
            url = (
                f"{CODEBERG_API_URL}/repos/{self.owner}/{self.repo}"
                f"/tags?page={self._page}&limit=50"
            )
            data = await fetch_json(self._session, url)
            if not data:
                break
            new_tags: list[TagInfo] = []
            for tag in data:
                name = tag["name"]
                commit = tag.get("commit") or {}
                # Common fields seen in Gitea/Forgejo: commit.id, commit.created, commit.timestamp
                raw_date = commit.get("created") or commit.get("timestamp") or ""
                if not raw_date:
                    err(
                        f"Skip tag `{tag}` from https://codeberg.org/{self.owner}/{self.repo} "
                        "which has no date"
                    )
                    continue
                date = normalize_tz_aware_datetime(raw_date)
                new_tags.append({
                    "name": name,
                    "url": (
                        f"{CODEBERG_API_URL}/repos/{self.owner}/{self.repo}/archive/"
                        f"{quote(name, safe='')}.zip"
                    ),
                    "date": date,
                })
            self._cache.extend(new_tags)
            self._page += 1
            for tag_obj in new_tags:
                yield tag_obj


class BranchesPager:
    def __init__(self, session: aiohttp.ClientSession, owner: str, repo: str):
        self._session = session
        self.owner = owner
        self.repo = repo
        self._page = 1
        self._cache: list[BranchInfo] = []

    def __aiter__(self):
        return self._generator()

    async def _generator(self):
        for branch in self._cache:
            yield branch

        while True:
            url = (
                f"{CODEBERG_API_URL}/repos/{self.owner}/{self.repo}"
                f"/branches?page={self._page}&limit=50"
            )
            data = await fetch_json(self._session, url)
            if not data:
                break
            new_branches: list[BranchInfo] = []
            for branch in data:
                name = branch["name"]
                commit = branch.get("commit") or {}
                raw_date = commit.get("created") or commit.get("timestamp") or ""
                if not raw_date:
                    err(
                        "Skip branch `{branch}` from "
                        f"https://codeberg.org/{self.owner}/{self.repo} "
                        "which has no date"
                    )
                    continue
                date = normalize_tz_aware_datetime(raw_date)
                new_branches.append({
                    "name": name,
                    "url": (
                        f"{CODEBERG_API_URL}/repos/{self.owner}/{self.repo}/archive/"
                        f"{quote(name, safe='')}.zip"
                    ),
                    "date": date,
                })
            self._cache.extend(new_branches)
            self._page += 1
            for branch_obj in new_branches:
                yield branch_obj


async def fetch_codeberg_info(
    session: aiohttp.ClientSession, codeberg_url: str, scopes: Iterable[QueryScope]
) -> RepoInfo:
    owner, repo = parse_owner_repo(codeberg_url)
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
                url = f"https://codeberg.org/{owner_repo}"
        else:
            url = "https://codeberg.org/ISSOtm/sublime-Bison"

        print(f"Fetching Codeberg info for: {url}")
        async with aiohttp.ClientSession() as session:
            info = await fetch_codeberg_info(session, url, ("METADATA", "TAGS", "BRANCHES"))
            metadata_for_display = {
                key: value
                for key, value in info["metadata"].items()
                if key != "readme_content"
            }
            print("Metadata", json.dumps(metadata_for_display, indent=2, ensure_ascii=False))
            if readme_content := info["metadata"].get("readme_content"):
                print("README preview:")
                for line in readme_content.splitlines()[:3]:
                    print(line)
            print("Tags:")
            async for tag in info["tags"]:
                print(tag)
            print("Branches:")
            async for branch in info["branches"]:
                print(branch)
    asyncio.run(main())
