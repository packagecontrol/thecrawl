import pytest

from scripts.crawl import main_


@pytest.mark.asyncio
async def test_github_release_asset_exact_name(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "A File Icon",
                "details": "https://github.com/SublimeText/AFileIcon",
                "releases": [
                    {
                        "asset": "A File Icon.sublime-package"
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0",
            }
        ],
    }

    workspace = {"packages": {}, "dependencies": []}

    github_info = {
        "metadata": {
            "id": "R_afi",
            "name": "A File Icon",
            "description": "Fixture package with asset releases",
            "homepage": "https://github.com/SublimeText/AFileIcon",
            "author": "SublimeText",
            "default_branch": "main",
            "created_at": "2024-01-01T00:00:00Z",
        },
        "releases": [
            {
                "name": "v2.0.0",
                "tag_name": "2.0.0",
                "date": "2026-01-02T19:57:17Z",
                "is_draft": False,
                "is_prerelease": False,
                "assets": [
                    {
                        "name": "A File Icon.sublime-package",
                        "url": "https://download.example.com/afi-2.0.0.sublime-package",
                    }
                ],
            },
            {
                "name": "v1.0.0",
                "tag_name": "1.0.0",
                "date": "2025-01-02T19:57:17Z",
                "is_draft": False,
                "is_prerelease": False,
                "assets": [
                    {
                        "name": "A File Icon.sublime-package",
                        "url": "https://download.example.com/afi-1.0.0.sublime-package",
                    }
                ],
            },
        ],
    }

    set_now("2026-01-02T22:30:46Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"]["A File Icon"]
    assert len(package["releases"]) == 1
    release = package["releases"][0]
    assert release["version"] == "2.0.0"
    assert release["url"] == "https://download.example.com/afi-2.0.0.sublime-package"
    assert release["date"] == "2026-01-02T19:57:17Z"
    assert release["sublime_text"] == "*"
    assert release["platforms"] == ["*"]
    assert "asset" not in release


