import pytest

from scripts.codeberg import fetch_codeberg_info, normalize_codeberg_datetime


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2024-03-22T00:13:15+01:00", "2024-03-21T23:13:15Z"),
        ("2025-09-24T22:24:31+02:00", "2025-09-24T20:24:31Z"),
        ("2025-09-22T23:07:52+02:00", "2025-09-22T21:07:52Z"),
    ],
)
def test_normalize_codeberg_datetime(value, expected):
    assert normalize_codeberg_datetime(value) == expected


@pytest.mark.asyncio
async def test_fetch_codeberg_info_normalizes_datetimes(monkeypatch):
    metadata = {
        "id": 806593,
        "owner": {"login": "ISSOtm"},
        "name": "sublime-Bison",
        "description": "A Sublime Text syntax definition for Bison grammar files",
        "html_url": "https://codeberg.org/ISSOtm/sublime-Bison",
        "website": "https://packagecontrol.io/packages/Bison",
        "stars_count": 0,
        "default_branch": "master",
        "created_at": "2025-09-24T22:24:31+02:00",
        "archived": False,
    }
    tags = [
        {
            "name": "2.1.0",
            "id": "f933f04316ee4e06a7fad150d7f90c14f7b275cb",
            "commit": {
                "id": "f933f04316ee4e06a7fad150d7f90c14f7b275cb",
                "created": "2024-03-22T00:13:15+01:00",
            },
        }
    ]
    branches = [
        {
            "name": "master",
            "commit": {
                "id": "f933f04316ee4e06a7fad150d7f90c14f7b275cb",
                "timestamp": "2024-03-22T00:13:15+01:00",
            },
        }
    ]
    contents = [
        {
            "name": "README.md",
            "type": "file",
        }
    ]

    tag_calls = 0
    branch_calls = 0

    async def mock_fetch_json(_session, url):
        nonlocal tag_calls, branch_calls
        if url.endswith("/repos/ISSOtm/sublime-Bison"):
            return metadata
        if "/contents?" in url:
            return contents
        if "/tags?" in url:
            tag_calls += 1
            return tags if tag_calls == 1 else []
        if "/branches?" in url:
            branch_calls += 1
            return branches if branch_calls == 1 else []
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr("scripts.codeberg.fetch_json", mock_fetch_json)

    info = await fetch_codeberg_info(
        object(),
        "https://codeberg.org/ISSOtm/sublime-Bison",
        ("METADATA", "TAGS", "BRANCHES"),
    )

    assert info["metadata"]["created_at"] == "2025-09-24T20:24:31Z"
    assert info["metadata"]["readme"] == (
        "https://codeberg.org/ISSOtm/sublime-Bison/raw/branch/master/README.md"
    )

    tags_out = []
    async for tag in info["tags"]:
        tags_out.append(tag)
    assert tags_out == [
        {
            "name": "2.1.0",
            "url": "https://codeberg.org/ISSOtm/sublime-Bison/archive/2.1.0.zip",
            "date": "2024-03-21T23:13:15Z",
            "sha": "f933f04316ee4e06a7fad150d7f90c14f7b275cb",
        }
    ]

    branches_out = []
    async for branch in info["branches"]:
        branches_out.append(branch)
    assert branches_out == [
        {
            "name": "master",
            "version": "2024.03.21.23.13.15",
            "url": "https://codeberg.org/ISSOtm/sublime-Bison/archive/master.zip",
            "date": "2024-03-21T23:13:15Z",
            "sha": "f933f04316ee4e06a7fad150d7f90c14f7b275cb",
        }
    ]
