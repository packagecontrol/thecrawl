from __future__ import annotations
from datetime import datetime
import os
import aiohttp
import asyncio
import re
from time import time
from urllib.parse import urlparse

from typing import AsyncIterable, Literal, Iterable, TypedDict

from .utils import is_semver, drop_falsy

# This module exposes a single entrypoint
# fetch_repo_info(Url, Iterable[QueryScope]) -> RepoInfo
# fetch_repo_info("https://github.com/timbrel/GitSavvy", ("METADATA", "TAGS"))
# "tags" and "branches" are lazy fetched, unless you provide TAGS or BRANCHES as
# initial QueryScope, until exhausted. (Ref: TagPager and BranchesPager)

type QueryScope = Literal["METADATA", "TAGS", "BRANCHES", "SUPPORTED_SYNTAX"]
type Query = str | tuple[str, str]
type Url = str
type Sha = str
type IsoTimestamp = str


class RepoInfo(TypedDict):
    metadata: RepoMetadata
    tags: AsyncIterable[TagInfo]
    branches: AsyncIterable[BranchInfo]
    syntax_files: list[SyntaxInfo]
    rate_limit_info: RateLimitInfo


class RepoMetadata(TypedDict, total=False):
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


class TagInfo(TypedDict):
    name: str     # the ref-/ or tagname, e.g. v1.2.5
    url: Url
    date: IsoTimestamp
    sha: Sha


class BranchInfo(TypedDict):
    name: str
    version: str  # fake version constructed from the date
    url: Url
    date: IsoTimestamp
    sha: Sha


class SyntaxInfo(TypedDict):
    name: str     # filename without extension
    path: str     # full path in repo
    extension: str  # .sublime-syntax or .tmLanguage
    url: Url      # raw file URL


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
    stargazerCount
    createdAt

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
SUPPORTED_SYNTAX = (
    '',
    """
    files: object(expression: $branch_ex) {
      ... on Tree {
        entries {
          name
          type
          path
          object {
            ... on Tree {
              entries {
                name
                type
                path
                object {
                  ... on Tree {
                    entries {
                      name
                      type
                      path
                      object {
                        ... on Tree {
                          entries {
                            name
                            type
                            path
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    """
)
scope_to_query: dict[str, Query] = {
    "METADATA": METADATA,
    "TAGS": TAGS,
    "BRANCHES": BRANCHES,
    "SUPPORTED_SYNTAX": SUPPORTED_SYNTAX,
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


class GraphQLClientError(aiohttp.ClientResponseError):
    """Structured exception for GraphQL API errors with type/message."""


async def make_graphql_query(session: aiohttp.ClientSession, query: str, variables: dict) -> dict:
    global rate_limit_info

    token = os.getenv("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN env var is not set")

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }

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
    scopes: Iterable[QueryScope]
) -> RepoInfo:
    owner, repo = parse_owner_repo(github_url)
    variables = {
        "owner": owner,
        "name": repo,
        "expression": "HEAD:"
    }
    query = build_query(scope_to_query[scope] for scope in scopes)
    data = await make_graphql_query(session, query, variables)
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
            "donate": (repo_data.get("fundingLinks") or [{}])[0].get("url"),
            "default_branch": default_branch,
            "stars": repo_data.get("stargazerCount"),
            "created_at": repo_data.get("createdAt")[:19].replace('T', ' '),
        }) if "METADATA" in scopes else {},  # type: ignore[misc]
        "tags": TagPager(session, owner, repo, initial_data=repo_data.get("tags")),
        "branches": BranchesPager(session, owner, repo, initial_data=repo_data.get("branches")),
        "syntax_files": extract_syntax_files(repo_data.get("files", {}).get("entries", []), owner, repo, default_branch) if "SUPPORTED_SYNTAX" in scopes else [],
        "rate_limit_info": data["rate_limit_info"],
    }


