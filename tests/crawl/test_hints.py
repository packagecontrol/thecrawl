import pytest

from scripts.crawl import main_


@pytest.mark.asyncio
async def test_hints_sent_to_fetcher(monkeypatch, set_now):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/sublimehq/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "HintsPkg",
                "details": "https://github.com/example/hints-pkg",
                "releases": [
                    {
                        "sublime_text": "*",
                        "branch": True
                    }
                ],
                "source": "https://raw.githubusercontent.com/sublimehq/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {
        "packages": {
            "HintsPkg": {
                "name": "HintsPkg",
                "details": "https://github.com/example/hints-pkg",
                "hints": ["too_many_files"]
            }
        },
        "dependencies": []
    }

    seen_hints = []

    async def fake_fetch(session, url, scopes, *, hints=None):
        seen_hints.append(hints or [])
        raise RuntimeError("stop after verifying hints")

    monkeypatch.setattr("scripts.crawl.fetch_github_info", fake_fetch)
    set_now("2024-05-11T00:00:00Z")

    await main_(registry, workspace, None, 100)

    assert seen_hints == [["too_many_files"]]


@pytest.mark.asyncio
async def test_hints_persisted_from_metadata(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/sublimehq/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "HintsPkg",
                "details": "https://github.com/example/hints-pkg",
                "releases": [
                    {
                        "sublime_text": "*",
                        "branch": True
                    }
                ],
                "source": "https://raw.githubusercontent.com/sublimehq/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {"packages": {}, "dependencies": []}

    github_info = {
        "metadata": {
            "id": "R_hintspkg",
            "name": "HintsPkg",
            "description": "Fixture package with hints",
            "homepage": "https://github.com/example/hints-pkg",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/hints-pkg/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01T00:00:00Z",
            "hints": ["too_many_files", "extra_hint"]
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "main123",
                "date": "2024-05-10T12:00:00Z",
                "url": "https://codeload.github.com/example/hints-pkg/zip/main"
            }
        ]
    }

    set_now("2024-05-11T00:00:00Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("HintsPkg")
    assert package is not None
    assert package.get("hints") == ["too_many_files", "extra_hint"]


