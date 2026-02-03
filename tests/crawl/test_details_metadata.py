from copy import deepcopy

import pytest

from scripts.crawl import main_
from tests.crawl.conftest import AsyncList


@pytest.mark.asyncio
async def test_details_metadata_fetched_when_releases_use_other_base(
    set_now,
    monkeypatch,
):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "SeparateDetails",
                "details": "https://github.com/example/details-repo",
                "releases": [
                    {
                        "sublime_text": "*",
                        "tags": True,
                        "base": "https://github.com/example/release-repo",
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0",
            }
        ],
    }

    workspace = {"packages": {}}

    details_url = "https://github.com/example/details-repo"
    release_url = "https://github.com/example/release-repo"
    details_metadata = {
        "id": "R_separatedetails",
        "name": "SeparateDetails",
        "description": "Metadata lives on details repo",
        "homepage": details_url,
        "author": "example",
        "readme": "https://raw.githubusercontent.com/example/details-repo/main/README.md",
        "default_branch": "main",
        "stars": 0,
        "created_at": "2024-01-01T00:00:00Z",
    }
    release_metadata = {
        "id": "R_releasebase",
        "name": "ReleaseRepo",
        "description": "Release repo metadata",
        "homepage": release_url,
        "author": "example",
        "readme": "https://raw.githubusercontent.com/example/release-repo/main/README.md",
        "default_branch": "main",
        "stars": 1,
        "created_at": "2024-01-01T00:00:00Z",
    }
    release_tags = [
        {
            "name": "v1.0.0",
            "date": "2025-01-01T00:00:00Z",
            "url": "https://codeload.github.com/example/release-repo/zip/v1.0.0",
        }
    ]

    async def fetch_github_info(*_args, **_kwargs):
        url = _args[1]
        if url == details_url:
            return build_info(details_metadata)
        if url == release_url:
            return build_info(release_metadata, tags=release_tags, branches=[])
        raise AssertionError(f"Unexpected URL: {url}")

    set_now("2025-01-02T00:00:00Z")
    monkeypatch.setattr("scripts.crawl.fetch_github_info", fetch_github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("SeparateDetails")
    assert package is not None
    assert package.get("description") == "Metadata lives on details repo"
    assert package.get("author") == "example"
    assert package.get("details") == "https://github.com/example/details-repo"

    releases = package.get("releases", [])
    assert len(releases) == 1
    assert releases[0]["base"] == "https://github.com/example/release-repo"
    assert releases[0]["version"] == "1.0.0"


def build_info(metadata, tags=None, branches=None):
    info = {"metadata": deepcopy(metadata)}
    if tags is not None:
        info["tags"] = AsyncList(deepcopy(tags))
    if branches is not None:
        info["branches"] = AsyncList(deepcopy(branches))
    return info
