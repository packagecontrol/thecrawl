import argparse
import hashlib
import json
import os
import shutil
import sys
from datetime import date, timedelta
from itertools import count, takewhile
from urllib.request import Request, urlopen

DEFAULT_OUTPUT_FILE = "stats.json"
DEFAULT_URL = "https://stats.sublimetext.io/all-totals"
DEFAULT_RESTORE_DIR = "./restore-stats"

# Retention limits
HISTORY_DAYS = 30
HISTORY_WEEKS = 53
HISTORY_YEARS = 3

PREV_TOTALS_FILE = "prev_totals.json"


def main():
    args = parse_args()
    wd = os.path.abspath(args.wd)
    os.makedirs(wd, exist_ok=True)

    args.output = os.path.normpath(os.path.join(wd, args.output))

    prev_path = os.path.join(wd, PREV_TOTALS_FILE)
    restore_root = os.path.abspath(args.restore_from)
    ingest_restore_if_needed(wd, restore_root)
    prev_totals = load_json(prev_path) or {}
    is_pristine = not prev_totals

    try:
        current_totals = fetch_totals(args.url)
    except Exception as e:
        print(f"Error fetching stats: {e}", file=sys.stderr)
        sys.exit(1)

    output_data = load_json(args.output) or {}

    today = date.today()
    # Days backwards (today, yesterday, day before, …)
    day_labels = (
        (today - timedelta(days=i)).isoformat()
        for i in count()
    )
    # Weeks backwards (this week, last week, week before, …)
    week_labels = (
        f"{iso.year}-W{iso.week:02d}"
        for i in count()
        if (iso := (today - timedelta(weeks=i)).isocalendar())
    )
    # Years backwards (this year, last year, …)
    year_labels = (
        str(today.year - i)
        for i in count()
    )

    rollovers = {}
    for period, labels, keep in [
        ("daily", day_labels, HISTORY_DAYS),
        ("weekly", week_labels, HISTORY_WEEKS),
        ("yearly", year_labels, HISTORY_YEARS),
    ]:
        key = f"__{period}_dates"
        dates = output_data.get(key, [])
        if not dates:
            new_dates = [next(labels)]
        else:
            new_dates = list(takewhile(lambda label: label != dates[0], labels))
        rollovers[period] = len(new_dates)
        dates = new_dates + dates
        output_data[key] = dates[:keep]

    for pkg, metrics in current_totals.items():
        prev_metrics = prev_totals.get(pkg, {})
        pkg_data = output_data.setdefault(pkg, {})

        for source_key, target_key in (
            ("install", "installs"), ("upgrade", "upgrades"), ("remove", "removals")
        ):
            container = pkg_data.setdefault(target_key, {
                "daily": [], "weekly": [], "yearly": []
            })

            current_total = metrics.get(source_key, 0)
            baseline = current_total if is_pristine else 0
            prev_total = prev_metrics.get(source_key, baseline)
            delta = max(0, current_total - prev_total)
            if delta > 0:
                print(f'"{pkg}" {target_key} +{delta}')

            container["totals"] = current_total
            accumulate(delta, container, "daily", len(output_data["__daily_dates"]), rollovers["daily"])
            accumulate(delta, container, "weekly", len(output_data["__weekly_dates"]), rollovers["weekly"])
            accumulate(delta, container, "yearly", len(output_data["__yearly_dates"]), rollovers["yearly"])

    save_json(args.output, output_data, pretty=args.pretty)
    save_json(prev_path, current_totals)


def accumulate(value: int, container: dict, key: str, wanted_length: int, rollovers: int):
    dates = container.get(key, [])
    if rollovers:
        dates = [0] * rollovers + dates
    # Maybe left pad data
    dates = [0] * (wanted_length - len(dates)) + dates
    # Trim to the wanted length
    dates = dates[:wanted_length]
    # Accumulate the value
    dates[0] += value
    container[key] = dates


def fetch_totals(url: str) -> dict:
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request) as resp:
        return json.load(resp)


def ingest_restore_if_needed(wd: str, restore_dir: str):
    restore_dir = os.path.abspath(restore_dir)
    if not os.path.isdir(restore_dir):
        return

    restore_files = [
        os.path.join(restore_dir, name)
        for name in os.listdir(restore_dir)
        if os.path.isfile(os.path.join(restore_dir, name))
    ]

    if not restore_files:
        return

    hasher = hashlib.sha256()
    for path in sorted(restore_files):
        hasher.update(os.path.basename(path).encode("utf-8"))
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                hasher.update(chunk)

    marker_path = os.path.join(wd, f"ingested_{hasher.hexdigest()}")
    if os.path.exists(marker_path):
        return

    for src in restore_files:
        dest = os.path.join(wd, os.path.basename(src))
        shutil.copy2(src, dest)
        print(f"Ingested {os.path.basename(src)}")

    print(f"Write {hasher.hexdigest()} marker")
    # Touch the marker file to note that the backup was ingested
    with open(marker_path, "w", encoding="utf-8") as marker:
        marker.write("")


def load_json(path: str) -> dict | None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def save_json(path: str, data: dict, pretty: bool = False):
    with open(path, "w", encoding="utf-8") as f:
        if pretty:
            json.dump(data, f, indent=2)
        else:
            json.dump(data, f, separators=(",", ":"))


def parse_args():
    parser = argparse.ArgumentParser(description="Compute daily, weekly, yearly download counts from all-time totals")
    parser.add_argument(
        "-o",
        "--output",
        type=str,
        default=DEFAULT_OUTPUT_FILE,
        help=f"Output file path (default: {DEFAULT_OUTPUT_FILE}).",
    )
    parser.add_argument(
        "--wd",
        type=str,
        default=".",
        help="Working directory (default: .)",
    )
    parser.add_argument(
        "--url",
        type=str,
        default=DEFAULT_URL,
        help=f"Stats URL (default: {DEFAULT_URL}).",
    )
    parser.add_argument(
        "--restore-from",
        type=str,
        default=DEFAULT_RESTORE_DIR,
        help=f"Directory to ingest initial data from (default: {DEFAULT_RESTORE_DIR}).",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON output (indent=2)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
