import asyncio
from datetime import datetime
import json
import pytest


@pytest.fixture
def set_date(monkeypatch):
    def _set_date(date_str):
        monkeypatch.setattr("scripts.crawl.datetime", fixed_date(date_str))
    return _set_date


def fixed_date(date_str: str):
    fixed_dt = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")

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
    async def wrapper(*args, **kwargs):
        result = json.loads(info)
        if "tags" in result:
            result["tags"] = AsyncList(result["tags"])
        if "branches" in result:
            result["branches"] = AsyncList(result["branches"])
        return result

    return wrapper


class AsyncList:
    def __init__(self, lst):
        self.lst = lst

    def __aiter__(self):
        return self.generator(self.lst)

    async def generator(self, lst):
        for item in lst:
            yield item

