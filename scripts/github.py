from __future__ import annotations
from datetime import datetime
import json
import os
import aiohttp
import asyncio
import sys
from time import time
from urllib.parse import urlparse

from typing import AsyncIterable, Literal, Iterable, TypedDict

from .utils import drop_falsy, normalize_tz_aware_datetime

# This module exposes a single entrypoint
# fetch_repo_info(Url, Iterable[QueryScope]) -> RepoInfo
# fetch_repo_info("https://github.com/timbrel/GitSavvy", ("METADATA", "TAGS"))
# "tags" and "branches" are lazy fetched, unless you provide TAGS or BRANCHES as
# initial QueryScope, until exhausted. (Ref: TagPager and BranchesPager)

type QueryScope = Literal["METADATA", "TAGS", "BRANCHES"]
type QueryStr = str
type QueryVars = str
type Query = QueryStr | tuple[QueryVars, QueryStr]
type Url = str
type IsoTimestamp = str


class RepoInfo(TypedDict):
    metadata: RepoMetadata
    tags: AsyncIterable[TagInfo]
    branches: AsyncIterable[BranchInfo]
    rate_limit_info: RateLimitInfo


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
    hints: list[str]


class TagInfo(TypedDict):
    name: str     # the ref-/ or tagname, e.g. v1.2.5
    url: Url
    date: IsoTimestamp


class BranchInfo(TypedDict):
    name: str
    url: Url
    date: IsoTimestamp


class RateLimitInfo(TypedDict):
    limit: int
    remaining: int
    used: int
    reset: int            # epoch seconds
    reset_formatted: str  # human-readable local timestamp
    resource: str


rate_limit_info: RateLimitInfo = {
    "limit": 1000,
    "remaining": 1000,
    "used": 0,
    "reset": int(time()) + 3600,
    "reset_formatted": datetime.fromtimestamp(time() + 3600).strftime("%Y-%m-%d %H:%M:%S"),
    "resource": "core",
}
GITHUB_API_URL = "https://api.github.com/graphql"
FILES_THRESHOLD = int(os.getenv("FILES_THRESHOLD", "500"))

REPO_BASE_VARS: QueryVars = "$owner: String!, $name: String!"
METADATA = (
    """
    id
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
    stargazerCount
    createdAt
    archivedAt
    """
)
FILES = (
    '$branch_ex: String="HEAD:"',
    """
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
            tagger {
              date
            }
            target {
              ... on Commit {
                committedDate
              }
            }
          }
          ... on Commit {
            committedDate
          }
        }
      }
    }
    """
)
scope_to_query: dict[str, Query] = {
    "METADATA": METADATA,
    "FILES": FILES,
    "TAGS": TAGS,
    "BRANCHES": BRANCHES,
}


def build_query(sub_queries: Iterable[str | tuple[str, str]]) -> str:
    queries, vars = [], []
    for q in sub_queries:
        if isinstance(q, tuple):
            vars.append(q[0])
            queries.append(q[1])
        else:
            queries.append(q)

    return f"""
    query GetRepoMetadata({", ".join(drop_falsy([REPO_BASE_VARS] + vars))}) {{
      repository(owner: $owner, name: $name) {{
        {"\n".join(queries)}
      }}
    }}
    """


_readme_filenames = {
    'readme', 'readme.txt', 'readme.md', 'readme.mkd', 'readme.mdown',
    'readme.markdown', 'readme.textile', 'readme.creole', 'readme.rst'
}


def github_headers(accept: str) -> dict[str, str]:
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN env var is not set")
    return {
        "Authorization": f"Bearer {token}",
        "Accept": accept,
    }


async def fetch_root_entries_per_rest_api(
    session: aiohttp.ClientSession,
    owner: str,
    repo: str,
) -> list[dict]:
    url = f"https://api.github.com/repos/{owner}/{repo}/contents"
    async with session.get(
        url,
        headers=github_headers("application/vnd.github+json"),
        params={"ref": "HEAD"}
    ) as resp:
        if resp.status in {404, 409}:
            return []
        resp.raise_for_status()
        data = await resp.json()
        return data if isinstance(data, list) else []