def grab_tags(repo: str, entries) -> list[TagInfo]:
    tags: list[TagInfo] = []
    for node in entries["nodes"]:
        tag_name = node["name"]
        t = node["target"]
        commit = t.get("target", t)
        if "oid" not in commit:
            print("Skip tag with no oid:", node, "from", repo)
            continue
        tags.append({
            "name": tag_name,
            "sha": commit["oid"],
            "date": commit["committedDate"][:19].replace('T', ' '),
            "url": f"https://codeload.github.com/{repo}/zip/{tag_name}"
        })
    return tags


def grab_branches(repo: str, entries) -> list[BranchInfo]:
    branches: list[BranchInfo] = []
    for node in entries.get("nodes", []):
        commit = node["target"]
        branch_name = node["name"]
        date = commit["committedDate"][:19].replace('T', ' ')
        branches.append({
            "name": branch_name,
            "version": re.sub(r'\D', '.', date),
            "sha": commit["oid"],
            "date": date,
            "url": f"https://codeload.github.com/{repo}/zip/{branch_name}"
        })
    return branches


def strip_possible_prefix(version: str) -> str:
    """Strip possible build prefixes from a tag."""
    return re.sub(r'^(st\d+-|\d+-|v)', '', version)


def find_readme_url(entries, owner, repo, branch) -> str | None:
    for entry in entries or []:
        if entry["type"] == "blob" and entry["name"].lower() in _readme_filenames:
            return f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{entry['name']}"
    return None


def extract_syntax_files(entries, owner: str, repo: str, branch: str = "HEAD") -> list[SyntaxInfo]:
    """Recursively extract .sublime-syntax and .tmLanguage files from the repository tree."""
    syntax_files: list[SyntaxInfo] = []
    
    def traverse_entries(entries_list, current_path=""):
        for entry in entries_list or []:
            entry_path = entry.get("path", entry["name"])
            
            if entry["type"] == "blob":
                # Check if it's a syntax file
                if entry["name"].endswith(('.sublime-syntax', '.tmLanguage')):
                    name_without_ext = entry["name"].rsplit('.', 1)[0]
                    extension = '.' + entry["name"].rsplit('.', 1)[1]
                    
                    syntax_files.append({
                        "name": name_without_ext,
                        "path": entry_path,
                        "extension": extension,
                        "url": f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{entry_path}"
                    })
            
            elif entry["type"] == "tree":
                # Recursively traverse subdirectories
                nested_entries = entry.get("object", {}).get("entries", [])
                traverse_entries(nested_entries, entry_path)
    
    traverse_entries(entries)
    return syntax_files


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


def create_safe_alias(owner: str, repo: str) -> str:
    """
    Create a safe GraphQL alias from owner/repo names.
    GraphQL aliases must match [_A-Za-z][_0-9A-Za-z]*
    """
    import re
    # Combine owner and repo with underscore
    combined = f"{owner}_{repo}"
    # Replace invalid characters with underscores
    safe = re.sub(r'[^_0-9A-Za-z]', '_', combined)
    # Ensure it starts with a letter or underscore
    if safe and safe[0].isdigit():
        safe = f"repo_{safe}"
    return safe or "repo_unknown"


def build_batched_query(repo_queries: dict[str, tuple[str, str, set[QueryScope]]]) -> str:
    """
    Build a batched GraphQL query for multiple repositories.
    
    Args:
        repo_queries: Dict mapping alias -> (owner, repo, scopes)
        
    Returns:
        GraphQL query string that fetches all repositories in one request
    """
    queries = []
    all_variables = set()
    
    for alias, (owner, repo, scopes) in repo_queries.items():
        # Build the sub-queries for this repository
        sub_queries = [scope_to_query[scope] for scope in scopes]
        repo_query_parts = []
        
        for q in sub_queries:
            if isinstance(q, tuple):
                # Collect variables from this scope
                var_string = q[0]
                if var_string:
                    all_variables.add(var_string)
                repo_query_parts.append(q[1])
            else:
                repo_query_parts.append(q)
        
        # Build the repository query with alias - hardcode owner/repo to avoid variable complexity
        repo_query = f"""
        {alias}: repository(owner: "{owner}", name: "{repo}") {{
            {chr(10).join(repo_query_parts)}
        }}
        """
        queries.append(repo_query)
    
    # Only include variables that are actually used (don't include STD_VARS since owner/repo are hardcoded)
    var_list = list(all_variables)
    
    if var_list:
        return f"""
        query GetBatchedRepoMetadata({", ".join(drop_falsy(var_list))}) {{
            {chr(10).join(queries)}
        }}
        """
    else:
        return f"""
        query GetBatchedRepoMetadata {{
            {chr(10).join(queries)}
        }}
        """


