import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import scripts.enrich_logs as enrich_logs


def test_enrich_updates_existing_and_adds_missing(tmp_path):
    logs_path = tmp_path / "logs.json"
    runs_path = tmp_path / "workflow_runs.json"

    logs_path.write_text(json.dumps([
        {"run_id": "1", "notes": "has notes", "date": "2024-10-05T10:00:00Z"},
    ]), encoding="utf-8")

    runs_path.write_text(json.dumps([
        {
            "id": 1,
            "conclusion": "success",
            "run_started_at": "2024-10-05T10:00:00Z",
        },
        {
            "id": 2,
            "conclusion": "failure",
            "run_started_at": "2024-10-06T09:00:00Z",
        },
    ]), encoding="utf-8")

    args = enrich_logs.Args(
        input=str(logs_path),
        output=str(logs_path),
        runs=str(runs_path),
        artifacts=None,
        pretty=True,
    )
    enrich_logs.update_logs(args)

    data = json.loads(logs_path.read_text(encoding="utf-8"))
    assert len(data) == 2

    first = next(entry for entry in data if entry["run_id"] == "1")
    assert first["conclusion"] == "success"

    second = next(entry for entry in data if entry["run_id"] == "2")
    assert second["conclusion"] == "failure"
    assert second["date"] == "2024-10-06T09:00:00Z"


def test_enrich_attaches_artifacts_by_run_id(tmp_path):
    logs_path = tmp_path / "logs.json"
    runs_path = tmp_path / "workflow_runs.json"
    artifacts_path = tmp_path / "workflow_artifacts.json"

    logs_path.write_text(json.dumps([
        {"run_id": "1", "notes": "has notes", "date": "2024-10-05T10:00:00Z"},
    ]), encoding="utf-8")

    runs_path.write_text(json.dumps([
        {
            "id": 1,
            "conclusion": "success",
            "run_started_at": "2024-10-05T10:00:00Z",
        },
        {
            "id": 2,
            "conclusion": "failure",
            "run_started_at": "2024-10-06T09:00:00Z",
        },
    ]), encoding="utf-8")

    artifacts_path.write_text(json.dumps([
        {
            "run_id": "1",
            "id": 101,
            "name": "crawl-backup",
            "size": 1234,
            "url": "https://github.com/owner/repo/actions/runs/1/artifacts/101",
        },
        {
            "run_id": "2",
            "id": 202,
            "name": "stats-backup",
            "size": 4321,
            "url": "https://github.com/owner/repo/actions/runs/2/artifacts/202",
        },
        {
            "run_id": "999",
            "id": 303,
            "name": "ignored",
            "size": 999,
            "url": "https://github.com/owner/repo/actions/runs/999/artifacts/303",
        },
    ]), encoding="utf-8")

    args = enrich_logs.Args(
        input=str(logs_path),
        output=str(logs_path),
        runs=str(runs_path),
        artifacts=str(artifacts_path),
        pretty=True,
    )
    enrich_logs.update_logs(args)

    data = json.loads(logs_path.read_text(encoding="utf-8"))

    first = next(entry for entry in data if entry["run_id"] == "1")
    assert first["artifacts"] == [{
        "id": 101,
        "name": "crawl-backup",
        "size": 1234,
        "url": "https://github.com/owner/repo/actions/runs/1/artifacts/101",
    }]

    second = next(entry for entry in data if entry["run_id"] == "2")
    assert second["artifacts"] == [{
        "id": 202,
        "name": "stats-backup",
        "size": 4321,
        "url": "https://github.com/owner/repo/actions/runs/2/artifacts/202",
    }]