class GraphQLClientError(aiohttp.ClientResponseError):
    """Structured exception for GraphQL API errors with type/message."""


async def make_graphql_query(session: aiohttp.ClientSession, query: str, variables: dict) -> dict:
    global rate_limit_info

    headers = github_headers("application/json")

    async with session.post(
        GITHUB_API_URL,
        json={"query": query, "variables": variables},
        headers=headers,
        raise_for_status=True
    ) as resp:
        data = await resp.json()
        if "errors" in data:
            first_error = data["errors"][0]
            message = first_error.get("message", "Unknown GraphQL error")
            error_type = first_error.get("type", "").upper()

            status_map = {
                "NOT_FOUND": 404,
                "FORBIDDEN": 403,
                "UNAUTHORIZED": 401,
                "RATE_LIMITED": 429,
                "INTERNAL": 502,
                "SERVICE_UNAVAILABLE": 503,
            }
            status = status_map.get(error_type, 400)

            raise GraphQLClientError(
                request_info=resp.request_info,
                history=resp.history,
                status=status,
                message=message,
                headers=resp.headers
            )

        reset_time = int(resp.headers.get("x-ratelimit-reset", 0))
        rv = data["data"]
        rv["rate_limit_info"] = {
            "limit": int(resp.headers.get("x-ratelimit-limit", 0)),
            "remaining": int(resp.headers.get("x-ratelimit-remaining", 0)),
            "used": int(resp.headers.get("x-ratelimit-used", 0)),
            "reset": reset_time,
            "resource": resp.headers.get("x-ratelimit-resource", "core"),
            "reset_formatted": datetime.fromtimestamp(reset_time).strftime("%Y-%m-%d %H:%M:%S")
        }
        # Update global rate limit info only if newer to count for unordered responses
        if rv["rate_limit_info"]["used"] > rate_limit_info["used"]:
            rate_limit_info.update(rv["rate_limit_info"])
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


async def fetch_github_info(
    session: aiohttp.ClientSession,
    github_url: str,
    scopes: Iterable[QueryScope],
    *,
    hints: list[str] = []
) -> RepoInfo:
    owner, repo = parse_owner_repo(github_url)

    final_scopes: list[str] = list(scopes)
    if "METADATA" in final_scopes and "too_many_files" not in hints:
        final_scopes.append("FILES")
    query = build_query(scope_to_query[scope] for scope in final_scopes)
    variables = {
        "owner": owner,
        "name": repo,
        "expression": "HEAD:"
    }
    data = await make_graphql_query(session, query, variables)

    rest_entries = (
        await fetch_root_entries_per_rest_api(session, owner, repo)
        if "METADATA" in final_scopes and "too_many_files" in hints
        else []
    )

    repo_data = data["repository"]
    default_branch = repo_data.get("defaultBranchRef", {}).get("name", "master")
    entries = (
        repo_data.get("files", {}).get("entries", [])
        if "FILES" in final_scopes
        else rest_entries
    )

    return {
        "metadata": drop_falsy({
            "id": repo_data.get("id"),
            "name": repo_data.get("name"),
            "description": repo_data.get("description"),
            "homepage": repo_data.get("homepageUrl"),
            "author": repo_data.get("owner", {}).get("login"),
            "readme": find_readme_url(entries, owner, repo, default_branch),
            "issues": repo_data.get("issuesUrl"),
            "donate": (repo_data.get("fundingLinks") or [{}])[0].get("url"),
            "default_branch": default_branch,
            "stars": repo_data.get("stargazerCount"),
            "created_at": repo_data.get("createdAt")[:19] + "Z",
            "archived_at":
                archived_at[:19] + "Z"
                if (archived_at := repo_data.get("archivedAt"))
                else None,
            "hints": ["too_many_files"] if len(entries) >= FILES_THRESHOLD else None,
        }) if "METADATA" in final_scopes else {},
        "tags": TagPager(session, owner, repo, initial_data=repo_data.get("tags")),
        "branches": BranchesPager(session, owner, repo, initial_data=repo_data.get("branches")),
        "rate_limit_info": data["rate_limit_info"],
    }


