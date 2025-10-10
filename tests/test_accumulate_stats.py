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
    assert installs["daily"] == [0]
    assert installs["weekly"] == [0]
    assert installs["yearly"] == [0]

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
    assert installs["daily"] == [3]
    assert installs["weekly"] == [3]
    assert installs["yearly"] == [3]

    assert prev == {"RSpec": {"install": 5, "upgrade": 0, "remove": 0}}


def test_new_package_after_initial_run_gets_delta(tmp_path, monkeypatch):
    monkeypatch.setattr(accumulate_stats, "date", _FixedDate)

    # Pristine run seeds baseline totals without recording deltas
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

    # Subsequent run introduces a new package that should record its first delta
    def _fetch_with_new_package(url):
        return {
            "RSpec": {"install": 5, "upgrade": 0, "remove": 0},
            "NewPkg": {"install": 4, "upgrade": 0, "remove": 0},
        }

    monkeypatch.setattr(accumulate_stats, "fetch_totals", _fetch_with_new_package)
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
    new_pkg = stats["NewPkg"]["installs"]
    assert new_pkg["daily"] == [4]
    assert new_pkg["weekly"] == [4]
    assert new_pkg["yearly"] == [4]

    existing_pkg = stats["RSpec"]["installs"]
    assert existing_pkg["daily"] == [3]
    assert existing_pkg["weekly"] == [3]
    assert existing_pkg["yearly"] == [3]


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
    assert installs["daily"] == [4, 0]
    assert installs["weekly"] == [4, 0]
    assert installs["yearly"] == [4]

    assert prev == {"RSpec": {"install": 9, "upgrade": 0, "remove": 0}}