def test_enrich_backfills_notes_from_crawl_backup(tmp_path, monkeypatch):
    logs_path = tmp_path / "logs.json"
    runs_path = tmp_path / "workflow_runs.json"
    artifacts_path = tmp_path / "workflow_artifacts.json"

    run_date = datetime.now(timezone.utc).isoformat()
    logs_path.write_text(json.dumps([
        {"run_id": "1", "date": run_date},
    ]), encoding="utf-8")

    runs_path.write_text(json.dumps([
        {
            "id": 1,
            "conclusion": "success",
            "run_started_at": run_date,
        },
        {
            "id": 2,
            "conclusion": "success",
            "run_started_at": run_date,
        },
    ]), encoding="utf-8")

    artifacts_path.write_text(json.dumps([
        {
            "run_id": "1",
            "id": 101,
            "name": "crawl-backup",
            "size": 1234,
            "url": "https://github.com/owner/repo/actions/runs/1/artifacts/101",
        },
        {
            "run_id": "2",
            "id": 202,
            "name": "crawl-backup",
            "size": 4321,
            "url": "https://github.com/owner/repo/actions/runs/2/artifacts/202",
        },
    ]), encoding="utf-8")

    def fake_run(cmd, capture_output, text, check):
        assert cmd[:3] == ["gh", "run", "download"]
        run_id = cmd[3]
        output_dir = Path(cmd[cmd.index("--dir") + 1])
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "logs.json").write_text(json.dumps([
            {
                "run_id": run_id,
                "date": run_date,
                "notes": f"notes for {run_id}",
                "found_updates": [{"name": f"Package {run_id}"}],
            },
        ]), encoding="utf-8")
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(enrich_logs.subprocess, "run", fake_run)

    args = enrich_logs.Args(
        input=str(logs_path),
        output=str(logs_path),
        runs=str(runs_path),
        artifacts=str(artifacts_path),
        pretty=True,
    )
    enrich_logs.update_logs(args)

    data = json.loads(logs_path.read_text(encoding="utf-8"))

    first = next(entry for entry in data if entry["run_id"] == "1")
    assert first["notes"] == "notes for 1"
    assert first["found_updates"] == [{"name": "Package 1"}]

    second = next(entry for entry in data if entry["run_id"] == "2")
    assert second["notes"] == "notes for 2"
    assert second["found_updates"] == [{"name": "Package 2"}]


def test_enrich_skips_notes_backfill_for_old_entries(tmp_path, monkeypatch):
    logs_path = tmp_path / "logs.json"
    runs_path = tmp_path / "workflow_runs.json"
    artifacts_path = tmp_path / "workflow_artifacts.json"
    old_date = (
        datetime.now(timezone.utc) - timedelta(days=enrich_logs.BACKFILL_NOTES_DAYS + 1)
    ).isoformat()

    logs_path.write_text(json.dumps([
        {"run_id": "1", "date": old_date},
    ]), encoding="utf-8")
    runs_path.write_text(json.dumps([
        {
            "id": 1,
            "conclusion": "success",
            "run_started_at": old_date,
        },
    ]), encoding="utf-8")
    artifacts_path.write_text(json.dumps([
        {
            "run_id": "1",
            "id": 101,
            "name": "crawl-backup",
            "size": 1234,
            "url": "https://github.com/owner/repo/actions/runs/1/artifacts/101",
        },
    ]), encoding="utf-8")

    def fail_run(*args, **kwargs):
        raise AssertionError("old entries should not download crawl-backup")

    monkeypatch.setattr(enrich_logs.subprocess, "run", fail_run)

    args = enrich_logs.Args(
        input=str(logs_path),
        output=str(logs_path),
        runs=str(runs_path),
        artifacts=str(artifacts_path),
        pretty=True,
    )
    enrich_logs.update_logs(args)

    data = json.loads(logs_path.read_text(encoding="utf-8"))
    first = next(entry for entry in data if entry["run_id"] == "1")
    assert "notes" not in first


def test_parse_args_defaults_output_to_input(monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "enrich_logs.py",
            "./wrk/logs.json",
            "--runs",
            "./workflow_runs.json",
        ],
    )

    args = enrich_logs.parse_args()

    assert args.input == "./wrk/logs.json"
    assert args.output == "./wrk/logs.json"
