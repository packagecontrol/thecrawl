from datetime import datetime
import os
import aiohttp
import asyncio
import re
from urllib.parse import urlparse

from typing import AsyncIterable, Literal, Iterable, TypedDict

from .utils import drop_falsy


STD_VARS = "$owner: String!, $name: String!"
METADATA = (
    '$branch_ex: String="HEAD:"',
    """
    name
    description
    homepageUrl
    owner {
      login
    }
    defaultBranchRef {
      name
    }
    fundingLinks {
      url
    }
    url

    files: object(expression: $branch_ex) {
      ... on Tree {
        entries {
          name
          type
        }
      }
    }
    """
)
BRANCHES = (
    '$branches_after: String',
    """
    branches: refs(
      refPrefix: "refs/heads/",
      first: 100
      after: $branches_after
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        name
        target {
          ... on Commit{
            oid
            committedDate
          }
        }
      }
    }
    """
)
TAGS = (
    '$tags_after: String',
    """
    tags: refs(
      refPrefix: "refs/tags/"
      first: 100
      after: $tags_after
      orderBy: {field: TAG_COMMIT_DATE, direction: DESC}
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        name
        target {
          ... on Tag {
            target {
              ... on Commit {
                oid
                committedDate
              }
            }
          }
          ... on Commit {
            oid
            committedDate
          }
        }
      }
    }
    """
)


def build_query(sub_queries: Iterable[str | tuple[str, str]]) -> str:
    queries, vars = [], []
    for q in sub_queries:
        if isinstance(q, tuple):
            vars.append(q[0])
            queries.append(q[1])
        else:
            queries.append(q)

    return f"""
    query GetRepoMetadata({", ".join(drop_falsy([STD_VARS] + vars))}) {{
      repository(owner: $owner, name: $name) {{
        {"\n".join(queries)}
      }}
    }}
    """


_readme_filenames = {
    'readme', 'readme.txt', 'readme.md', 'readme.mkd', 'readme.mdown',
    'readme.markdown', 'readme.textile', 'readme.creole', 'readme.rst'
}


GITHUB_API_URL = "https://api.github.com/graphql"


async def make_graphql_query(query: str, variables: dict) -> dict:
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN env var is not set")

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(
            GITHUB_API_URL,
            json={"query": query, "variables": variables},
            headers=headers,
            raise_for_status=True
        ) as resp:
            data = await resp.json()
            if "errors" in data:
                raise RuntimeError(f"GraphQL errors: {data['errors']}")
            rv = data["data"]
            reset_time = int(resp.headers.get("x-ratelimit-reset", 0))
            rv["rate_limit_info"] = {
                "limit": int(resp.headers.get("x-ratelimit-limit", 0)),
                "remaining": int(resp.headers.get("x-ratelimit-remaining", 0)),
                "used": int(resp.headers.get("x-ratelimit-used", 0)),
                "reset": reset_time,
                "resource": resp.headers.get("x-ratelimit-resource", "core"),
                "reset_formatted": datetime.fromtimestamp(reset_time).strftime("%Y-%m-%d %H:%M:%S")
            }
            return rv


def parse_owner_repo(url: str):
    """
    Extract owner and repo name from a GitHub URL.
    Example: https://github.com/timbrel/GitSavvy -> ("timbrel", "GitSavvy")
    """
    parts = urlparse(url)
    path_parts = parts.path.strip("/").split("/")
    if len(path_parts) < 2:
        raise ValueError("Invalid GitHub repo URL")
    return path_parts[0], path_parts[1]


type Scopes = Literal["METADATA", "TAGS", "BRANCHES"]
type Query = str | tuple[str, str]
type Url = str
type Sha = str
type IsoTimestamp = str
scope_to_query: dict[str, Query] = {
    "METADATA": METADATA,
    "TAGS": TAGS,
    "BRANCHES": BRANCHES,
}


class RepoMetadata(TypedDict, total=False):
    name: str
    description: str
    homepage: str
    author: str
    readme: str
    issues: str
    donate: str
    default_branch: str


class TagInfo(TypedDict):
    name: str     # name if the ref-/ or tagname
    version: str  # version is the name without prefixes (e.g. "v")
    url: Url
    date: IsoTimestamp
    sha: Sha


class BranchInfo(TypedDict):
    name: str
    url: Url
    date: IsoTimestamp
    sha: Sha


class RateLimitInfo(TypedDict):
    limit: int
    remaining: int
    used: int
    reset: int  # epoch seconds
    reset_formatted: str  # human-readable local timestamp
    resource: str


class RepoInfo(TypedDict):
    metadata: RepoMetadata
    tags: AsyncIterable[TagInfo]
    branches: AsyncIterable[BranchInfo]
    rate_limit_info: RateLimitInfo


