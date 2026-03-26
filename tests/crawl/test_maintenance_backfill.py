import json

from scripts import crawl as crawl_script


def test_maintenance_backfill_adds_missing_packages(capsys, monkeypatch, tmp_path):
    monkeypatch.setenv("CRAWL_ENABLE_MISSING_BACKFILL", "1")
    monkeypatch.chdir(tmp_path)
    (tmp_path / "missing.json").write_text(
        json.dumps([
            {
                "name": "Backfill Me",
                "labels": ["theme"],
                "first_seen": "2010-01-01T00:00:00Z",
                "last_seen": "2011-01-01T00:00:00Z",
            },
            {
                "name": "Already In Registry",
                "labels": ["ignored"],
                "first_seen": "2010-01-01T00:00:00Z",
                "last_seen": "2011-01-01T00:00:00Z",
            },
            {
                "name": "Already In Workspace",
                "labels": ["ignored"],
                "first_seen": "2010-01-01T00:00:00Z",
                "last_seen": "2011-01-01T00:00:00Z",
            },
        ]),
        encoding="utf-8",
    )

    registry = {
        "packages": [{"name": "Already In Registry"}],
    }
    workspace = {
        "packages": {
            "Already In Workspace": {
                "name": "Already In Workspace",
                "first_seen": "2009-01-01T00:00:00Z",
                "removed": "2010-01-01T00:00:00Z",
            }
        },
        "libraries": {},
    }

    crawl_script.maintenance(registry, workspace)

    assert workspace["packages"]["Backfill Me"] == {
        "name": "Backfill Me",
        "labels": ["theme"],
        "first_seen": "2010-01-01T00:00:00Z",
        "removed": "2011-01-01T00:00:00Z",
    }
    assert "last_seen" not in workspace["packages"]["Backfill Me"]

    out = capsys.readouterr().out
    assert "Maintenance backfill from ./missing.json: added 1 package." in out


def test_maintenance_backfill_is_idempotent(capsys, monkeypatch, tmp_path):
    monkeypatch.setenv("CRAWL_ENABLE_MISSING_BACKFILL", "1")
    monkeypatch.chdir(tmp_path)
    (tmp_path / "missing.json").write_text(
        json.dumps([
            {
                "name": "Backfill Me",
                "labels": ["theme"],
                "first_seen": "2010-01-01T00:00:00Z",
                "last_seen": "2011-01-01T00:00:00Z",
            }
        ]),
        encoding="utf-8",
    )

    registry = {"packages": []}
    workspace = {"packages": {}, "libraries": {}}

    crawl_script.maintenance(registry, workspace)
    first_out = capsys.readouterr().out
    assert "Maintenance backfill from ./missing.json: added 1 package." in first_out

    crawl_script.maintenance(registry, workspace)
    second_out = capsys.readouterr().out
    assert "Maintenance backfill from ./missing.json: added 0 packages." in second_out
    assert len(workspace["packages"]) == 1
