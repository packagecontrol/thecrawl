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
async def test_prerelease_tag_does_not_use_branch_fallback(set_now, set_github_info, capsys):
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

    set_github_info(github_info)

    await main_(registry, workspace, None, 100)
    err = capsys.readouterr().err
    assert (
        "No final tag found for https://github.com/example/pre-release-only; "
        "using prerelease 0.0.1-beta."
    ) in err

    package = workspace["packages"].get("PreReleaseOnly")
    assert package is not None

    releases = package.get("releases", [])
    assert len(releases) == 1

    release = releases[0]
    assert release["version"] == "0.0.1-beta"
    assert release["url"].endswith("v0.0.1-beta")
    assert release["date"] == "2024-05-10 12:00:00"


@pytest.mark.asyncio
async def test_tag_missing_falls_back_to_branch(set_now, set_github_info, capsys):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "BranchFallback",
                "details": "https://github.com/example/branch-fallback",
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
            "id": "R_branchfallback",
            "name": "BranchFallback",
            "description": "Fixture package with branch fallback",
            "homepage": "https://github.com/example/branch-fallback",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/branch-fallback/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01 00:00:00"
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "def456",
                "date": "2024-05-10 12:00:00",
                "url": "https://codeload.github.com/example/branch-fallback/zip/main"
            }
        ]
    }

    set_github_info(github_info)

    await main_(registry, workspace, None, 100)
    err = capsys.readouterr().err
    assert (
        "No valid version found for https://github.com/example/branch-fallback.  "
        "Falling back to tip of main."
    ) in err

    package = workspace["packages"].get("BranchFallback")
    assert package is not None
    releases = package.get("releases", [])
    assert len(releases) == 1
    assert releases[0]["version"] == "2024.05.10.12.00.00"
    assert releases[0]["url"].endswith("/main")


@pytest.mark.asyncio
async def test_tag_missing_and_branch_missing_logs_tag_error(set_now, set_github_info, capsys):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "NoTagNoBranch",
                "details": "https://github.com/example/no-tag-no-branch",
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
            "id": "R_notagnobranch",
            "name": "NoTagNoBranch",
            "description": "Fixture package with no tags and no branch",
            "homepage": "https://github.com/example/no-tag-no-branch",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/no-tag-no-branch/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01 00:00:00"
        },
        "tags": [],
        "branches": []
    }

    set_github_info(github_info)

    await main_(registry, workspace, None, 100)
    err = capsys.readouterr().err
    assert (
        "No valid version found for https://github.com/example/no-tag-no-branch.  "
        "Release definition cannot be fulfilled."
    ) in err

    package = workspace["packages"].get("NoTagNoBranch")
    assert package is not None
    assert package.get("invalid") is True


@pytest.mark.asyncio
async def test_branch_missing_logs_branch_error(set_now, set_github_info, capsys):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "BranchMissing",
                "details": "https://github.com/example/branch-missing",
                "releases": [
                    {
                        "sublime_text": "*",
                        "branch": True
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
            "id": "R_branchmissing",
            "name": "BranchMissing",
            "description": "Fixture package with missing branch",
            "homepage": "https://github.com/example/branch-missing",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/branch-missing/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01 00:00:00"
        },
        "tags": [],
        "branches": []
    }

    set_github_info(github_info)

    await main_(registry, workspace, None, 100)
    err = capsys.readouterr().err
    assert (
        "No branch named main found on https://github.com/example/branch-missing.  "
        "Release definition cannot be fulfilled."
    ) in err

    package = workspace["packages"].get("BranchMissing")
    assert package is not None
    assert package.get("invalid") is True


@pytest.mark.asyncio
async def test_branch_true_selects_default_branch(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "BranchDefault",
                "details": "https://github.com/example/branch-default",
                "releases": [
                    {
                        "sublime_text": "*",
                        "branch": True
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
            "id": "R_branchdefault",
            "name": "BranchDefault",
            "description": "Fixture package with default branch",
            "homepage": "https://github.com/example/branch-default",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/branch-default/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01 00:00:00"
        },
        "tags": [],
        "branches": [
            {
                "name": "dev",
                "version": "2024.05.09.12.00.00",
                "sha": "dev123",
                "date": "2024-05-09 12:00:00",
                "url": "https://codeload.github.com/example/branch-default/zip/dev"
            },
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "main123",
                "date": "2024-05-10 12:00:00",
                "url": "https://codeload.github.com/example/branch-default/zip/main"
            }
        ]
    }

    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("BranchDefault")
    assert package is not None
    releases = package.get("releases", [])
    assert len(releases) == 1
    assert releases[0]["version"] == "2024.05.10.12.00.00"
    assert releases[0]["url"].endswith("/main")