async def fetch_repo_info(github_url: str, scopes: Iterable[Scopes]) -> RepoInfo:
    owner, repo = parse_owner_repo(github_url)
    variables = {
        "owner": owner,
        "name": repo,
        "expression": "HEAD:"
    }
    query = build_query(scope_to_query[scope] for scope in scopes)
    data = await make_graphql_query(query, variables)
    repo_data = data["repository"]

    default_branch = repo_data.get("defaultBranchRef", {}).get("name", "master")

    return {
        "metadata": drop_falsy({
            "name": repo_data.get("name"),
            "description": repo_data.get("description"),
            "homepage": repo_data.get("homepageUrl") or repo_data.get("url"),
            "author": repo_data.get("owner", {}).get("login"),
            "readme": find_readme_url(
                repo_data.get("files", {}).get("entries", []),
                owner,
                repo,
                default_branch,
            ),
            "issues": repo_data.get("issuesUrl"),
            "donate": repo_data.get("fundingLinks", [{}])[0].get("url"),
            "default_branch": default_branch,
        }),
        "tags": TagPager(owner, repo, initial_data=repo_data.get("tags")),
        "branches": BranchesPager(owner, repo, initial_data=repo_data.get("branches")),
        "rate_limit_info": data["rate_limit_info"],
    }


def grab_tags(repo: str, entries) -> list[TagInfo]:
    all_tags: list[TagInfo] = []
    for node in entries["nodes"]:
        t = node["target"]
        commit = t.get("target", t)
        branch_name = node["name"]
        all_tags.append({
            "name": branch_name,
            "version": strip_possible_prefix(node["name"]),
            "sha": commit["oid"],
            "date": commit["committedDate"][:19].replace('T', ' '),
            "url": f"https://codeload.github.com/{repo}/zip/{branch_name}"
        })
    return all_tags


def grab_branches(repo: str, entries) -> list[BranchInfo]:
    new_branches: list[BranchInfo] = []
    for node in entries.get("nodes", []):
        commit = node["target"]
        tag_name = node["name"]
        new_branches.append({
            "name": tag_name,
            "sha": commit["oid"],
            "date": commit["committedDate"][:19].replace('T', ' '),
            "url": f"https://codeload.github.com/{repo}/zip/{tag_name}"
        })
    return new_branches


def strip_possible_prefix(version: str) -> str:
    """Strip possible build prefixes from a tag."""
    return re.sub(r'^(st\d+-|\d+-|v)', '', version)


def find_readme_url(entries, owner, repo, branch) -> str | None:
    for entry in entries or []:
        if entry["type"] == "blob" and entry["name"].lower() in _readme_filenames:
            return f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{entry['name']}"
    return None


class TagPager:
    def __init__(self, owner: str, repo: str, initial_data: dict | None = None):
        self.owner = owner
        self.repo = repo
        self._cache: list[TagInfo] = []
        self._fetched_all = False
        self._next_cursor: str | None = None

        if initial_data:
            self._process_tags_data(initial_data)

    def _process_tags_data(self, tag_data: dict):
        tags = grab_tags(f"{self.owner}/{self.repo}", tag_data)
        self._cache.extend(tags)
        page_info = tag_data.get("pageInfo", {})
        self._fetched_all = not page_info.get("hasNextPage", False)
        self._next_cursor = page_info.get("endCursor")
        return tags

    def __aiter__(self):
        return self._generator()

    async def _generator(self):
        for tag in self._cache:
            yield tag

        while True:
            if self._fetched_all:
                break

            query = build_query([TAGS])
            variables = {
                "owner": self.owner,
                "name": self.repo,
                "tags_after": self._next_cursor
            }
            result = await make_graphql_query(query, variables)
            new_tags = self._process_tags_data(result["repository"]["tags"])

            for tag in new_tags:
                yield tag

    async def prefetch(self):
        """Optional helper to fetch and cache all tags eagerly."""
        async for _ in self:
            pass


class BranchesPager:
    def __init__(self, owner: str, repo: str, initial_data: dict | None = None):
        self.owner = owner
        self.repo = repo
        self._cache: list[BranchInfo] = []
        self._fetched_all = False
        self._next_cursor: str | None = None

        if initial_data:
            self._process_branch_data(initial_data)

    def _process_branch_data(self, branch_data: dict) -> list[BranchInfo]:
        branches = grab_branches(f"{self.owner}/{self.repo}", branch_data)
        self._cache.extend(branches)
        page_info = branch_data.get("pageInfo", {})
        self._fetched_all = not page_info.get("hasNextPage", False)
        self._next_cursor = page_info.get("endCursor")
        return branches

    def __aiter__(self):
        return self._generator()

    async def _generator(self):
        for branch in self._cache:
            yield branch

        while True:
            if self._fetched_all:
                break

            query = build_query([BRANCHES])
            variables = {
                "owner": self.owner,
                "name": self.repo,
                "branches_after": self._next_cursor
            }
            result = await make_graphql_query(query, variables)
            branch_data = result["repository"]["branches"]
            new_branches = self._process_branch_data(branch_data)

            for branch in new_branches:
                yield branch

    async def prefetch(self):
        """Optional: Eagerly load all branches."""
        async for _ in self:
            pass


async def main():
    url = "https://github.com/timbrel/GitSavvy"
    info = await fetch_repo_info(url, ("METADATA", "TAGS"))
    # for tag in info.get("tags", []):
    #     print(tag["version"], tag["name"], tag["url"])
    async for tag in info["tags"]:
        print(tag["version"], tag["name"], tag["url"])
    async for branch in info["branches"]:
        print(branch["name"], branch["sha"], branch["date"])

    print("rate_limit_info", info["rate_limit_info"])


if __name__ == "__main__":
    asyncio.run(main())
