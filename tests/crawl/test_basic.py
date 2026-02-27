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
    {"packages": {}}
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
    "created_at": "2015-01-18T05:40:08Z"
  },
  "tags": [
    {
      "name": "2.51.1",
      "sha": "f9914a898f39318f66e571e8e4a49af0d1ae2937",
      "date": "2025-06-25T14:14:09Z",
      "url": "https://codeload.github.com/timbrel/GitSavvy/zip/2.51.1"
    },
    {
      "name": "st3-2.39.1",
      "sha": "e4f642076522ab0a8785ec478414c1bd014fbe6b",
      "date": "2023-02-10T23:41:10Z",
      "url": "https://codeload.github.com/timbrel/GitSavvy/zip/st3-2.39.1"
    }
  ],
  "branches": [
    {
      "name": "master",
      "version": "2025.08.02.23.24.33",
      "sha": "5f3a58302b257ad7cf4724c2472fcc59479efe24",
      "date": "2025-08-02T23:24:33Z",
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
      "created_at": "2015-01-18T05:40:08Z",
      "details": "https://github.com/timbrel/GitSavvy",
      "releases": [
        {
          "sublime_text": "<4000",
          "platforms": ["*"],
          "base": "https://github.com/timbrel/GitSavvy",
          "date": "2023-02-10T23:41:10Z",
          "url": "https://codeload.github.com/timbrel/GitSavvy/zip/st3-2.39.1",
          "version": "2.39.1"
        },
        {
          "sublime_text": ">=4000",
          "platforms": ["*"],
          "base": "https://github.com/timbrel/GitSavvy",
          "date": "2025-06-25T14:14:09Z",
          "url": "https://codeload.github.com/timbrel/GitSavvy/zip/2.51.1",
          "version": "2.51.1"
        }
      ],
      "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
      "schema_version": "3.0.0",
      "first_seen": "2025-08-13T21:44:16Z",
      "last_seen": "2025-08-13T21:44:16Z",
      "last_modified": "2025-06-25T14:14:09Z",
      "next_crawl": "2025-08-13T23:44:16Z"
    }
  }
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
    set_now("2025-08-13T21:44:16Z")
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

    set_now("2025-08-13T21:44:16Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)
    assert workspace == expected


@pytest.mark.asyncio
async def test_metadata_name_is_essentially_ignored_as_registry_name_has_precedence(
    set_now,
    set_github_info
):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "RegistryName",
                "details": "https://github.com/example/name-ignored",
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

    workspace = {"packages": {}}

    github_info = {
        "metadata": {
            "id": "SAME_ID",
            "name": "MetadataName",
            "description": "Fixture package with metadata name",
            "homepage": "https://github.com/example/name-ignored",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/name-ignored/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "date": "2024-05-10T12:00:00Z",
                "url": "https://codeload.github.com/example/name-ignored/zip/main"
            }
        ]
    }

    set_now("2024-05-11T00:00:00Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("RegistryName")
    assert package is not None
    assert package.get("name") == "RegistryName"
    assert workspace["packages"].get("MetadataName") is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("date_input", "date_expected"),
    [
        ("2024-05-10 12:00:00", "2024-05-10T12:00:00Z"),
        ("2024-05-10 12:00", "2024-05-10T12:00:00Z"),
        ("2024-05-10", "2024-05-10T00:00:00Z"),
        ("2024-05-10T12:00:00Z", "2024-05-10T12:00:00Z"),
    ],
)
async def test_accept_stylized_dates_for_static_releases(
    date_input,
    date_expected,
    set_now,
    set_github_info
):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "StaticRelease",
                "details": "https://github.com/example/static-release",
                "releases": [
                    {
                        "sublime_text": "*",
                        "version": "1.2.3",
                        "url": "https://example.com/static-release.zip",
                        "date": date_input
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {"packages": {}}

    github_info = {
        "metadata": {
            "id": "R_staticrelease",
            "name": "StaticRelease",
            "description": "Fixture package with static release date",
            "homepage": "https://github.com/example/static-release",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/static-release/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01T00:00:00Z"
        }
    }

    set_now("2025-08-13T21:44:16Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("StaticRelease")
    assert package is not None
    release = package["releases"][0]
    assert release["date"] == date_expected


@pytest.mark.asyncio
async def test_missing_release_definitions_default_to_tags(set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "ImplicitRelease",
                "details": "https://github.com/example/implicit-release",
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {"packages": {}}

    github_info = {
        "metadata": {
            "id": "R_implicitrelease",
            "name": "ImplicitRelease",
            "description": "Fixture package with implicit release definition",
            "homepage": "https://github.com/example/implicit-release",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/implicit-release/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [
            {
                "name": "1.2.3",
                "sha": "abc123",
                "date": "2024-05-10T12:00:00Z",
                "url": "https://codeload.github.com/example/implicit-release/zip/1.2.3"
            }
        ],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.11.12.00.00",
                "sha": "def456",
                "date": "2024-05-11T12:00:00Z",
                "url": "https://codeload.github.com/example/implicit-release/zip/main"
            }
        ]
    }

    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("ImplicitRelease")
    assert package is not None

    releases = package.get("releases", [])
    assert len(releases) == 1
    assert releases[0]["sublime_text"] == "*"
    assert releases[0]["platforms"] == ["*"]
    assert releases[0]["version"] == "1.2.3"
    assert releases[0]["url"].endswith("/1.2.3")


@pytest.mark.asyncio
async def test_release_without_asset_or_branch_defaults_to_tags(set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "AutoTags",
                "details": "https://github.com/example/auto-tags",
                "releases": [
                    {
                        "sublime_text": "*"
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {"packages": {}}

    github_info = {
        "metadata": {
            "id": "R_autotags",
            "name": "AutoTags",
            "description": "Fixture package with implicit tags",
            "homepage": "https://github.com/example/auto-tags",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/auto-tags/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [
            {
                "name": "2.0.0",
                "sha": "abc123",
                "date": "2024-05-10T12:00:00Z",
                "url": "https://codeload.github.com/example/auto-tags/zip/2.0.0"
            }
        ],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.11.12.00.00",
                "sha": "def456",
                "date": "2024-05-11T12:00:00Z",
                "url": "https://codeload.github.com/example/auto-tags/zip/main"
            }
        ]
    }

    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("AutoTags")
    assert package is not None

    release = package["releases"][0]
    assert release["version"] == "2.0.0"
    assert release["url"].endswith("/2.0.0")


@pytest.mark.asyncio
async def test_version_constrained_tags_and_auto_open_ended_release(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "ConstrainedTags",
                "details": "https://github.com/example/constrained-tags",
                "releases": [
                    {
                        "sublime_text": "<4000",
                        "version": "<3.0.0"
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {"packages": {}}

    github_info = {
        "metadata": {
            "id": "R_constrainedtags",
            "name": "ConstrainedTags",
            "description": "Fixture package with constrained tags",
            "homepage": "https://github.com/example/constrained-tags",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/constrained-tags/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [
            {
                "name": "3.1.0",
                "sha": "sha310",
                "date": "2025-05-10T12:00:00Z",
                "url": "https://codeload.github.com/example/constrained-tags/zip/3.1.0"
            },
            {
                "name": "2.9.9",
                "sha": "sha299",
                "date": "2024-01-10T12:00:00Z",
                "url": "https://codeload.github.com/example/constrained-tags/zip/2.9.9"
            }
        ],
        "branches": [
            {
                "name": "main",
                "version": "2025.05.10.12.00.00",
                "sha": "def456",
                "date": "2025-05-10T12:00:00Z",
                "url": "https://codeload.github.com/example/constrained-tags/zip/main"
            }
        ]
    }

    set_now("2025-08-13T21:44:16Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("ConstrainedTags")
    assert package is not None

    by_st = {release["sublime_text"]: release for release in package["releases"]}
    assert by_st["<4000"]["version"] == "2.9.9"
    assert by_st[">3999"]["version"] == "3.1.0"


@pytest.mark.asyncio
async def test_unconstrained_tags_keep_legacy_semver_parsing(set_now, set_github_info, capsys):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "LegacySemverTags",
                "details": "https://github.com/example/legacy-semver-tags",
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

    workspace = {"packages": {}}

    github_info = {
        "metadata": {
            "id": "R_legacysemvertags",
            "name": "LegacySemverTags",
            "description": "Fixture package for legacy semver tags",
            "homepage": "https://github.com/example/legacy-semver-tags",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/legacy-semver-tags/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [
            {
                "name": "1.0rc1",
                "sha": "abc123",
                "date": "2024-05-10T12:00:00Z",
                "url": "https://codeload.github.com/example/legacy-semver-tags/zip/1.0rc1"
            }
        ],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "def456",
                "date": "2024-05-10T12:00:00Z",
                "url": "https://codeload.github.com/example/legacy-semver-tags/zip/main"
            }
        ]
    }

    set_now("2024-05-11T00:00:00Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    err = capsys.readouterr().err
    assert (
        "No valid version found for https://github.com/example/legacy-semver-tags.  "
        "Falling back to tip of main."
    ) in err

    package = workspace["packages"].get("LegacySemverTags")
    assert package is not None
    assert package["releases"][0]["version"] == "2024.05.10.12.00.00"


@pytest.mark.asyncio
async def test_constrained_tags_use_packaging_version_parsing(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "ConstrainedPep440Tags",
                "details": "https://github.com/example/constrained-pep440-tags",
                "releases": [
                    {
                        "sublime_text": "*",
                        "tags": True,
                        "version": ">=1.0rc1"
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {"packages": {}}

    github_info = {
        "metadata": {
            "id": "R_constrainedpep440tags",
            "name": "ConstrainedPep440Tags",
            "description": "Fixture package for constrained pep440 tags",
            "homepage": "https://github.com/example/constrained-pep440-tags",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/constrained-pep440-tags/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [
            {
                "name": "1.0rc1",
                "sha": "abc123",
                "date": "2024-05-10T12:00:00Z",
                "url": "https://codeload.github.com/example/constrained-pep440-tags/zip/1.0rc1"
            }
        ],
        "branches": []
    }

    set_now("2024-05-11T00:00:00Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("ConstrainedPep440Tags")
    assert package is not None
    assert package["releases"][0]["version"] == "1.0rc1"


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

    workspace = {"packages": {}}

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
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [
            {
                "name": "v0.0.1-beta",
                "sha": "abc123",
                "date": "2024-05-10T12:00:00Z",
                "url": "https://codeload.github.com/example/pre-release-only/zip/v0.0.1-beta"
            }
        ],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "def456",
                "date": "2024-05-10T12:00:00Z",
                "url": "https://codeload.github.com/example/pre-release-only/zip/main"
            }
        ]
    }

    set_github_info(github_info)

    await main_(registry, workspace, None, 100)
    err = capsys.readouterr().err
    assert (
        "No final tag found for https://github.com/example/pre-release-only.  "
        "Using the pre-release 0.0.1-beta."
    ) in err

    package = workspace["packages"].get("PreReleaseOnly")
    assert package is not None

    releases = package.get("releases", [])
    assert len(releases) == 1

    release = releases[0]
    assert release["version"] == "0.0.1-beta"
    assert release["url"].endswith("v0.0.1-beta")
    assert release["date"] == "2024-05-10T12:00:00Z"


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

    workspace = {"packages": {}}

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
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "def456",
                "date": "2024-05-10T12:00:00Z",
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

    workspace = {"packages": {}}

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
            "created_at": "2024-01-01T00:00:00Z"
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

    assert "No releases found for NoTagNoBranch" in err

    package = workspace["packages"].get("NoTagNoBranch")
    assert package is not None
    assert package.get("releases") == []
    assert package.get("description") == "Fixture package with no tags and no branch"
    assert package.get("author") == "example"
    assert package.get("homepage") == "https://github.com/example/no-tag-no-branch"


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

    workspace = {"packages": {}}

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
            "created_at": "2024-01-01T00:00:00Z"
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

    assert "No releases found for BranchMissing" in err

    package = workspace["packages"].get("BranchMissing")
    assert package is not None


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

    workspace = {"packages": {}}

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
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [],
        "branches": [
            {
                "name": "dev",
                "version": "2024.05.09.12.00.00",
                "sha": "dev123",
                "date": "2024-05-09T12:00:00Z",
                "url": "https://codeload.github.com/example/branch-default/zip/dev"
            },
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "main123",
                "date": "2024-05-10T12:00:00Z",
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

    workspace = {"packages": {}}

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
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.09.12.00.00",
                "sha": "main123",
                "date": "2024-05-09T12:00:00Z",
                "url": "https://codeload.github.com/example/branch-specific/zip/main"
            },
            {
                "name": "troo",
                "version": "2024.05.10.12.00.00",
                "sha": "troo123",
                "date": "2024-05-10T12:00:00Z",
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

    workspace = {"packages": {}}

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
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.09.12.00.00",
                "sha": "main123",
                "date": "2024-05-09T12:00:00Z",
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

    assert "No releases found for BranchSpecificMissing" in err

    package = workspace["packages"].get("BranchSpecificMissing")
    assert package is not None


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

    workspace = {"packages": {}}

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
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [
            {
                "name": "v1.0.1-beta.1",
                "sha": "beta123",
                "date": "2024-05-09T12:00:00Z",
                "url": "https://codeload.github.com/example/tag-prerelease-final/zip/v1.0.1-beta.1"
            },
            {
                "name": "v1.0.1",
                "sha": "final123",
                "date": "2024-05-10T12:00:00Z",
                "url": "https://codeload.github.com/example/tag-prerelease-final/zip/v1.0.1"
            }
        ],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "main123",
                "date": "2024-05-10T12:00:00Z",
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
async def test_tag_true_filters_to_running_year(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "TagRunningYear",
                "details": "https://github.com/example/tag-running-year",
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

    workspace = {"packages": {}}

    github_info = {
        "metadata": {
            "id": "R_tagrunningyear",
            "name": "TagRunningYear",
            "description": "Fixture package with running year tags",
            "homepage": "https://github.com/example/tag-running-year",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/tag-running-year/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [
            {
                "name": "v1.2.0",
                "sha": "new123",
                "date": "2026-06-01T00:00:00Z",
                "url": "https://codeload.github.com/example/tag-running-year/zip/v1.2.0"
            },
            {
                "name": "v1.2.1-beta.1",
                "sha": "beta123",
                "date": "2026-04-01T00:00:00Z",
                "url": "https://codeload.github.com/example/tag-running-year/zip/v1.2.1-beta.1"
            },
            {
                "name": "v1.1.0",
                "sha": "mid123",
                "date": "2025-08-01T00:00:00Z",
                "url": "https://codeload.github.com/example/tag-running-year/zip/v1.1.0"
            },
            {
                "name": "v1.0.0",
                "sha": "old123",
                "date": "2025-05-01T00:00:00Z",
                "url": "https://codeload.github.com/example/tag-running-year/zip/v1.0.0"
            }
        ],
        "branches": []
    }

    set_now("2026-07-01T00:00:00Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("TagRunningYear")
    assert package is not None
    releases = package.get("releases", [])
    assert len(releases) == 3
    versions = {release["version"] for release in releases}
    assert versions == {"1.2.0", "1.2.1-beta.1", "1.1.0"}


@pytest.mark.asyncio
async def test_tag_true_returns_latest_when_running_year_empty(
    set_now, set_github_info, capsys
):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "TagLatestRelease",
                "details": "https://github.com/example/tag-latest-release",
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

    workspace = {"packages": {}}

    github_info = {
        "metadata": {
            "id": "R_taglatestrelease",
            "name": "TagLatestRelease",
            "description": "Fixture package with old tags",
            "homepage": "https://github.com/example/tag-latest-release",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/tag-latest-release/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [
            {
                "name": "v2.1.0-beta.1",
                "sha": "beta123",
                "date": "2024-02-01T00:00:00Z",
                "url": "https://codeload.github.com/example/tag-latest-release/zip/v2.1.0-beta.1"
            },
            {
                "name": "v2.0.0",
                "sha": "new123",
                "date": "2024-01-01T00:00:00Z",
                "url": "https://codeload.github.com/example/tag-latest-release/zip/v2.0.0"
            },
            {
                "name": "v1.5.0",
                "sha": "old123",
                "date": "2023-06-01T00:00:00Z",
                "url": "https://codeload.github.com/example/tag-latest-release/zip/v1.5.0"
            }
        ],
        "branches": [
            {
                "name": "main",
                "version": "2024.01.01.00.00.00",
                "sha": "main123",
                "date": "2024-01-01T00:00:00Z",
                "url": "https://codeload.github.com/example/tag-latest-release/zip/main"
            }
        ]
    }

    set_now("2026-07-01T00:00:00Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)
    err = capsys.readouterr().err
    assert "Falling back to tip of" not in err

    package = workspace["packages"].get("TagLatestRelease")
    assert package is not None
    releases = package.get("releases", [])
    assert len(releases) == 2
    versions = {release["version"] for release in releases}
    assert versions == {"2.1.0-beta.1", "2.0.0"}


@pytest.mark.asyncio
async def test_tag_prefixes_do_not_apply_when_tags_true(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "CoffeeScript",
                "details": "https://github.com/SublimeText/CoffeeScript",
                "labels": [
                    "language syntax",
                    "linting",
                    "snippets",
                    "coffeescript"
                ],
                "previous_names": [
                    "Better CoffeeScript"
                ],
                "releases": [
                    {
                        "sublime_text": ">=4143",
                        "tags": "4143-"
                    },
                    {
                        "sublime_text": "3143 - 4142",
                        "tags": "3000-"
                    },
                    {
                        "sublime_text": "<3000",
                        "tags": True
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {"packages": {}}

    github_info = {
        "metadata": {
            "id": "MDEwOlJlcG9zaXRvcnk3MjkxNTMw",
            "name": "CoffeeScript",
            "description": (
                "Syntax highlighting and checking, commands, shortcuts, snippets, "
                "watched compilation and more."
            ),
            "author": "SublimeText",
            "readme": "https://raw.githubusercontent.com/SublimeText/CoffeeScript/master/README.md",
            "default_branch": "master",
            "stars": 442,
            "created_at": "2012-12-22T23:33:44Z"
        },
        "tags": [
            {
                "name": "4143-2.4.8",
                "date": "2026-01-02T19:57:17Z",
                "url": "https://codeload.github.com/SublimeText/CoffeeScript/zip/4143-2.4.8"
            },
            {
                "name": "3000-2.3.0",
                "date": "2024-08-25T13:53:06Z",
                "url": "https://codeload.github.com/SublimeText/CoffeeScript/zip/3000-2.3.0"
            },
            {
                "name": "v0.6.32",
                "date": "2013-02-03T00:13:32Z",
                "url": "https://codeload.github.com/SublimeText/CoffeeScript/zip/v0.6.32"
            }
        ],
        "branches": [
            {
                "name": "master",
                "version": "2026.01.02.19.57.17",
                "date": "2026-01-02T19:57:17Z",
                "url": "https://codeload.github.com/SublimeText/CoffeeScript/zip/master"
            }
        ]
    }

    set_now("2026-01-02T22:30:46Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("CoffeeScript")
    assert package is not None

    releases = {r["sublime_text"]: r for r in package["releases"]}
    assert releases[">=4143"]["version"] == "2.4.8"
    assert releases[">=4143"]["url"].endswith("/4143-2.4.8")
    assert releases["3143 - 4142"]["version"] == "2.3.0"
    assert releases["3143 - 4142"]["url"].endswith("/3000-2.3.0")
    assert releases["<3000"]["version"] == "0.6.32"
    assert releases["<3000"]["url"].endswith("/v0.6.32")