def grab_tags(repo: str, entries) -> list[TagInfo]:
    tags: list[TagInfo] = []
    for node in entries["nodes"]:
        tag_name = node["name"]
        t = node["target"]
        date = (
            t.get("tagger", {}).get("date")
            or t.get("target", t).get("committedDate")
        )
        if not date:
            err(
                f"Skip tag `{node}` from https://github.com/{repo} "
                "which has no tag or commit date"
            )
            continue
        tags.append({
            "name": tag_name,
            "date": normalize_tz_aware_datetime(date),
            "url": f"https://codeload.github.com/{repo}/zip/{tag_name}"
        })
    return tags


def grab_branches(repo: str, entries) -> list[BranchInfo]:
    branches: list[BranchInfo] = []
    for node in entries.get("nodes", []):
        commit = node["target"]
        branch_name = node["name"]
        date = commit["committedDate"][:19] + "Z"
        branches.append({
            "name": branch_name,
            "date": date,
            "url": f"https://codeload.github.com/{repo}/zip/{branch_name}"
        })
    return branches


def find_readme_url(entries, owner, repo, branch) -> str | None:
    for entry in entries or []:
        if (
            entry.get("type") in {"blob", "file"}
            and entry.get("name", "").lower() in _readme_filenames
        ):
            return f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{entry['name']}"
    return None


class TagPager:
    def __init__(
        self,
        session: aiohttp.ClientSession,
        owner: str,
        repo: str,
        initial_data: dict | None = None
    ):
        self._session = session
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
            result = await make_graphql_query(self._session, query, variables)
            new_tags = self._process_tags_data(result["repository"]["tags"])

            for tag in new_tags:
                yield tag

    async def prefetch(self):
        """Optional helper to fetch and cache all tags eagerly."""
        async for _ in self:
            pass


class BranchesPager:
    def __init__(
        self,
        session: aiohttp.ClientSession,
        owner: str,
        repo: str,
        initial_data: dict | None = None
    ):
        self._session = session
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
            result = await make_graphql_query(self._session, query, variables)
            branch_data = result["repository"]["branches"]
            new_branches = self._process_branch_data(branch_data)

            for branch in new_branches:
                yield branch

    async def prefetch(self):
        """Optional: Eagerly load all branches."""
        async for _ in self:
            pass


def err(*args, **kwargs) -> None:
    print(*args, **kwargs, file=sys.stderr)


if __name__ == "__main__":
    import argparse

    async def main():
        parser = argparse.ArgumentParser(description="Fetch GitHub info via GraphQL.")
        parser.add_argument(
            "repo",
            nargs="?",
            default="https://github.com/daverosoff/PreTeXtual",
            help="GitHub repo URL or owner/repo",
        )
        parser.add_argument(
            "--rest-files",
            action="store_true",
            help="Use REST for root files (skip GraphQL files).",
        )
        args = parser.parse_args()

        arg = args.repo
        if arg.startswith("https://"):
            url = arg
        else:
            owner_repo = arg.strip("/")
            url = f"https://github.com/{owner_repo}"

        print(f"Fetching GitHub info for: {url}")
        async with aiohttp.ClientSession() as session:
            hints = ["too_many_files"] if args.rest_files else []
            info = await fetch_github_info(
                session,
                url,
                ("METADATA", "TAGS", "BRANCHES"),
                hints=hints,
            )
            print("Metadata", json.dumps(info["metadata"], indent=2, ensure_ascii=False))
            print("Tags:")
            async for tag in info["tags"]:
                print(tag)
            print("Branches:")
            async for branch in info["branches"]:
                print(branch)

        print("rate_limit_info", info["rate_limit_info"])

    asyncio.run(main())
