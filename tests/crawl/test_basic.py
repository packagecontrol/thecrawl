import json
import pytest

from scripts.crawl import main_


REGISTRY = """
{
  "repositories": [
    "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
  ],
  "packages": [
    {
      "name": "GitSavvy",
      "details": "https://github.com/timbrel/GitSavvy",
      "releases": [
        {
          "sublime_text": "<4000",
          "tags": "st3-"
        },
        {
          "sublime_text": ">=4000",
          "tags": true
        }
      ],
      "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
      "schema_version": "3.0.0"
    }
  ]
}
"""

WORKSPACE = """
    {"packages": {}, "dependencies": []}
"""

GITHUB_INFO = """
{
  "metadata": {
    "id": "MDEwOlJlcG9zaXRvcnkyOTQxNzA3NA==",
    "name": "GitSavvy",
    "description": "Full git and GitHub integration with Sublime Text",
    "homepage": "https://github.com/timbrel/GitSavvy",
    "author": "timbrel",
    "readme": "https://raw.githubusercontent.com/timbrel/GitSavvy/master/README.md",
    "donate": "https://paypal.me/herrkaste",
    "default_branch": "master",
    "stars": 1928,
    "created_at": "2015-01-18 05:40:08"
  },
  "tags": [
    {
      "name": "2.51.1",
      "sha": "f9914a898f39318f66e571e8e4a49af0d1ae2937",
      "date": "2025-06-25 14:14:09",
      "url": "https://codeload.github.com/timbrel/GitSavvy/zip/2.51.1"
    },
    {
      "name": "st3-2.39.1",
      "sha": "e4f642076522ab0a8785ec478414c1bd014fbe6b",
      "date": "2023-02-10 23:41:10",
      "url": "https://codeload.github.com/timbrel/GitSavvy/zip/st3-2.39.1"
    }
  ],
  "branches": [
    {
      "name": "master",
      "version": "2025.08.02.23.24.33",
      "sha": "5f3a58302b257ad7cf4724c2472fcc59479efe24",
      "date": "2025-08-02 23:24:33",
      "url": "https://codeload.github.com/timbrel/GitSavvy/zip/master"
    }
  ]
}
"""

EXPECTED = """
{
  "packages": {
    "GitSavvy": {
      "id": "MDEwOlJlcG9zaXRvcnkyOTQxNzA3NA==",
      "name": "GitSavvy",
      "description": "Full git and GitHub integration with Sublime Text",
      "homepage": "https://github.com/timbrel/GitSavvy",
      "author": "timbrel",
      "readme": "https://raw.githubusercontent.com/timbrel/GitSavvy/master/README.md",
      "donate": "https://paypal.me/herrkaste",
      "default_branch": "master",
      "stars": 1928,
      "created_at": "2015-01-18 05:40:08",
      "details": "https://github.com/timbrel/GitSavvy",
      "releases": [
        {
          "sublime_text": "<4000",
          "platforms": ["*"],
          "base": "https://github.com/timbrel/GitSavvy",
          "date": "2023-02-10 23:41:10",
          "url": "https://codeload.github.com/timbrel/GitSavvy/zip/st3-2.39.1",
          "version": "2.39.1"
        },
        {
          "sublime_text": ">=4000",
          "platforms": ["*"],
          "base": "https://github.com/timbrel/GitSavvy",
          "date": "2025-06-25 14:14:09",
          "url": "https://codeload.github.com/timbrel/GitSavvy/zip/2.51.1",
          "version": "2.51.1"
        }
      ],
      "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
      "schema_version": "3.0.0",
      "first_seen": "2025-08-13 21:44:16",
      "last_seen": "2025-08-13 21:44:16",
      "last_modified": "2025-06-25 14:14:09",
      "next_crawl": "2025-08-13 23:44:16"
    }
  },
  "dependencies": []
}
"""


@pytest.fixture
def registry():
    return json.loads(REGISTRY)


@pytest.fixture
def workspace():
    return json.loads(WORKSPACE)


@pytest.fixture
def github_info():
    return json.loads(GITHUB_INFO)


@pytest.fixture()
def expected():
    return json.loads(EXPECTED)



@pytest.mark.asyncio
async def test_happy_path(
    registry,
    workspace,
    github_info,
    expected,
    set_now,
    set_github_info
):
    set_now("2025-08-13 21:44:16")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)
    assert workspace == expected


@pytest.mark.asyncio
async def test_drop_packagecontrolio_as_homepage(
    registry,
    workspace,
    github_info,
    expected,
    set_now,
    set_github_info
):
    github_info["metadata"]["homepage"] = "https://packagecontrol.io/packages/GitSavvy"
    expected["packages"]["GitSavvy"].pop("homepage")

    set_now("2025-08-13 21:44:16")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)
    assert workspace == expected


@pytest.mark.asyncio
async def test_prerelease_tag_does_not_use_branch_fallback(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "PreReleaseOnly",
                "details": "https://github.com/example/pre-release-only",
                "releases": [
                    {
                        "sublime_text": "*",
                        "tags": True
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {"packages": {}, "dependencies": []}

    github_info = {
        "metadata": {
            "id": "R_prereleaseonly",
            "name": "PreReleaseOnly",
            "description": "Fixture package with prerelease tag only",
            "homepage": "https://github.com/example/pre-release-only",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/pre-release-only/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01 00:00:00"
        },
        "tags": [
            {
                "name": "v0.0.1-beta",
                "sha": "abc123",
                "date": "2024-05-10 12:00:00",
                "url": "https://codeload.github.com/example/pre-release-only/zip/v0.0.1-beta"
            }
        ],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "def456",
                "date": "2024-05-10 12:00:00",
                "url": "https://codeload.github.com/example/pre-release-only/zip/main"
            }
        ]
    }

    set_now("2024-05-11 00:00:00")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("PreReleaseOnly")
    assert package is not None

    releases = package.get("releases", [])
    assert len(releases) == 1

    release = releases[0]
    assert release["version"] == "0.0.1-beta"
    assert release["url"].endswith("v0.0.1-beta")
    assert release["date"] == "2024-05-10 12:00:00"
