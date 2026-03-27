import pytest

import scripts.crawl as crawl_mod
from scripts.crawl import SkipCrawling, crawl, main_, maintenance


@pytest.mark.asyncio
async def test_skip_heartattack_keeps_fail_reason(set_now):
    entry = {
        "name": "RepoTakeover",
        "details": "https://github.com/example/repo-takeover",
        "releases": [{"sublime_text": "*", "branch": True}],
        "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
        "schema_version": "3.0.0",
    }
    existing = {
        "name": "RepoTakeover",
        "details": "https://github.com/example/repo-takeover",
        "source": entry["source"],
        "failing_since": "2024-04-01T00:00:00Z",
        "fail_reason":
            "fatal: Repository ID mismatch for "
            "https://github.com/example/repo-takeover: OLD != NEW",
    }

    set_now("2024-06-01T00:00:00Z")

    with pytest.raises(SkipCrawling):
        await crawl_mod.crawl_package(object(), entry, existing)


@pytest.mark.asyncio
async def test_crawl_keeps_fail_reason_on_heartattack_skip(set_now):
    entry = {
        "name": "RepoTakeover",
        "details": "https://github.com/example/repo-takeover",
        "releases": [{"sublime_text": "*", "branch": True}],
        "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
        "schema_version": "3.0.0",
    }
    existing = {
        "name": "RepoTakeover",
        "details": "https://github.com/example/repo-takeover",
        "source": entry["source"],
        "failing_since": "2024-04-01T00:00:00Z",
        "fail_reason":
            "fatal: Repository ID mismatch for "
            "https://github.com/example/repo-takeover: OLD != NEW",
    }

    set_now("2024-06-01T00:00:00Z")

    result = await crawl(object(), entry, existing)

    assert result.get("fail_reason") == existing["fail_reason"]
    assert result.get("failing_since") == existing["failing_since"]


@pytest.mark.asyncio
async def test_skip_404_after_month(set_now):
    entry = {
        "name": "MissingRepo",
        "details": "https://github.com/example/missing",
        "releases": [{"sublime_text": "*", "branch": True}],
        "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
        "schema_version": "3.0.0",
    }
    existing = {
        "name": "MissingRepo",
        "details": "https://github.com/example/missing",
        "source": entry["source"],
        "failing_since": "2024-04-15T00:00:00Z",
        "fail_reason": "fatal: 404 Not Found",
    }

    set_now("2024-06-01T00:00:00Z")

    with pytest.raises(SkipCrawling):
        await crawl_mod.crawl_package(object(), entry, existing)


@pytest.mark.asyncio
async def test_crawl_keeps_fail_reason_on_404_skip(set_now):
    entry = {
        "name": "MissingRepo",
        "details": "https://github.com/example/missing",
        "releases": [{"sublime_text": "*", "branch": True}],
        "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
        "schema_version": "3.0.0",
    }
    existing = {
        "name": "MissingRepo",
        "details": "https://github.com/example/missing",
        "source": entry["source"],
        "failing_since": "2024-04-15T00:00:00Z",
        "fail_reason": "fatal: 404 Not Found",
    }

    set_now("2024-06-01T00:00:00Z")

    result = await crawl(object(), entry, existing)

    assert result.get("fail_reason") == existing["fail_reason"]
    assert result.get("failing_since") == existing["failing_since"]


@pytest.mark.asyncio
async def test_crawl_error_adopts_registry_source_when_missing(set_now, monkeypatch):
    entry = {
        "name": "MissingSource",
        "details": "https://github.com/example/missing-source",
        "releases": [{"sublime_text": "*", "branch": True}],
        "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
        "schema_version": "3.0.0",
    }
    existing = {
        "name": "MissingSource",
        "details": "https://github.com/example/missing-source",
    }

    async def stub(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr("scripts.crawl.crawl_package", stub)
    set_now("2024-06-01T00:00:00Z")

    result = await crawl(object(), entry, existing)

    assert result.get("source") == entry["source"]


@pytest.mark.asyncio
async def test_removed_package_is_resurrected_on_trusted_source(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "Reappeared",
                "details": "https://github.com/example/reappeared",
                "releases": [{"sublime_text": "*", "branch": True}],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0",
            }
        ],
    }
    workspace = {
        "packages": {
            "Reappeared": {
                "name": "Reappeared",
                "removed": "2024-05-01T00:00:00Z",
                "source": "https://example.com/untrusted/old.json",
            }
        },
        "dependencies": [],
    }

    set_now("2024-06-01T00:00:00Z")
    set_github_info({
        "metadata": {
            "id": "SAME_ID",
            "name": "Reappeared",
            "description": "Fixture reappeared package",
            "homepage": "https://github.com/example/reappeared",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/reappeared/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01T00:00:00Z",
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "date": "2024-05-31T00:00:00Z",
                "url": "https://codeload.github.com/example/reappeared/zip/main",
            }
        ],
    })
    await main_(registry, workspace, None, 100)

    assert "removed" not in workspace["packages"]["Reappeared"]


