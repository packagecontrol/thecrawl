import pytest

from scripts.crawl import main_
from tests.crawl.conftest import AsyncList


@pytest.mark.asyncio
async def test_prefetched_readme_content_goes_to_sidecar(set_now, monkeypatch):
    registry = {
        "packages": [
            {
                "name": "WithReadme",
                "details": "https://github.com/example/with-readme",
                "source": "https://example.test/repository.json",
                "schema_version": "3.0.0",
            }
        ],
    }
    workspace = {"packages": {}}
    readmes = {}

    async def fetch_github_info(*_args, **_kwargs):
        return {
            "metadata": {
                "id": "R_readme",
                "name": "with-readme",
                "readme": "https://raw.githubusercontent.com/example/with-readme/main/README.md",
                "readme_content": "# WithReadme\n",
                "default_branch": "main",
                "created_at": "2024-01-01T00:00:00Z",
            },
            "tags": AsyncList([
                {
                    "name": "v1.0.0",
                    "date": "2025-01-01T00:00:00Z",
                    "url": "https://codeload.github.com/example/with-readme/zip/v1.0.0",
                }
            ]),
            "branches": AsyncList([]),
        }

    set_now("2025-01-02T00:00:00Z")
    monkeypatch.setattr("scripts.crawl.fetch_github_info", fetch_github_info)

    await main_(registry, workspace, None, 100, readmes=readmes)

    package = workspace["packages"]["WithReadme"]
    assert "readme_content" not in package
    assert readmes == {
        "https://raw.githubusercontent.com/example/with-readme/main/README.md": "# WithReadme\n"
    }


@pytest.mark.asyncio
async def test_prefetched_readme_content_dropped_when_registry_readme_wins(
    set_now,
    monkeypatch,
):
    registry = {
        "packages": [
            {
                "name": "CustomReadme",
                "details": "https://github.com/example/custom-readme",
                "readme": "https://example.test/custom.md",
                "source": "https://example.test/repository.json",
                "schema_version": "3.0.0",
            }
        ],
    }
    workspace = {"packages": {}}
    readmes = {}

    async def fetch_github_info(*_args, **_kwargs):
        return {
            "metadata": {
                "id": "R_custom_readme",
                "name": "custom-readme",
                "readme": "https://raw.githubusercontent.com/example/custom-readme/main/README.md",
                "readme_content": "# Wrong Key\n",
                "default_branch": "main",
                "created_at": "2024-01-01T00:00:00Z",
            },
            "tags": AsyncList([
                {
                    "name": "v1.0.0",
                    "date": "2025-01-01T00:00:00Z",
                    "url": "https://codeload.github.com/example/custom-readme/zip/v1.0.0",
                }
            ]),
            "branches": AsyncList([]),
        }

    set_now("2025-01-02T00:00:00Z")
    monkeypatch.setattr("scripts.crawl.fetch_github_info", fetch_github_info)

    await main_(registry, workspace, None, 100, readmes=readmes)

    package = workspace["packages"]["CustomReadme"]
    assert "readme_content" not in package
    assert package["readme"] == "https://example.test/custom.md"
    assert readmes == {}
