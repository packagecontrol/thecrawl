import pytest

from scripts.crawl import main_, maintain_readmes
from tests.crawl.conftest import AsyncList


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("readmes", "expected"),
    [
        (
            {"https://example.test/orphan.md": "# Orphan\n"},
            "Removed 1 stale README entry from readmes.json.",
        ),
        (
            {
                "https://example.test/orphan-a.md": "# Orphan A\n",
                "https://example.test/orphan-b.md": "# Orphan B\n",
            },
            "Removed 2 stale README entries from readmes.json.",
        ),
    ],
)
async def test_readme_maintenance_message_uses_plural_helper(readmes, expected, capsys):
    await main_({"packages": []}, {"packages": {}}, None, 100, readmes=readmes)

    assert expected in capsys.readouterr().out


def test_maintain_readmes_prunes_urls_without_live_workspace_package():
    workspace = {
        "packages": {
            "Live": {
                "name": "Live",
                "readme": "https://example.test/live.md",
            },
            "Removed": {
                "name": "Removed",
                "readme": "https://example.test/removed.md",
                "removed": "2025-01-01T00:00:00Z",
            },
            "NoReadme": {
                "name": "NoReadme",
            },
        },
    }
    readmes = {
        "https://example.test/live.md": "# Live\n",
        "https://example.test/removed.md": "# Removed\n",
        "https://example.test/orphan.md": "# Orphan\n",
    }

    assert maintain_readmes(readmes, workspace) == 2
    assert readmes == {
        "https://example.test/live.md": "# Live\n",
    }


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
