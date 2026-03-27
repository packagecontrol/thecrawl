import pytest

from scripts import crawl as crawl_script


@pytest.mark.asyncio
async def test_main_name_rejects_tombstoned_package(capsys):
    registry = {
        "packages": [
            {
                "name": "Gone",
                "removed": "2025-01-01T00:00:00Z",
            }
        ]
    }
    workspace = {"packages": {}, "libraries": {}}

    await crawl_script.main_(registry, workspace, "Gone", limit=1)

    err = capsys.readouterr().err
    assert "Package 'Gone' is tombstoned in the registry." in err
    assert workspace["packages"] == {}
