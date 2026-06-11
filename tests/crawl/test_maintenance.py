from scripts import crawl as crawl_script


OLD_MAIN_REPOSITORY_SOURCE = crawl_script.OLD_MAIN_REPOSITORY_SOURCE
NEW_MAIN_REPOSITORY_SOURCE = crawl_script.MAIN_REPOSITORY_SOURCE


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


def test_maintenance_migrates_old_main_repository_source_only(capsys):
    registry = {
        "packages": [
            {
                "name": "Moved",
                "details": "https://github.com/example/moved",
                "source": NEW_MAIN_REPOSITORY_SOURCE,
                "schema_version": "3.0.0",
            },
            {
                "name": "Untrusted",
                "details": "https://github.com/example/untrusted",
                "source": "https://example.com/untrusted/new.json",
                "schema_version": "3.0.0",
            },
        ]
    }
    workspace = {
        "packages": {
            "Moved": {
                "name": "Moved",
                "source": OLD_MAIN_REPOSITORY_SOURCE,
            },
            "Untrusted": {
                "name": "Untrusted",
                "source": OLD_MAIN_REPOSITORY_SOURCE,
            },
        },
        "libraries": {},
    }

    crawl_script.maintenance(registry, workspace)

    assert workspace["packages"]["Moved"]["source"] == NEW_MAIN_REPOSITORY_SOURCE
    assert workspace["packages"]["Untrusted"]["source"] == OLD_MAIN_REPOSITORY_SOURCE
    assert capsys.readouterr().out == "Migrated 1 package to the new main channel.\n"


def test_maintenance_still_marks_workspace_orphans_removed(set_now, capsys):
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
    assert capsys.readouterr().out == "Migrated 0 packages to the new main channel.\n"
