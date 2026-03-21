import pytest

from scripts.crawl import crawl


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
