from scripts.crawl import maintenance


def test_maintenance_migrates_workspace_datetimes():
    registry = {
        "packages": [
            {"name": "LegacyPkg"},
        ]
    }
    workspace = {
        "packages": {
            "LegacyPkg": {
                "name": "LegacyPkg",
                "removed": "2024-05-10 12:00:00",
                "first_seen": "2024-05-10T12:00:00Z",
                "last_seen": "2024-05-11 00:00:00",
                "next_crawl": "2024-05-12 06:00:00",
                "last_modified": "2024-05-13 08:30:00",
                "failing_since": "2024-05-14 09:45:00",
                "created_at": "2024-01-01 00:00:00",
                "archived_at": "2024-02-01 00:00:00",
                "releases": [
                    {"date": "2024-05-10 12:00:00"},
                    {"date": "2024-05-10T12:00:00Z"},
                ],
            }
        },
        "dependencies": [],
    }

    maintenance(registry, workspace)

    pkg = workspace["packages"]["LegacyPkg"]
    snapshot = {
        key: pkg[key]
        for key in (
            "removed",
            "first_seen",
            "last_seen",
            "next_crawl",
            "last_modified",
            "failing_since",
            "created_at",
            "archived_at",
        )
    }
    release_dates = [r["date"] for r in pkg["releases"]]

    maintenance(registry, workspace)

    assert pkg["removed"] == "2024-05-10T12:00:00Z"
    assert pkg["first_seen"] == "2024-05-10T12:00:00Z"
    assert pkg["last_seen"] == "2024-05-11T00:00:00Z"
    assert pkg["next_crawl"] == "2024-05-12T06:00:00Z"
    assert pkg["last_modified"] == "2024-05-13T08:30:00Z"
    assert pkg["failing_since"] == "2024-05-14T09:45:00Z"
    assert pkg["created_at"] == "2024-01-01T00:00:00Z"
    assert pkg["archived_at"] == "2024-02-01T00:00:00Z"
    assert pkg["releases"][0]["date"] == "2024-05-10T12:00:00Z"
    assert pkg["releases"][1]["date"] == "2024-05-10T12:00:00Z"
    assert snapshot == {
        key: pkg[key]
        for key in snapshot
    }
    assert release_dates == [r["date"] for r in pkg["releases"]]
