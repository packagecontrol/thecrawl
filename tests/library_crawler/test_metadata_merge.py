import aiohttp
import pytest

import scripts.crawl_libraries as crawl_libraries


def build_pypi_data(summary: str, author: str, issues: str):
    return {
        "info": {
            "summary": summary,
            "author": author,
            "bugtrack_url": issues,
            "project_urls": {},
        },
        "releases": {
            "1.0.0": [
                {
                    "filename": "example-1.0.0-py3-none-any.whl",
                    "packagetype": "bdist_wheel",
                    "upload_time": "2025-01-01T00:00:00Z",
                    "url": "https://files.example.com/example-1.0.0.whl",
                    "digests": {"sha256": "deadbeef"},
                }
            ]
        },
    }


def build_library():
    return {
        "name": "Example",
        "releases": [
            {
                "base": "https://pypi.org/project/example",
                "asset": "example-*-py3-none-any.whl",
                "platforms": "windows-x64",
                "python_versions": "3.8",
            },
            {
                "base": "https://github.com/example/example",
                "asset": "example-*.whl",
                "platforms": "windows-x64",
                "python_versions": "3.8",
            },
        ],
    }


@pytest.mark.asyncio
async def test_library_metadata_always_wins(monkeypatch, tmp_path):
    async def fake_fetch_pypi_json(name, cache_dir, aio_session, ttl_seconds=0):
        return build_pypi_data("pypi desc", "pypi author", "https://pypi/issues"), "network"

    async def fake_resolve_github_releases(session, github_asset_defs):
        return [], {
            "description": "gh desc",
            "author": "gh author",
            "issues": "https://gh/issues",
        }

    monkeypatch.setattr(crawl_libraries, "fetch_pypi_json", fake_fetch_pypi_json)
    monkeypatch.setattr(
        crawl_libraries, "resolve_github_releases", fake_resolve_github_releases
    )
    monkeypatch.setenv("GITHUB_TOKEN", "token")

    library = build_library() | {
        "description": "lib desc",
        "author": "lib author",
        "issues": "https://lib/issues",
    }

    async with aiohttp.ClientSession() as session:
        info, _sources = await crawl_libraries.resolve_library(
            library, tmp_path / "cache", session
        )

    assert info["description"] == "lib desc"
    assert info["author"] == "lib author"
    assert info["issues"] == "https://lib/issues"


@pytest.mark.asyncio
async def test_pypi_metdata_overwrites_github(monkeypatch, tmp_path):
    async def fake_fetch_pypi_json(name, cache_dir, aio_session, ttl_seconds=0):
        return build_pypi_data("pypi desc", "pypi author", "https://pypi/issues"), "network"

    async def fake_resolve_github_releases(session, github_asset_defs):
        return [], {
            "description": "gh desc",
            "author": "gh author",
            "issues": None,
        }

    monkeypatch.setattr(crawl_libraries, "fetch_pypi_json", fake_fetch_pypi_json)
    monkeypatch.setattr(
        crawl_libraries, "resolve_github_releases", fake_resolve_github_releases
    )
    monkeypatch.setenv("GITHUB_TOKEN", "token")

    library = build_library()

    async with aiohttp.ClientSession() as session:
        info, _sources = await crawl_libraries.resolve_library(
            library, tmp_path / "cache", session
        )

    assert info["description"] == "pypi desc"
    assert info["author"] == "pypi author"
    assert info["issues"] == "https://pypi/issues"
