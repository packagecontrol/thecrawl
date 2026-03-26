import pytest

from scripts import crawl as crawl_script


@pytest.mark.asyncio
async def test_next_crawl_for_mid_age_package_is_relative_to_now(set_now, monkeypatch):
    set_now("2026-03-26T01:15:00Z")

    async def fake_crawl_package(session, package, existing):
        return {
            "name": package["name"],
            "releases": [{"date": "2024-01-01T00:00:00Z"}],
        }

    monkeypatch.setattr(crawl_script, "crawl_package", fake_crawl_package)

    result = await crawl_script.crawl(None, {"name": "Example"}, {"name": "Example"})
    assert result["next_crawl"] == "2026-03-26T04:15:00Z"


@pytest.mark.asyncio
async def test_next_crawl_for_old_package_is_relative_to_now(set_now, monkeypatch):
    set_now("2026-03-26T01:15:00Z")

    async def fake_crawl_package(session, package, existing):
        return {
            "name": package["name"],
            "releases": [{"date": "2020-01-01T00:00:00Z"}],
        }

    monkeypatch.setattr(crawl_script, "crawl_package", fake_crawl_package)

    result = await crawl_script.crawl(None, {"name": "Example"}, {"name": "Example"})
    assert result["next_crawl"] == "2026-03-27T01:15:00Z"
