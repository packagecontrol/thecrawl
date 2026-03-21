from datetime import datetime, timezone
import pytest

from scripts.crawl import crawl, main_, now_ts


@pytest.mark.asyncio
async def test_sets_update_detected_when_last_modified_changes(set_now, monkeypatch):
    package = {"name": "Example"}
    existing = {
        "name": "Example",
        "last_modified": "2024-05-01T00:00:00Z",
        "update_detected": "2024-05-05T00:00:00Z",
    }

    async def stub(*args, **kwargs):
        return {
            "name": "Example",
            "releases": [{"date": "2024-05-31T00:00:00Z"}],
        }

    set_now("2024-06-01T00:00:00Z")
    monkeypatch.setattr("scripts.crawl.crawl_package", stub)

    result = await crawl(object(), package, existing)

    assert result["last_modified"] == "2024-05-31T00:00:00Z"
    assert result["update_detected"] == "2024-06-01T00:00:00Z"


@pytest.mark.asyncio
async def test_does_not_set_update_detected_for_first_seen_package(set_now, monkeypatch):
    package = {"name": "Example"}
    existing = {"name": "Example"}

    async def stub(*args, **kwargs):
        return {
            "name": "Example",
            "releases": [{"date": "2024-05-31T00:00:00Z"}],
        }

    set_now("2024-06-01T00:00:00Z")
    monkeypatch.setattr("scripts.crawl.crawl_package", stub)

    result = await crawl(object(), package, existing)

    assert result["last_modified"] == "2024-05-31T00:00:00Z"
    assert "update_detected" not in result


@pytest.mark.asyncio
async def test_drops_previous_update_detected_when_last_modified_is_unchanged(
    set_now,
    monkeypatch,
):
    package = {"name": "Example"}
    existing = {
        "name": "Example",
        "last_modified": "2024-05-31T00:00:00Z",
        "update_detected": "2024-05-15T00:00:00Z",
    }

    async def stub(*args, **kwargs):
        return {
            "name": "Example",
            "releases": [{"date": "2024-05-31T00:00:00Z"}],
        }

    set_now("2024-06-01T00:00:00Z")
    monkeypatch.setattr("scripts.crawl.crawl_package", stub)

    result = await crawl(object(), package, existing)

    assert "update_detected" not in result


@pytest.mark.asyncio
async def test_main_prints_sorted_oxford_list_for_updates(set_now, monkeypatch, capsys):
    registry = {
        "packages": [
            {"name": "gamma"},
            {"name": "alpha"},
            {"name": "beta"},
        ]
    }
    workspace = {"packages": {}}

    async def stub_crawl(session, package, existing):
        return {"name": package["name"], "update_detected": "2024-06-01T00:00:00Z"}

    set_now("2024-06-01T00:00:00Z")
    monkeypatch.setattr("scripts.crawl.crawl", stub_crawl)

    await main_(registry, workspace, None, 100)

    out = capsys.readouterr().out
    assert "Found updates for alpha, beta, and gamma." in out


@pytest.mark.asyncio
async def test_main_prints_singular_update_summary(set_now, monkeypatch, capsys):
    registry = {"packages": [{"name": "alpha"}, {"name": "beta"}]}
    workspace = {"packages": {}}

    async def stub_crawl(session, package, existing):
        if package["name"] == "alpha":
            return {"name": package["name"], "update_detected": "2024-06-01T00:00:00Z"}
        return {"name": package["name"]}

    set_now("2024-06-01T00:00:00Z")
    monkeypatch.setattr("scripts.crawl.crawl", stub_crawl)

    await main_(registry, workspace, None, 100)

    out = capsys.readouterr().out
    assert "Found update for alpha." in out


@pytest.mark.asyncio
async def test_main_does_not_report_first_seen_as_update(
    set_now,
    monkeypatch,
    capsys,
):
    registry = {"packages": [{"name": "alpha"}]}
    workspace = {"packages": {}}

    async def stub_crawl_package(session, package, existing):
        return {
            "name": package["name"],
            "releases": [{"date": "2024-05-31T00:00:00Z"}],
        }

    set_now("2024-06-01T00:00:00Z")
    monkeypatch.setattr("scripts.crawl.crawl_package", stub_crawl_package)

    await main_(registry, workspace, None, 100)

    out = capsys.readouterr().out
    assert "Found update" not in out


def test_now_ts_prefers_now_ts_env(monkeypatch, set_now):
    set_now("2024-06-01T00:00:00Z")
    monkeypatch.setenv("NOW_TS", "1717286400")

    expected = (
        datetime
        .strptime("2024-06-02T00:00:00Z", "%Y-%m-%dT%H:%M:%SZ")
        .replace(tzinfo=timezone.utc)
    )
    assert now_ts() == expected
