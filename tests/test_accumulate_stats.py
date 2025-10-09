import json
import sys
from datetime import date

import scripts.accumulate_stats as accumulate_stats


class _FixedDate(date):
    @classmethod
    def today(cls):
        return cls(2024, 5, 12)


def test_initial_run_with_pristine_prev_totals(tmp_path, monkeypatch):
    monkeypatch.setattr(accumulate_stats, "fetch_totals", lambda url: {
        "RSpec": {"install": 2, "upgrade": 0, "remove": 0}
    })
    monkeypatch.setattr(accumulate_stats, "date", _FixedDate)

    monkeypatch.setattr(sys, "argv", [
        "accumulate-stats",
        "--wd",
        str(tmp_path),
        "--url",
        "https://example.invalid/all-totals",
        "--restore-from",
        str(tmp_path / "missing-restore"),
    ])

    accumulate_stats.main()

    stats_path = tmp_path / "stats.json"
    prev_path = tmp_path / accumulate_stats.PREV_TOTALS_FILE

    assert stats_path.exists()
    assert prev_path.exists()

    stats = json.loads(stats_path.read_text())
    prev = json.loads(prev_path.read_text())

    assert stats["__daily_dates"] == ["2024-05-12"]
    assert stats["__weekly_dates"] == ["2024-W19"]
    assert stats["__yearly_dates"] == ["2024"]

    installs = stats["RSpec"]["installs"]
    assert installs["totals"] == 2
    assert installs["daily"] == [2]
    assert installs["weekly"] == [2]
    assert installs["yearly"] == [2]

    upgrades = stats["RSpec"]["upgrades"]
    assert upgrades["totals"] == 0
    assert upgrades["daily"] == [0]

    removals = stats["RSpec"]["removals"]
    assert removals["totals"] == 0
    assert removals["daily"] == [0]

    assert prev == {"RSpec": {"install": 2, "upgrade": 0, "remove": 0}}


def test_second_run_same_day_accumulates(tmp_path, monkeypatch):
    monkeypatch.setattr(accumulate_stats, "date", _FixedDate)

    monkeypatch.setattr(accumulate_stats, "fetch_totals", lambda url: {
        "RSpec": {"install": 2, "upgrade": 0, "remove": 0}
    })
    monkeypatch.setattr(sys, "argv", [
        "accumulate-stats",
        "--wd",
        str(tmp_path),
        "--url",
        "https://example.invalid/all-totals",
        "--restore-from",
        str(tmp_path / "missing-restore"),
    ])
    accumulate_stats.main()

    monkeypatch.setattr(accumulate_stats, "fetch_totals", lambda url: {
        "RSpec": {"install": 5, "upgrade": 0, "remove": 0}
    })
    monkeypatch.setattr(sys, "argv", [
        "accumulate-stats",
        "--wd",
        str(tmp_path),
        "--url",
        "https://example.invalid/all-totals",
        "--restore-from",
        str(tmp_path / "missing-restore"),
    ])
    accumulate_stats.main()

    stats = json.loads((tmp_path / "stats.json").read_text())
    prev = json.loads((tmp_path / accumulate_stats.PREV_TOTALS_FILE).read_text())

    assert stats["__daily_dates"] == ["2024-05-12"]
    assert stats["__weekly_dates"] == ["2024-W19"]
    assert stats["__yearly_dates"] == ["2024"]

    installs = stats["RSpec"]["installs"]
    assert installs["totals"] == 5
    assert installs["daily"] == [5]
    assert installs["weekly"] == [5]
    assert installs["yearly"] == [5]

    assert prev == {"RSpec": {"install": 5, "upgrade": 0, "remove": 0}}


class _NextDay(date):
    @classmethod
    def today(cls):
        return cls(2024, 5, 13)


def test_third_run_next_day_rolls_window(tmp_path, monkeypatch):
    # Seed previous day data
    monkeypatch.setattr(accumulate_stats, "date", _FixedDate)
    monkeypatch.setattr(accumulate_stats, "fetch_totals", lambda url: {
        "RSpec": {"install": 5, "upgrade": 0, "remove": 0}
    })
    monkeypatch.setattr(sys, "argv", [
        "accumulate-stats",
        "--wd",
        str(tmp_path),
        "--url",
        "https://example.invalid/all-totals",
        "--restore-from",
        str(tmp_path / "missing-restore"),
    ])
    accumulate_stats.main()

    # Advance to next day with increased installs
    monkeypatch.setattr(accumulate_stats, "date", _NextDay)
    monkeypatch.setattr(accumulate_stats, "fetch_totals", lambda url: {
        "RSpec": {"install": 9, "upgrade": 0, "remove": 0}
    })
    monkeypatch.setattr(sys, "argv", [
        "accumulate-stats",
        "--wd",
        str(tmp_path),
        "--url",
        "https://example.invalid/all-totals",
        "--restore-from",
        str(tmp_path / "missing-restore"),
    ])
    accumulate_stats.main()

    stats = json.loads((tmp_path / "stats.json").read_text())
    prev = json.loads((tmp_path / accumulate_stats.PREV_TOTALS_FILE).read_text())

    assert stats["__daily_dates"] == ["2024-05-13", "2024-05-12"]
    assert stats["__weekly_dates"][0] == "2024-W20"
    assert stats["__yearly_dates"] == ["2024"]

    installs = stats["RSpec"]["installs"]
    assert installs["totals"] == 9
    assert installs["daily"] == [4, 5]
    assert installs["weekly"] == [4, 5]
    assert installs["yearly"][0] == 9

    assert prev == {"RSpec": {"install": 9, "upgrade": 0, "remove": 0}}
