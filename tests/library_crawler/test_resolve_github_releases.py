import aiohttp
import pytest

import scripts._resolve_lib as resolve_lib


BASE_URL = "https://github.com/example/repo"
MISSING = object()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tag_name", "tags_value", "expected_version"),
    [
        ("1.2.0", MISSING, "1.2.0"),
        ("1.2.0", True, "1.2.0"),
        ("v1.3.0", MISSING, "1.3.0"),
        ("v1.3.0", True, "1.3.0"),
    ],
)
async def test_resolve_releases_matches_default_tags(
    monkeypatch, tag_name, tags_value, expected_version
):
    release = resolve_lib.normalize_release_def(
        {
            "base": BASE_URL,
            "asset": "pkg-${version}.whl",
            "platforms": "windows-x64",
            "python_versions": "3.8",
            "sublime_text": "*",
        }
    )
    if tags_value is not MISSING:
        release["tags"] = tags_value
    github_asset_defs = {BASE_URL: [(release, False)]}
    releases = [
        {
            "tag_name": tag_name,
            "is_draft": False,
            "assets": [
                {
                    "name": f"pkg-{expected_version}.whl",
                    "url": f"https://example.com/pkg-{expected_version}.whl",
                }
            ],
            "date": "2026-01-02T00:00:00Z",
        },
    ]

    async def fake_fetch_github_info(session, url, scopes, *, hints=None):
        return {"releases": async_iter(releases)}

    monkeypatch.setattr(resolve_lib, "fetch_github_info", fake_fetch_github_info)

    async with aiohttp.ClientSession() as session:
        downloads, metadata = await resolve_lib.resolve_github_releases(
            session, github_asset_defs
        )

    assert metadata == {}
    assert len(downloads) == 1
    info = downloads[0]
    assert info["url"] == f"https://example.com/pkg-{expected_version}.whl"
    assert info["version"] == expected_version
    assert info["date"] == "2026-01-02T00:00:00Z"
    assert info["platforms"] == ["windows-x64"]
    assert info["python_versions"] == ["3.8"]
    assert info["sublime_text"] == "*"


@pytest.mark.asyncio
async def test_resolve_releases_matches_prefix_tags(monkeypatch):
    release = resolve_lib.normalize_release_def(
        {
            "base": BASE_URL,
            "asset": "pkg-${version}.whl",
            "platforms": "windows-x64",
            "python_versions": "3.8",
            "sublime_text": "*",
            "tags": "st4117-",
        }
    )
    github_asset_defs = {BASE_URL: [(release, False)]}
    releases = [
        {
            "tag_name": "v1.5.0",
            "is_draft": False,
            "assets": [
                {
                    "name": "pkg-1.5.0.whl",
                    "url": "https://example.com/pkg-1.5.0.whl",
                }
            ],
            "date": "2026-01-05T00:00:00Z",
        },
        {
            "tag_name": "st4117-1.4.0",
            "is_draft": False,
            "assets": [
                {
                    "name": "pkg-1.4.0.whl",
                    "url": "https://example.com/pkg-1.4.0.whl",
                }
            ],
            "date": "2026-01-04T00:00:00Z",
        },
    ]

    async def fake_fetch_github_info(session, url, scopes, *, hints=None):
        return {"releases": async_iter(releases)}

    monkeypatch.setattr(resolve_lib, "fetch_github_info", fake_fetch_github_info)

    async with aiohttp.ClientSession() as session:
        downloads, _metadata = await resolve_lib.resolve_github_releases(
            session, github_asset_defs
        )

    assert len(downloads) == 1
    info = downloads[0]
    assert info["version"] == "1.4.0"
    assert info["url"] == "https://example.com/pkg-1.4.0.whl"


@pytest.mark.asyncio
async def test_resolve_releases_respects_version_spec(monkeypatch):
    release = resolve_lib.normalize_release_def(
        {
            "base": BASE_URL,
            "asset": "pkg-${version}.whl",
            "platforms": "windows-x64",
            "python_versions": "3.8",
            "sublime_text": "3015",
            "tags": True,
            "version": "<3",
        }
    )
    github_asset_defs = {BASE_URL: [(release, False)]}
    releases = [
        {
            "tag_name": "3.1.0",
            "is_draft": False,
            "assets": [
                {
                    "name": "pkg-3.1.0.whl",
                    "url": "https://example.com/pkg-3.1.0.whl",
                }
            ],
            "date": "2026-01-06T00:00:00Z",
        },
        {
            "tag_name": "2.9.0",
            "is_draft": False,
            "assets": [
                {
                    "name": "pkg-2.9.0.whl",
                    "url": "https://example.com/pkg-2.9.0.whl",
                }
            ],
            "date": "2026-01-05T00:00:00Z",
        },
    ]

    async def fake_fetch_github_info(session, url, scopes, *, hints=None):
        return {"releases": async_iter(releases)}

    monkeypatch.setattr(resolve_lib, "fetch_github_info", fake_fetch_github_info)

    async with aiohttp.ClientSession() as session:
        downloads, _metadata = await resolve_lib.resolve_github_releases(
            session, github_asset_defs
        )

    assert len(downloads) == 1
    info = downloads[0]
    assert info["version"] == "2.9.0"
    assert info["url"] == "https://example.com/pkg-2.9.0.whl"
    assert info["sublime_text"] == "3015"


async def async_iter(items):
    for item in items:
        yield item
