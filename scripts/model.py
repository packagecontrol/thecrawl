from __future__ import annotations
from typing import AsyncIterable, TypedDict, Literal

type QueryScope = Literal["METADATA", "RELEASES", "TAGS", "BRANCHES"]
type Url = str
type Sha = str
type IsoTimestamp = str


class RepoInfo(TypedDict):
    metadata: RepoMetadata
    branches: AsyncIterable[BranchInfo]
    tags: AsyncIterable[TagInfo]
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


class BranchInfo(TypedDict):
    name: str
    url: Url
    date: IsoTimestamp


class TagInfo(TypedDict):
    name: str
    url: Url
    date: IsoTimestamp


class ReleaseAssetInfo(TypedDict):
    name: str
    url: Url
    size: int | None
    content_type: str | None


class ReleaseInfo(TypedDict):
    name: str | None
    tag_name: str
    url: Url
    date: IsoTimestamp
    is_prerelease: bool
    is_draft: bool
    assets: list[ReleaseAssetInfo]


class RateLimitInfo(TypedDict):
    limit: int
    remaining: int
    used: int
    reset: int            # epoch seconds
    reset_formatted: str  # human-readable local timestamp
    resource: str
