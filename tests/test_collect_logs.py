import json
import sys
from datetime import datetime, timezone

import scripts.collect_logs as collect_logs


def test_collect_logs_deduplicates_run_id(tmp_path, monkeypatch):
    notes_path = tmp_path / "notes.txt"
    notes_path.write_text(
        "October 05, 2024, 07:15 GMT+2  ([logs](https://example.invalid))\nfirst\n",
        encoding="utf-8",
    )

    fixed_now = datetime(2024, 10, 6, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(collect_logs, "now_utc", lambda: fixed_now)
    monkeypatch.setenv("GITHUB_RUN_ID", "12345")

    logs_path = tmp_path / "logs.json"
    first_ts = datetime(2024, 10, 5, 7, 15, tzinfo=timezone.utc).timestamp()
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "collect-logs",
            "-o",
            str(logs_path),
            "--timestamp",
            str(first_ts),
            str(notes_path),
        ],
    )
    collect_logs.main()

    notes_path.write_text(
        "October 05, 2024, 08:20 GMT+2  ([logs](https://example.invalid))\nupdated\n",
        encoding="utf-8",
    )
    second_ts = datetime(2024, 10, 5, 8, 20, tzinfo=timezone.utc).timestamp()
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "collect-logs",
            "-o",
            str(logs_path),
            "--timestamp",
            str(second_ts),
            str(notes_path),
        ],
    )
    collect_logs.main()

    entries = json.loads(logs_path.read_text(encoding="utf-8"))
    assert len(entries) == 1
    assert entries[0]["run_id"] == "12345"
    assert entries[0]["notes"].startswith("October 05, 2024, 08:20")
    assert entries[0]["date"] == "2024-10-05T08:20:00+00:00"


def test_collect_logs_prunes_entries_outside_retention(tmp_path, monkeypatch):
    logs_path = tmp_path / "logs.json"
    old_entry = {
        "date": "2024-08-01T00:00:00+00:00",
        "run_id": "1",
        "notes": "old",
    }
    fresh_entry = {
        "date": "2024-10-01T12:00:00+00:00",
        "run_id": "2",
        "notes": "fresh",
    }
    logs_path.write_text(json.dumps([fresh_entry, old_entry]), encoding="utf-8")

    notes_path = tmp_path / "notes.txt"
    notes_path.write_text(
        "October 05, 2024, 07:45 GMT+2  ([logs](https://example.invalid))\nnew\n",
        encoding="utf-8",
    )

    fixed_now = datetime(2024, 10, 5, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(collect_logs, "now_utc", lambda: fixed_now)

    args = collect_logs.Args(
        output=str(logs_path),
        notes=str(notes_path),
        run_id="99",
        timestamp=fixed_now.timestamp(),
        history_days=collect_logs.HISTORY_DAYS,
        pretty=True,
    )
    collect_logs.update_logs(args)

    entries = json.loads(logs_path.read_text(encoding="utf-8"))
    assert {entry["run_id"] for entry in entries} == {"2", "99"}
    # Oldest entry should be removed
    assert all(entry["run_id"] != "1" for entry in entries)
    # Ordering should keep the newest entry first
    assert entries[0]["run_id"] == "99"