@pytest.mark.asyncio
async def test_branch_specific_selects_named_branch(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "BranchSpecific",
                "details": "https://github.com/example/branch-specific",
                "releases": [
                    {
                        "sublime_text": "*",
                        "branch": "troo"
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
            "id": "R_branchspecific",
            "name": "BranchSpecific",
            "description": "Fixture package with named branch",
            "homepage": "https://github.com/example/branch-specific",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/branch-specific/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01 00:00:00"
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.09.12.00.00",
                "sha": "main123",
                "date": "2024-05-09 12:00:00",
                "url": "https://codeload.github.com/example/branch-specific/zip/main"
            },
            {
                "name": "troo",
                "version": "2024.05.10.12.00.00",
                "sha": "troo123",
                "date": "2024-05-10 12:00:00",
                "url": "https://codeload.github.com/example/branch-specific/zip/troo"
            }
        ]
    }

    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("BranchSpecific")
    assert package is not None
    releases = package.get("releases", [])
    assert len(releases) == 1
    assert releases[0]["version"] == "2024.05.10.12.00.00"
    assert releases[0]["url"].endswith("/troo")


@pytest.mark.asyncio
async def test_branch_specific_missing_does_not_fallback(set_now, set_github_info, capsys):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "BranchSpecificMissing",
                "details": "https://github.com/example/branch-specific-missing",
                "releases": [
                    {
                        "sublime_text": "*",
                        "branch": "troo"
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
            "id": "R_branchspecificmissing",
            "name": "BranchSpecificMissing",
            "description": "Fixture package with missing named branch",
            "homepage": "https://github.com/example/branch-specific-missing",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/branch-specific-missing/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01 00:00:00"
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.09.12.00.00",
                "sha": "main123",
                "date": "2024-05-09 12:00:00",
                "url": "https://codeload.github.com/example/branch-specific-missing/zip/main"
            }
        ]
    }

    set_github_info(github_info)

    await main_(registry, workspace, None, 100)
    err = capsys.readouterr().err
    assert (
        "No branch named troo found on https://github.com/example/branch-specific-missing.  "
        "Release definition cannot be fulfilled."
    ) in err

    package = workspace["packages"].get("BranchSpecificMissing")
    assert package is not None
    assert package.get("invalid") is True


@pytest.mark.asyncio
async def test_tag_true_includes_prerelease_and_final(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "TagPrereleaseFinal",
                "details": "https://github.com/example/tag-prerelease-final",
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
            "id": "R_tagprereleasefinal",
            "name": "TagPrereleaseFinal",
            "description": "Fixture package with prerelease and final tags",
            "homepage": "https://github.com/example/tag-prerelease-final",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/tag-prerelease-final/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01 00:00:00"
        },
        "tags": [
            {
                "name": "v1.0.1-beta.1",
                "sha": "beta123",
                "date": "2024-05-09 12:00:00",
                "url": "https://codeload.github.com/example/tag-prerelease-final/zip/v1.0.1-beta.1"
            },
            {
                "name": "v1.0.1",
                "sha": "final123",
                "date": "2024-05-10 12:00:00",
                "url": "https://codeload.github.com/example/tag-prerelease-final/zip/v1.0.1"
            }
        ],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "main123",
                "date": "2024-05-10 12:00:00",
                "url": "https://codeload.github.com/example/tag-prerelease-final/zip/main"
            }
        ]
    }

    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("TagPrereleaseFinal")
    assert package is not None
    releases = package.get("releases", [])
    assert len(releases) == 2
    versions = {r["version"] for r in releases}
    assert versions == {"1.0.1", "1.0.1-beta.1"}