@pytest.mark.asyncio
async def test_github_release_asset_glob(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "A File Icon",
                "details": "https://github.com/SublimeText/AFileIcon",
                "releases": [
                    {
                        "asset": "*.sublime-package"
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0",
            }
        ],
    }

    workspace = {"packages": {}, "dependencies": []}

    github_info = {
        "metadata": {},
        "releases": [
            {
                "name": "v2.1.0",
                "tag_name": "2.1.0",
                "date": "2026-02-03T10:11:12Z",
                "is_draft": False,
                "is_prerelease": False,
                "assets": [
                    {
                        "name": "A File Icon.sublime-package",
                        "url": "https://download.example.com/afi-2.1.0.sublime-package",
                    }
                ],
            }
        ],
    }

    set_now("2026-02-03T12:30:46Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    release = workspace["packages"]["A File Icon"]["releases"][0]
    assert release["version"] == "2.1.0"
    assert release["url"] == "https://download.example.com/afi-2.1.0.sublime-package"
    assert release["sublime_text"] == "*"
    assert release["platforms"] == ["*"]


@pytest.mark.asyncio
async def test_github_release_assets_by_sublime_text(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "Less",
                "details": "https://github.com/SublimeText/Less",
                "releases": [
                    {
                        "asset": "Less-${version}-st${st_build}.sublime-package",
                        "sublime_text": ["4107 - 4148", ">=4149"],
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0",
            }
        ],
    }

    workspace = {"packages": {}, "dependencies": []}

    github_info = {
        "metadata": {},
        "releases": [
            {
                "name": "v1.2.3",
                "tag_name": "1.2.3",
                "date": "2026-03-04T10:11:12Z",
                "is_draft": False,
                "is_prerelease": False,
                "assets": [
                    {
                        "name": "Less-1.2.3-st4107.sublime-package",
                        "url": "https://download.example.com/less-st4107.sublime-package",
                    },
                    {
                        "name": "Less-1.2.3-st4149.sublime-package",
                        "url": "https://download.example.com/less-st4149.sublime-package",
                    },
                ],
            }
        ],
    }

    set_now("2026-03-04T12:30:46Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    releases = workspace["packages"]["Less"]["releases"]
    assert len(releases) == 2
    by_st = {item["sublime_text"]: item for item in releases}
    assert by_st["4107 - 4148"]["url"] == "https://download.example.com/less-st4107.sublime-package"
    assert by_st[">=4149"]["url"] == "https://download.example.com/less-st4149.sublime-package"
    assert all(item["version"] == "1.2.3" for item in releases)
    assert all(item["date"] == "2026-03-04T10:11:12Z" for item in releases)


@pytest.mark.asyncio
async def test_github_release_assets_by_platform(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "PackageWithAsset",
                "details": "https://github.com/SublimeText/PackageWithAsset",
                "releases": [
                    {
                        "asset": "FileName-${platform}.sublime-package",
                        "platforms": ["linux-x64", "osx-x64"],
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0",
            }
        ],
    }

    workspace = {"packages": {}, "dependencies": []}

    github_info = {
        "metadata": {},
        "releases": [
            {
                "name": "v3.0.0",
                "tag_name": "3.0.0",
                "date": "2026-06-01T00:00:00Z",
                "is_draft": False,
                "is_prerelease": False,
                "assets": [
                    {
                        "name": "FileName-linux-x64.sublime-package",
                        "url": "https://download.example.com/pkg-linux-x64-3.0.0.sublime-package",
                    }
                ],
            },
            {
                "name": "v2.9.0",
                "tag_name": "2.9.0",
                "date": "2026-05-01T00:00:00Z",
                "is_draft": False,
                "is_prerelease": False,
                "assets": [
                    {
                        "name": "FileName-linux-x64.sublime-package",
                        "url": "https://download.example.com/pkg-linux-x64-2.9.0.sublime-package",
                    },
                    {
                        "name": "FileName-osx-x64.sublime-package",
                        "url": "https://download.example.com/pkg-osx-x64-2.9.0.sublime-package",
                    },
                ],
            },
        ],
    }

    set_now("2026-06-02T12:30:46Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    releases = workspace["packages"]["PackageWithAsset"]["releases"]
    assert len(releases) == 2
    by_platform = {item["platforms"][0]: item for item in releases}
    assert by_platform["linux-x64"]["url"] == "https://download.example.com/pkg-linux-x64-3.0.0.sublime-package"
    assert by_platform["linux-x64"]["version"] == "3.0.0"
    assert by_platform["osx-x64"]["url"] == "https://download.example.com/pkg-osx-x64-2.9.0.sublime-package"
    assert by_platform["osx-x64"]["version"] == "2.9.0"
    assert all(item["sublime_text"] == "*" for item in releases)


@pytest.mark.asyncio
async def test_github_release_assets_tag_prefix(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "PrefixedAssets",
                "details": "https://github.com/SublimeText/PrefixedAssets",
                "releases": [
                    {
                        "asset": "Prefixed-${version}.sublime-package",
                        "tags": "st4107-",
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0",
            }
        ],
    }

    workspace = {"packages": {}, "dependencies": []}

    github_info = {
        "metadata": {},
        "releases": [
            {
                "name": "v9.9.9",
                "tag_name": "9.9.9",
                "date": "2026-07-15T00:00:00Z",
                "is_draft": False,
                "is_prerelease": False,
                "assets": [
                    {
                        "name": "Prefixed-9.9.9.sublime-package",
                        "url": "https://download.example.com/prefixed-9.9.9.sublime-package",
                    }
                ],
            },
            {
                "name": "st4107-3.1.0",
                "tag_name": "st4107-3.1.0",
                "date": "2026-07-01T00:00:00Z",
                "is_draft": False,
                "is_prerelease": False,
                "assets": [
                    {
                        "name": "Prefixed-3.1.0.sublime-package",
                        "url": "https://download.example.com/prefixed-3.1.0.sublime-package",
                    }
                ],
            },
        ],
    }

    set_now("2026-07-02T12:30:46Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    release = workspace["packages"]["PrefixedAssets"]["releases"][0]
    assert release["version"] == "3.1.0"
    assert release["url"] == "https://download.example.com/prefixed-3.1.0.sublime-package"


@pytest.mark.asyncio
async def test_github_release_assets_tag_prefix_with_version_spec(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "PrefixedAssets",
                "details": "https://github.com/SublimeText/PrefixedAssets",
                "releases": [
                    {
                        "asset": "Prefixed-${version}.sublime-package",
                        "tags": "st4107-",
                        "version": ">=2,<3",
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0",
            }
        ],
    }

    workspace = {"packages": {}, "dependencies": []}

    github_info = {
        "metadata": {},
        "releases": [
            {
                "name": "st4107-3.1.0",
                "tag_name": "st4107-3.1.0",
                "date": "2026-07-01T00:00:00Z",
                "is_draft": False,
                "is_prerelease": False,
                "assets": [
                    {
                        "name": "Prefixed-3.1.0.sublime-package",
                        "url": "https://download.example.com/prefixed-3.1.0.sublime-package",
                    }
                ],
            },
            {
                "name": "st4107-2.5.0",
                "tag_name": "st4107-2.5.0",
                "date": "2026-06-01T00:00:00Z",
                "is_draft": False,
                "is_prerelease": False,
                "assets": [
                    {
                        "name": "Prefixed-2.5.0.sublime-package",
                        "url": "https://download.example.com/prefixed-2.5.0.sublime-package",
                    }
                ],
            },
        ],
    }

    set_now("2026-07-02T12:30:46Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    release = workspace["packages"]["PrefixedAssets"]["releases"][0]
    assert release["version"] == "2.5.0"
    assert release["url"] == "https://download.example.com/prefixed-2.5.0.sublime-package"


@pytest.mark.asyncio
async def test_github_release_assets_missing_platform_logs_error(set_now, set_github_info, capsys):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "PackageWithAsset",
                "details": "https://github.com/SublimeText/PackageWithAsset",
                "releases": [
                    {
                        "asset": "FileName-${platform}.sublime-package",
                        "platforms": ["linux-x64", "osx-x64"],
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0",
            }
        ],
    }

    workspace = {"packages": {}, "dependencies": []}

    github_info = {
        "metadata": {},
        "releases": [
            {
                "name": "v1.0.0",
                "tag_name": "1.0.0",
                "date": "2026-08-01T00:00:00Z",
                "is_draft": False,
                "is_prerelease": False,
                "assets": [
                    {
                        "name": "FileName-linux-x64.sublime-package",
                        "url": "https://download.example.com/pkg-linux-x64-1.0.0.sublime-package",
                    }
                ],
            }
        ],
    }

    set_now("2026-08-02T12:30:46Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    err = capsys.readouterr().err
    assert "Missing release assets for https://github.com/SublimeText/PackageWithAsset for: (osx-x64, st_build=*)" in err


@pytest.mark.asyncio
async def test_github_release_assets_no_match_logs_error(set_now, set_github_info, capsys):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "PackageWithAsset",
                "details": "https://github.com/SublimeText/PackageWithAsset",
                "releases": [
                    {
                        "asset": "FileName-${platform}.sublime-package",
                        "platforms": ["linux-x64"],
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0",
            }
        ],
    }

    workspace = {"packages": {}, "dependencies": []}

    github_info = {
        "metadata": {},
        "releases": [
            {
                "name": "v1.0.0",
                "tag_name": "1.0.0",
                "date": "2026-08-01T00:00:00Z",
                "is_draft": False,
                "is_prerelease": False,
                "assets": [
                    {
                        "name": "OtherName-linux-x64.sublime-package",
                        "url": "https://download.example.com/other-linux-x64-1.0.0.sublime-package",
                    }
                ],
            }
        ],
    }

    set_now("2026-08-02T12:30:46Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    err = capsys.readouterr().err
    assert "No matching release asset found for https://github.com/SublimeText/PackageWithAsset" in err