@pytest.mark.asyncio
async def test_maintenance_imported_tombstone_resurrects_without_special_case(
    set_now,
    set_github_info,
):
    source = "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"

    workspace = {"packages": {}, "libraries": {}}
    registry_tombstoned = {
        "packages": [
            {
                "name": "Reappeared",
                "first_seen": "2019-01-01T00:00:00Z",
                "removed": "2024-05-01T00:00:00Z",
                "source": source,
                "labels": ["theme"],
            }
        ]
    }
    maintenance(registry_tombstoned, workspace)

    registry_active = {
        "packages": [
            {
                "name": "Reappeared",
                "details": "https://github.com/example/reappeared",
                "releases": [{"sublime_text": "*", "branch": True}],
                "source": source,
                "schema_version": "3.0.0",
            }
        ],
    }

    set_now("2024-06-01T00:00:00Z")
    set_github_info({
        "metadata": {
            "id": "SAME_ID",
            "name": "Reappeared",
            "description": "Fixture reappeared package",
            "homepage": "https://github.com/example/reappeared",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/reappeared/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01T00:00:00Z",
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "date": "2024-05-31T00:00:00Z",
                "url": "https://codeload.github.com/example/reappeared/zip/main",
            }
        ],
    })

    await main_(registry_active, workspace, None, 100)

    package = workspace["packages"]["Reappeared"]
    assert "removed" not in package
    assert package["source"] == source
    assert package["first_seen"] == "2019-01-01T00:00:00Z"


@pytest.mark.asyncio
async def test_retry_recent_404(set_now, monkeypatch):
    entry = {
        "name": "FlakyRepo",
        "details": "https://github.com/example/flaky",
        "releases": [{"sublime_text": "*", "branch": True}],
        "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
        "schema_version": "3.0.0",
    }
    existing = {
        "name": "FlakyRepo",
        "details": "https://github.com/example/flaky",
        "source": entry["source"],
        "failing_since": "2024-05-25T00:00:00Z",
        "fail_reason": "fatal: 404 Not Found",
    }
    called = {"value": False}

    async def stub(*args, **kwargs):
        called["value"] = True
        return {
            **entry,
            "releases": [{"date": "2024-05-31T00:00:00Z"}],
        }

    monkeypatch.setattr("scripts.crawl.crawl_package", stub)
    set_now("2024-06-01T00:00:00Z")

    result = await crawl(object(), entry, existing)

    assert called["value"] is True
    assert result.get("fail_reason") is None
    assert result.get("failing_since") is None


@pytest.mark.asyncio
async def test_resurrect_on_details_change(set_now, monkeypatch):
    entry = {
        "name": "RevivedRepo",
        "details": "https://github.com/example/revived-new",
        "releases": [{"sublime_text": "*", "branch": True}],
        "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
        "schema_version": "3.0.0",
    }
    existing = {
        "name": "RevivedRepo",
        "details": "https://github.com/example/revived-old",
        "source": entry["source"],
        "failing_since": "2024-04-01T00:00:00Z",
        "fail_reason":
            "fatal: Repository ID mismatch for "
            "https://github.com/example/revived-old: OLD != NEW",
    }
    called = {"value": False}

    async def stub(*args, **kwargs):
        called["value"] = True
        return {
            **entry,
            "releases": [{"date": "2024-05-31T00:00:00Z"}],
        }

    monkeypatch.setattr("scripts.crawl.crawl_package", stub)
    set_now("2024-06-01T00:00:00Z")

    result = await crawl(object(), entry, existing)

    assert called["value"] is True
    assert result.get("fail_reason") is None
    assert result.get("failing_since") is None