@pytest.mark.asyncio
async def test_hints_sent_to_fetcher(monkeypatch, set_now):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "HintsPkg",
                "details": "https://github.com/example/hints-pkg",
                "releases": [
                    {
                        "sublime_text": "*",
                        "branch": True
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {
        "packages": {
            "HintsPkg": {
                "name": "HintsPkg",
                "details": "https://github.com/example/hints-pkg",
                "hints": ["too_many_files"]
            }
        },
        "dependencies": []
    }

    seen_hints = []

    async def fake_fetch(session, url, scopes, *, hints=None):
        seen_hints.append(hints or [])
        raise RuntimeError("stop after verifying hints")

    monkeypatch.setattr("scripts.crawl.fetch_github_info", fake_fetch)
    set_now("2024-05-11 00:00:00")

    await main_(registry, workspace, None, 100)

    assert seen_hints == [["too_many_files"]]


@pytest.mark.asyncio
async def test_hints_persisted_from_metadata(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "HintsPkg",
                "details": "https://github.com/example/hints-pkg",
                "releases": [
                    {
                        "sublime_text": "*",
                        "branch": True
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
            "id": "R_hintspkg",
            "name": "HintsPkg",
            "description": "Fixture package with hints",
            "homepage": "https://github.com/example/hints-pkg",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/hints-pkg/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01 00:00:00",
            "hints": ["too_many_files", "extra_hint"]
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "main123",
                "date": "2024-05-10 12:00:00",
                "url": "https://codeload.github.com/example/hints-pkg/zip/main"
            }
        ]
    }

    set_now("2024-05-11 00:00:00")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("HintsPkg")
    assert package is not None
    assert package.get("hints") == ["too_many_files", "extra_hint"]


@pytest.mark.asyncio
async def test_repo_id_mismatch_same_url_is_fatal(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "RepoTakeover",
                "details": "https://github.com/example/repo-takeover",
                "releases": [
                    {
                        "sublime_text": "*",
                        "branch": True
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {
        "packages": {
            "RepoTakeover": {
                "name": "RepoTakeover",
                "details": "https://github.com/example/repo-takeover",
                "id": "OLD_ID"
            }
        },
        "dependencies": []
    }

    github_info = {
        "metadata": {
            "id": "NEW_ID",
            "name": "RepoTakeover",
            "description": "Fixture package with ID change",
            "homepage": "https://github.com/example/repo-takeover",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/repo-takeover/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01 00:00:00"
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "main123",
                "date": "2024-05-10 12:00:00",
                "url": "https://codeload.github.com/example/repo-takeover/zip/main"
            }
        ]
    }

    set_now("2024-05-11 00:00:00")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("RepoTakeover")
    assert package is not None
    assert package.get("fail_reason", "").startswith("fatal: Repository ID mismatch")


@pytest.mark.asyncio
async def test_repo_transfer_same_id_is_allowed(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "RepoTransfer",
                "details": "https://github.com/user-b/repo-transfer",
                "releases": [
                    {
                        "sublime_text": "*",
                        "branch": True
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {
        "packages": {
            "RepoTransfer": {
                "name": "RepoTransfer",
                "details": "https://github.com/user-a/repo-transfer",
                "id": "SAME_ID"
            }
        },
        "dependencies": []
    }

    github_info = {
        "metadata": {
            "id": "SAME_ID",
            "name": "RepoTransfer",
            "description": "Fixture package with repo transfer",
            "homepage": "https://github.com/user-b/repo-transfer",
            "author": "user-b",
            "readme": "https://raw.githubusercontent.com/user-b/repo-transfer/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01 00:00:00"
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "main123",
                "date": "2024-05-10 12:00:00",
                "url": "https://codeload.github.com/user-b/repo-transfer/zip/main"
            }
        ]
    }

    set_now("2024-05-11 00:00:00")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("RepoTransfer")
    assert package is not None
    assert package.get("fail_reason") is None
    assert package.get("id") == "SAME_ID"
    assert package.get("details") == "https://github.com/user-b/repo-transfer"


@pytest.mark.asyncio
async def test_registry_move_new_id_is_allowed(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "RegistryMove",
                "details": "https://github.com/new-owner/registry-move",
                "releases": [
                    {
                        "sublime_text": "*",
                        "branch": True
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {
        "packages": {
            "RegistryMove": {
                "name": "RegistryMove",
                "details": "https://github.com/old-owner/registry-move",
                "id": "OLD_ID"
            }
        },
        "dependencies": []
    }

    github_info = {
        "metadata": {
            "id": "NEW_ID",
            "name": "RegistryMove",
            "description": "Fixture package with registry move",
            "homepage": "https://github.com/new-owner/registry-move",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/new-owner/registry-move/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01 00:00:00"
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "main123",
                "date": "2024-05-10 12:00:00",
                "url": "https://codeload.github.com/new-owner/registry-move/zip/main"
            }
        ]
    }

    set_now("2024-05-11 00:00:00")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("RegistryMove")
    assert package is not None
    assert package.get("fail_reason") is None
    assert package.get("id") == "NEW_ID"
    assert package.get("details") == "https://github.com/new-owner/registry-move"