async def fetch_batched_github_info(
    session: aiohttp.ClientSession,
    repo_requests: dict[str, tuple[str, str, set[QueryScope]]]
) -> dict[str, RepoInfo]:
    """
    Fetch GitHub info for multiple repositories in a single batched request.
    
    Args:
        session: aiohttp session
        repo_requests: Dict mapping alias -> (owner, repo, scopes)
        
    Returns:
        Dict mapping alias -> RepoInfo
    """
    if not repo_requests:
        return {}
    
    # Build the batched query
    query = build_batched_query(repo_requests)
    
    # Build variables with only the ones actually used in the query
    variables = {}
    
    # Check what scopes are being used to determine which variables to include
    all_scopes = set()
    for _, (_, _, scopes) in repo_requests.items():
        all_scopes.update(scopes)
    
    # Only include variables that are actually needed
    if "METADATA" in all_scopes:
        variables["branch_ex"] = "HEAD:"
    if "TAGS" in all_scopes:
        variables["tags_after"] = None
    if "BRANCHES" in all_scopes:
        variables["branches_after"] = None
    
    # Make the API call
    data = await make_graphql_query(session, query, variables)
    
    # Parse results for each repository
    results = {}
    for alias, (owner, repo, scopes) in repo_requests.items():
        repo_data = data.get(alias, {})
        if not repo_data:
            # Handle case where repository wasn't found or returned empty
            results[alias] = {
                "metadata": {},
                "tags": TagPager(session, owner, repo),
                "branches": BranchesPager(session, owner, repo),
                "syntax_files": [],
                "rate_limit_info": data.get("rate_limit_info", {}),
            }
            continue
            
        default_branch = repo_data.get("defaultBranchRef", {}).get("name", "master")
        
        results[alias] = {
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
                "donate": (repo_data.get("fundingLinks") or [{}])[0].get("url"),
                "default_branch": default_branch,
                "stars": repo_data.get("stargazerCount"),
                "created_at": repo_data.get("createdAt", "")[:19].replace('T', ' ') if repo_data.get("createdAt") else "",
            }) if "METADATA" in scopes else {},  # type: ignore[misc]
            "tags": TagPager(session, owner, repo, initial_data=repo_data.get("tags")),
            "branches": BranchesPager(session, owner, repo, initial_data=repo_data.get("branches")),
            "syntax_files": extract_syntax_files(repo_data.get("files", {}).get("entries", []), owner, repo, default_branch) if "SUPPORTED_SYNTAX" in scopes else [],
            "rate_limit_info": data.get("rate_limit_info", {}),
        }
    
    return results


if __name__ == "__main__":
    import sys

    async def main():
        if len(sys.argv) > 1:
            arg = sys.argv[1]
            if arg.startswith("https://"):
                url = arg
            else:
                owner_repo = arg.strip("/")
                url = f"https://github.com/{owner_repo}"
        else:
            url = "https://github.com/daverosoff/PreTeXtual"

        print(f"Fetching GitHub info for: {url}")
        async with aiohttp.ClientSession() as session:
            info = await fetch_github_info(session, url, ("METADATA", "TAGS", "BRANCHES", "SUPPORTED_SYNTAX"))
            print("Metadata:", info["metadata"])
            print("Tags:")
            async for tag in info["tags"]:
                print(tag)
            print("Branches:")
            async for branch in info["branches"]:
                print(branch)
            print("Syntax files:")
            for syntax_file in info["syntax_files"]:
                print(syntax_file)

        print("rate_limit_info", info["rate_limit_info"])

    asyncio.run(main())
