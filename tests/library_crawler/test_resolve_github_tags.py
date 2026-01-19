import pytest

import scripts._resolve_lib as resolve_lib


BASE_URL = "https://github.com/example/repo"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tag_name", "expected_version"),
    [
        ("1.2.0", "1.2.0"),
        ("v1.2.0", "1.2.0"),
    ],
)
async def test_resolve_tags_matches_true_tags(
    monkeypatch, tag_name, expected_version
):
    release = resolve_lib.normalize_release_def(
        {
            "base": BASE_URL,
            "platforms": "windows-x64",
            "python_versions": "3.8",
            "sublime_text": "*",
            "tags": True,
        }
    )
    github_tag_defs = {BASE_URL: [(release, False)]}
    tags = [
        {
            "name": tag_name,
            "url": f"https://example.com/tags/{tag_name}",
            "date": "2026-01-01T00:00:00Z",
        },
    ]

    async def fake_fetch_github_info(session, url, scopes, *, hints=None):
        return {"tags": async_iter(tags)}

    monkeypatch.setattr(resolve_lib, "fetch_github_info", fake_fetch_github_info)

    session = object()
    downloads, metadata = await resolve_lib.resolve_github_tags(
        session, github_tag_defs
    )

    assert metadata == {}
    assert len(downloads) == 1
    info = downloads[0]
    assert info["version"] == expected_version
    assert info["date"] == "2026-01-01T00:00:00Z"
    assert info["url"] == f"https://example.com/tags/{tag_name}"
    assert info["python_versions"] == ["3.8"]
    assert info["sublime_text"] == "*"
    assert info["platforms"] == ["windows-x64"]


@pytest.mark.asyncio
async def test_resolve_tags_matches_prefix_tags(monkeypatch):
    release = resolve_lib.normalize_release_def(
        {
            "base": BASE_URL,
            "platforms": "windows-x64",
            "python_versions": "3.8",
            "sublime_text": "*",
            "tags": "st4147-",
        }
    )
    github_tag_defs = {BASE_URL: [(release, False)]}
    tags = [
        {
            "name": "v1.5.0",
            "url": "https://example.com/tags/v1.5.0",
            "date": "2026-01-03T00:00:00Z",
        },
        {
            "name": "st4147-1.4.0",
            "url": "https://example.com/tags/st4147-1.4.0",
            "date": "2026-01-02T00:00:00Z",
        },
    ]

    async def fake_fetch_github_info(session, url, scopes, *, hints=None):
        return {"tags": async_iter(tags)}

    monkeypatch.setattr(resolve_lib, "fetch_github_info", fake_fetch_github_info)

    session = object()
    downloads, _metadata = await resolve_lib.resolve_github_tags(
        session, github_tag_defs
    )

    assert len(downloads) == 1
    info = downloads[0]
    assert info["version"] == "1.4.0"
    assert info["url"] == "https://example.com/tags/st4147-1.4.0"


@pytest.mark.asyncio
async def test_resolve_tags_respects_version_spec(monkeypatch):
    release = resolve_lib.normalize_release_def(
        {
            "base": BASE_URL,
            "platforms": "windows-x64",
            "python_versions": "3.8",
            "sublime_text": "<4000",
            "tags": True,
            "version": "<3",
        }
    )
    github_tag_defs = {BASE_URL: [(release, False)]}
    tags = [
        {
            "name": "3.1.0",
            "url": "https://example.com/tags/3.1.0",
            "date": "2026-01-03T00:00:00Z",
        },
        {
            "name": "2.9.0",
            "url": "https://example.com/tags/2.9.0",
            "date": "2026-01-02T00:00:00Z",
        },
    ]

    async def fake_fetch_github_info(session, url, scopes, *, hints=None):
        return {"tags": async_iter(tags)}

    monkeypatch.setattr(resolve_lib, "fetch_github_info", fake_fetch_github_info)

    session = object()
    downloads, metadata = await resolve_lib.resolve_github_tags(
        session, github_tag_defs
    )

    assert metadata == {}
    assert len(downloads) == 1
    info = downloads[0]
    assert info["version"] == "2.9.0"
    assert info["date"] == "2026-01-02T00:00:00Z"
    assert info["url"] == "https://example.com/tags/2.9.0"
    assert info["python_versions"] == ["3.8"]
    assert info["sublime_text"] == "<4000"
    assert info["platforms"] == ["windows-x64"]


@pytest.mark.asyncio
async def test_resolve_tags_includes_metadata(monkeypatch):
    release = resolve_lib.normalize_release_def(
        {
            "base": BASE_URL,
            "platforms": "windows-x64",
            "python_versions": "3.8",
            "sublime_text": "*",
            "tags": True,
        }
    )
    github_tag_defs = {BASE_URL: [(release, True)]}
    tags = [
        {
            "name": "1.2.0",
            "url": "https://example.com/tags/1.2.0",
            "date": "2026-01-01T00:00:00Z",
        },
    ]

    async def fake_fetch_github_info(session, url, scopes, *, hints=None):
        return {
            "tags": async_iter(tags),
            "metadata": {"description": "Repo desc"},
        }

    monkeypatch.setattr(resolve_lib, "fetch_github_info", fake_fetch_github_info)

    session = object()
    downloads, metadata = await resolve_lib.resolve_github_tags(
        session, github_tag_defs
    )

    assert metadata["homepage"] == BASE_URL
    assert metadata["description"] == "Repo desc"
    assert len(downloads) == 1


async def async_iter(items):
    for item in items:
        yield item
