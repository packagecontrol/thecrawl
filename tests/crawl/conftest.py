from datetime import datetime
import json
import pytest


@pytest.fixture
def set_now(monkeypatch):
    def _set_now(date_str):
        monkeypatch.setattr("scripts.crawl.datetime", fixed_date(date_str))
    return _set_now


def fixed_date(date_str: str):
    fixed_dt = datetime.strptime(date_str, "%Y-%m-%dT%H:%M:%SZ")

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_dt.replace(tzinfo=tz)

    return FixedDateTime


@pytest.fixture
def set_github_info(monkeypatch):
    def _set_github_info(info):
        monkeypatch.setattr("scripts.crawl.fetch_github_info", mock_github(info))
    return _set_github_info


def mock_github(info):
    if isinstance(info, str):
        info = json.loads(info)

    async def wrapper(*args, **kwargs):
        if "tags" in info:
            info["tags"] = AsyncList(info["tags"])
        if "branches" in info:
            info["branches"] = AsyncList(info["branches"])
        if "releases" in info:
            info["releases"] = AsyncList(info["releases"])
        return info

    return wrapper


class AsyncList:
    def __init__(self, lst):
        self.lst = lst

    def __aiter__(self):
        return self.generator(self.lst)

    async def generator(self, lst):
        for item in lst:
            yield item

