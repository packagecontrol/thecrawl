import json
import sys
from datetime import date, timedelta

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


def test_daily_rollover_trims_oldest_entry(tmp_path, monkeypatch):
    monkeypatch.setattr(accumulate_stats, "date", _FixedDate)

    history_days = accumulate_stats.HISTORY_DAYS
    base_day = date(2024, 5, 11)
    existing_dates = [
        (base_day - timedelta(days=offset)).isoformat()
        for offset in range(history_days)
    ]
    seed_daily_counts = list(range(1, history_days + 1))

    stats_data = {
        "__daily_dates": existing_dates,
        "__weekly_dates": ["2024-W19"],
        "__yearly_dates": ["2024"],
        "RSpec": {
            "installs": {
                "daily": seed_daily_counts.copy(),
                "weekly": [sum(seed_daily_counts)],
                "yearly": [sum(seed_daily_counts)],
                "totals": 100,
            }
        },
    }

    prev_totals = {"RSpec": {"install": 100, "upgrade": 0, "remove": 0}}

    (tmp_path / "stats.json").write_text(json.dumps(stats_data))
    (tmp_path / accumulate_stats.PREV_TOTALS_FILE).write_text(json.dumps(prev_totals))

    monkeypatch.setattr(accumulate_stats, "fetch_totals", lambda url: {
        "RSpec": {"install": 105, "upgrade": 0, "remove": 0}
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
    installs = stats["RSpec"]["installs"]

    expected_dates = ["2024-05-12"] + existing_dates[:-1]
    expected_daily = [5] + seed_daily_counts[:-1]

    assert stats["__daily_dates"] == expected_dates
    assert installs["daily"] == expected_daily
    assert len(installs["daily"]) == history_days


def test_missing_days_are_filled_with_zeros(tmp_path, monkeypatch):
    # Simulate having last run on 2024-05-10 and resuming on 2024-05-13
    monkeypatch.setattr(accumulate_stats, "date", _NextDay)

    history_days = accumulate_stats.HISTORY_DAYS
    base_day = date(2024, 5, 10)
    existing_dates = [
        (base_day - timedelta(days=offset)).isoformat()
        for offset in range(history_days)
    ]
    seed_daily_counts = list(range(1, history_days + 1))

    stats_data = {
        "__daily_dates": existing_dates,
        "__weekly_dates": ["2024-W19"],
        "__yearly_dates": ["2024"],
        "RSpec": {
            "installs": {
                "daily": seed_daily_counts.copy(),
                "weekly": [sum(seed_daily_counts)],
                "yearly": [sum(seed_daily_counts)],
                "totals": 100,
            }
        },
    }
    prev_totals = {"RSpec": {"install": 100, "upgrade": 0, "remove": 0}}

    (tmp_path / "stats.json").write_text(json.dumps(stats_data))
    (tmp_path / accumulate_stats.PREV_TOTALS_FILE).write_text(json.dumps(prev_totals))

    monkeypatch.setattr(accumulate_stats, "fetch_totals", lambda url: {
        "RSpec": {"install": 115, "upgrade": 0, "remove": 0}
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
    installs = stats["RSpec"]["installs"]

    expected_dates = ["2024-05-13", "2024-05-12", "2024-05-11"] + existing_dates
    expected_dates = expected_dates[:history_days]
    expected_daily = [15, 0, 0] + seed_daily_counts
    expected_daily = expected_daily[:history_days]

    assert stats["__daily_dates"] == expected_dates
    assert installs["daily"] == expected_daily
    assert len(installs["daily"]) == history_days


def test_new_package_arrays_are_zero_padded(tmp_path, monkeypatch):
    monkeypatch.setattr(accumulate_stats, "date", _FixedDate)

    daily_dates = ["2024-05-12", "2024-05-11", "2024-05-10"]
    weekly_dates = ["2024-W19", "2024-W18"]
    yearly_dates = ["2024", "2023"]

    stats_data = {
        "__daily_dates": daily_dates,
        "__weekly_dates": weekly_dates,
        "__yearly_dates": yearly_dates,
        "RSpec": {
            "installs": {
                "daily": [4, 3, 2],
                "weekly": [7, 6],
                "yearly": [13, 0],
                "totals": 13,
            }
        },
    }

    prev_totals = {"RSpec": {"install": 13, "upgrade": 0, "remove": 0}}

    (tmp_path / "stats.json").write_text(json.dumps(stats_data))
    (tmp_path / accumulate_stats.PREV_TOTALS_FILE).write_text(json.dumps(prev_totals))

    monkeypatch.setattr(accumulate_stats, "fetch_totals", lambda url: {
        "RSpec": {"install": 15, "upgrade": 0, "remove": 0},
        "NewPkg": {"install": 5, "upgrade": 0, "remove": 0},
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
    new_pkg = stats["NewPkg"]["installs"]

    assert len(new_pkg["daily"]) == len(stats["__daily_dates"])
    assert len(new_pkg["weekly"]) == len(stats["__weekly_dates"])
    assert len(new_pkg["yearly"]) == len(stats["__yearly_dates"])

    assert new_pkg["daily"] == [5, 0, 0]
    assert new_pkg["weekly"] == [5, 0]
    assert new_pkg["yearly"] == [5, 0]


def test_partial_history_package_keeps_recent_entries(tmp_path, monkeypatch):
    monkeypatch.setattr(accumulate_stats, "date", _NextDay)

    daily_dates = ["2024-05-12", "2024-05-11", "2024-05-10", "2024-05-09"]

    stats_data = {
        "__daily_dates": daily_dates,
        "__weekly_dates": ["2024-W19"],
        "__yearly_dates": ["2024"],
        "PartialPkg": {
            "installs": {
                "daily": [2, 1],  # Only two data points recorded so far
                                  # Note that this state *should* be impossible to
                                  # reach under normal circumstances since we
                                  # right pad on each iteration.
                "weekly": [3],
                "yearly": [3],
                "totals": 3,
            }
        },
    }
    prev_totals = {"PartialPkg": {"install": 3}}

    (tmp_path / "stats.json").write_text(json.dumps(stats_data))
    (tmp_path / accumulate_stats.PREV_TOTALS_FILE).write_text(json.dumps(prev_totals))

    monkeypatch.setattr(accumulate_stats, "fetch_totals", lambda url: {
        "PartialPkg": {"install": 5, "upgrade": 0, "remove": 0},
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
    installs = stats["PartialPkg"]["installs"]["daily"]
    assert installs == [2, 2, 1, 0, 0]
