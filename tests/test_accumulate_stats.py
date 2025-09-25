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
        "https://example.invalid/all-totals"
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
