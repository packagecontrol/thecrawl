from scripts import crawl as crawl_script


def test_maintenance_imports_registry_tombstones_into_workspace():
    tombstone = {
        "name": "Gone",
        "first_seen": "2012-01-01T00:00:00Z",
        "removed": "2024-01-01T00:00:00Z",
        "labels": ["theme"],
        "source": "https://raw.githubusercontent.com/sublimehq/package_control_channel/refs/heads/master/repository.json",
        "schema_version": "3.0.0",
    }
    registry = {
        "packages": [
            {
                "name": "Alive",
                "details": "https://github.com/example/alive",
                "releases": [{"sublime_text": "*", "branch": True}],
                "source": "https://raw.githubusercontent.com/sublimehq/package_control_channel/refs/heads/master/repository.json",
                "schema_version": "3.0.0",
            },
            tombstone,
        ]
    }
    workspace = {"packages": {}, "libraries": {}}

    crawl_script.maintenance(registry, workspace)

    assert workspace["packages"]["Gone"] == tombstone
    assert "Alive" not in workspace["packages"]


def test_maintenance_overwrites_existing_entry_with_registry_tombstone():
    tombstone = {
        "name": "Gone",
        "first_seen": "2012-01-01T00:00:00Z",
        "removed": "2024-01-01T00:00:00Z",
        "labels": ["theme"],
    }
    registry = {"packages": [tombstone]}
    workspace = {
        "packages": {
            "Gone": {
                "name": "Gone",
                "details": "https://github.com/example/gone",
                "releases": [{"version": "1.0.0"}],
                "source": "https://example.com/old.json",
                "first_seen": "2012-01-01T00:00:00Z",
                "fail_reason": "fatal: 404 Not Found",
            }
        },
        "libraries": {},
    }

    crawl_script.maintenance(registry, workspace)

    assert workspace["packages"]["Gone"] == tombstone
    assert "details" not in workspace["packages"]["Gone"]


def test_maintenance_still_marks_workspace_orphans_removed(set_now):
    set_now("2026-03-27T11:00:00Z")

    registry = {"packages": []}
    workspace = {
        "packages": {
            "Orphan": {
                "name": "Orphan",
                "first_seen": "2020-01-01T00:00:00Z",
            }
        },
        "libraries": {},
    }

    crawl_script.maintenance(registry, workspace)

    assert workspace["packages"]["Orphan"]["removed"] == "2026-03-27T11:00:00Z"
