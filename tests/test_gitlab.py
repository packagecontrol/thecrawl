import pytest

from scripts.gitlab import fetch_gitlab_info


@pytest.mark.asyncio
async def test_fetch_gitlab_info_formats_datetimes(monkeypatch):
    metadata = {
        "id": 25721661,
        "description": (
            "Jq wrapper plugin for Sublime Text 3 & 4.\r\n\r\n"
            "It mainly lets you craft jq queries interactively, "
            "or run any jq queries via a keyboard shortcut."
        ),
        "name": "sublime_jq",
        "path_with_namespace": "jiehong/sublime_jq",
        "created_at": "2021-04-07T19:23:53.056Z",
        "default_branch": "master",
        "web_url": "https://gitlab.com/jiehong/sublime_jq",
        "star_count": 2,
        "namespace": {"path": "jiehong"},
    }
    tree = [
        {"type": "blob", "name": "README.md"},
    ]
    tags = [
        {
            "name": "1.2.0",
            "commit": {
                "id": "2d387bc0897095a343d51483fb4e4a29e983337b",
                "committed_date": "2023-02-13T18:08:53.000+00:00",
            },
        }
    ]
    branches = [
        {
            "name": "master",
            "commit": {
                "id": "2d387bc0897095a343d51483fb4e4a29e983337b",
                "committed_date": "2023-02-13T18:08:53.000+00:00",
            },
        }
    ]

    async def mock_fetch_json(_session, url):
        if "/projects/jiehong%2Fsublime_jq" in url and "/repository/tree" not in url:
            return metadata
        if "/repository/tree" in url:
            return tree
        raise AssertionError(f"Unexpected URL: {url}")

    async def mock_fetch_(_session, url):
        if "/repository/tags" in url:
            return tags, {"X-Next-Page": ""}
        if "/repository/branches" in url:
            return branches, {"X-Next-Page": ""}
        raise AssertionError(f"Unexpected URL: {url}")

    async def mock_fetch_text(_session, url):
        assert url == (
            "https://gitlab.com/api/v4/projects/jiehong%2Fsublime_jq/"
            "repository/files/README.md/raw?ref=master"
        )
        return "# sublime_jq\n\nA jq wrapper.\n"

    monkeypatch.setattr("scripts.gitlab.fetch_json", mock_fetch_json)
    monkeypatch.setattr("scripts.gitlab.fetch_", mock_fetch_)
    monkeypatch.setattr("scripts.gitlab.fetch_text", mock_fetch_text)

    info = await fetch_gitlab_info(
        object(),
        "https://gitlab.com/jiehong/sublime_jq",
        ("METADATA", "TAGS", "BRANCHES"),
    )

    assert info["metadata"]["created_at"] == "2021-04-07T19:23:53Z"
    assert info["metadata"]["default_branch"] == "master"
    assert info["metadata"]["readme"] == (
        "https://gitlab.com/jiehong/sublime_jq/-/raw/master/README.md"
    )
    assert info["metadata"]["readme_content"] == "# sublime_jq\n\nA jq wrapper.\n"
    assert info["metadata"]["stars"] == 2

    tags_out = []
    async for tag in info["tags"]:
        tags_out.append(tag)
    assert tags_out == [
        {
            "name": "1.2.0",
            "url": (
                "https://gitlab.com/jiehong/sublime_jq/-/archive/"
                "1.2.0/sublime_jq-1.2.0.zip"
            ),
            "date": "2023-02-13T18:08:53Z",
        }
    ]

    branches_out = []
    async for branch in info["branches"]:
        branches_out.append(branch)
    assert branches_out == [
        {
            "name": "master",
            "url": (
                "https://gitlab.com/jiehong/sublime_jq/-/archive/"
                "master/sublime_jq-master.zip"
            ),
            "date": "2023-02-13T18:08:53Z",
        }
    ]
