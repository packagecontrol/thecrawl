import json

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
        pretty=True,
    )
    enrich_logs.update_logs(args)

    data = json.loads(logs_path.read_text(encoding="utf-8"))
    assert len(data) == 2

    first = next(entry for entry in data if entry["run_id"] == "1")
    assert first["conclusion"] == "success"

    second = next(entry for entry in data if entry["run_id"] == "2")
    assert second["notes"] == "Run did not produce notes."
    assert second["conclusion"] == "failure"
    assert second["date"] == "2024-10-06T09:00:00Z"
