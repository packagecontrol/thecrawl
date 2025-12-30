import pytest

from scripts.bitbucket import fetch_bitbucket_info


@pytest.mark.asyncio
async def test_fetch_bitbucket_info_formats_datetimes(monkeypatch):
    metadata = {
        "uuid": "{8344e5f1-ac3a-420c-9a19-0864d1ca2d9d}",
        "name": "html2scss",
        "description": "Sublime plugin",
        "website": "",
        "owner": {"nickname": "hxss"},
        "mainbranch": {"name": "master"},
        "created_on": "2018-09-01T23:33:42.403340+00:00",
        "links": {
            "watchers": {
                "href": "https://api.bitbucket.org/2.0/repositories/hxss/html2scss/watchers"
            },
            "issues": {
                "href": "https://api.bitbucket.org/2.0/repositories/hxss/html2scss/issues"
            },
        },
    }
    watchers = {"size": 3}
    files = {
        "values": [
            {"type": "commit_file", "path": "README.md"},
        ]
    }
    tags = {
        "values": [
            {
                "name": "1.0.0",
                "target": {
                    "hash": "7f2a2d93e28706f6c1dfd675bf011b8749c3ec63",
                    "date": "2018-09-02T12:17:34+00:00",
                },
            }
        ],
        "size": 1,
        "page": 1,
    }
    branches = {
        "values": [
            {
                "name": "master",
                "target": {
                    "hash": "ea8e9f7ae19aa31e780c7d91e73782af4c4f419c",
                    "date": "2018-09-25T14:58:29+00:00",
                },
            }
        ],
        "size": 1,
        "page": 1,
    }

    tag_calls = 0
    branch_calls = 0

    async def mock_fetch_json(_session, url):
        nonlocal tag_calls, branch_calls
        if url.endswith("/repositories/hxss/html2scss"):
            return metadata
        if url.endswith("/watchers"):
            return watchers
        if "/src/master/" in url:
            return files
        if url.endswith("/refs/tags"):
            tag_calls += 1
            return tags if tag_calls == 1 else {"values": []}
        if url.endswith("/refs/branches"):
            branch_calls += 1
            return branches if branch_calls == 1 else {"values": []}
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr("scripts.bitbucket.fetch_json", mock_fetch_json)

    info = await fetch_bitbucket_info(
        object(),
        "https://bitbucket.org/hxss/html2scss",
        ("METADATA", "TAGS", "BRANCHES"),
    )

    assert info["metadata"]["created_at"] == "2018-09-01T23:33:42Z"
    assert info["metadata"]["default_branch"] == "master"
    assert info["metadata"]["readme"] == (
        "https://bitbucket.org/hxss/html2scss/raw/master/README.md"
    )
    assert info["metadata"]["stars"] == 3

    tags_out = []
    async for tag in info["tags"]:
        tags_out.append(tag)
    assert tags_out == [
        {
            "name": "1.0.0",
            "url": "https://bitbucket.org/hxss/html2scss/get/1.0.0.zip",
            "date": "2018-09-02T12:17:34Z",
        }
    ]

    branches_out = []
    async for branch in info["branches"]:
        branches_out.append(branch)
    assert branches_out == [
        {
            "name": "master",
            "version": "2018.09.25.14.58.29",
            "url": "https://bitbucket.org/hxss/html2scss/get/master.zip",
            "date": "2018-09-25T14:58:29Z",
        }
    ]
