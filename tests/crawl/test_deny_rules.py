import pytest

from scripts.crawl import main_



@pytest.mark.asyncio
async def test_repo_id_mismatch_same_url_is_fatal(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "RepoTakeover",
                "details": "https://github.com/example/repo-takeover",
                "releases": [
                    {
                        "sublime_text": "*",
                        "branch": True
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {
        "packages": {
            "RepoTakeover": {
                "name": "RepoTakeover",
                "details": "https://github.com/example/repo-takeover",
                "id": "OLD_ID"
            }
        },
        "dependencies": []
    }

    github_info = {
        "metadata": {
            "id": "NEW_ID",
            "name": "RepoTakeover",
            "description": "Fixture package with ID change",
            "homepage": "https://github.com/example/repo-takeover",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/example/repo-takeover/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "main123",
                "date": "2024-05-10T12:00:00Z",
                "url": "https://codeload.github.com/example/repo-takeover/zip/main"
            }
        ]
    }

    set_now("2024-05-11T00:00:00Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("RepoTakeover")
    assert package is not None
    assert package.get("fail_reason", "").startswith("fatal: Repository ID mismatch")


@pytest.mark.asyncio
async def test_repo_transfer_same_id_is_allowed(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "RepoTransfer",
                "details": "https://github.com/user-b/repo-transfer",
                "releases": [
                    {
                        "sublime_text": "*",
                        "branch": True
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {
        "packages": {
            "RepoTransfer": {
                "name": "RepoTransfer",
                "details": "https://github.com/user-a/repo-transfer",
                "id": "SAME_ID"
            }
        },
        "dependencies": []
    }

    github_info = {
        "metadata": {
            "id": "SAME_ID",
            "name": "RepoTransfer",
            "description": "Fixture package with repo transfer",
            "homepage": "https://github.com/user-b/repo-transfer",
            "author": "user-b",
            "readme": "https://raw.githubusercontent.com/user-b/repo-transfer/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "main123",
                "date": "2024-05-10T12:00:00Z",
                "url": "https://codeload.github.com/user-b/repo-transfer/zip/main"
            }
        ]
    }

    set_now("2024-05-11T00:00:00Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("RepoTransfer")
    assert package is not None
    assert package.get("fail_reason") is None
    assert package.get("id") == "SAME_ID"
    assert package.get("details") == "https://github.com/user-b/repo-transfer"


@pytest.mark.asyncio
async def test_registry_move_new_id_is_allowed(set_now, set_github_info):
    registry = {
        "repositories": [
            "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json"
        ],
        "packages": [
            {
                "name": "RegistryMove",
                "details": "https://github.com/new-owner/registry-move",
                "releases": [
                    {
                        "sublime_text": "*",
                        "branch": True
                    }
                ],
                "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0"
            }
        ]
    }

    workspace = {
        "packages": {
            "RegistryMove": {
                "name": "RegistryMove",
                "details": "https://github.com/old-owner/registry-move",
                "id": "OLD_ID"
            }
        },
        "dependencies": []
    }

    github_info = {
        "metadata": {
            "id": "NEW_ID",
            "name": "RegistryMove",
            "description": "Fixture package with registry move",
            "homepage": "https://github.com/new-owner/registry-move",
            "author": "example",
            "readme": "https://raw.githubusercontent.com/new-owner/registry-move/main/README.md",
            "default_branch": "main",
            "stars": 0,
            "created_at": "2024-01-01T00:00:00Z"
        },
        "tags": [],
        "branches": [
            {
                "name": "main",
                "version": "2024.05.10.12.00.00",
                "sha": "main123",
                "date": "2024-05-10T12:00:00Z",
                "url": "https://codeload.github.com/new-owner/registry-move/zip/main"
            }
        ]
    }

    set_now("2024-05-11T00:00:00Z")
    set_github_info(github_info)

    await main_(registry, workspace, None, 100)

    package = workspace["packages"].get("RegistryMove")
    assert package is not None
    assert package.get("fail_reason") is None
    assert package.get("id") == "NEW_ID"
    assert package.get("details") == "https://github.com/new-owner/registry-move"
