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
