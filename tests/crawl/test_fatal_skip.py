import pytest

import scripts.crawl as crawl_mod
from scripts.crawl import SkipCrawling, crawl


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
