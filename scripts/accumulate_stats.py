import argparse
import json
import os
import sys
from datetime import date
from urllib.request import urlopen

DEFAULT_OUTPUT_FILE = "stats.json"
DEFAULT_URL = "https://stats.sublimetext.io/all-totals"

# Retention limits
HISTORY_DAYS = 30
HISTORY_WEEKS = 52
HISTORY_YEARS = 3

PREV_TOTALS_FILE = "prev_totals.json"


def main():
    args = parse_args()
    wd = os.path.abspath(args.wd)
    os.makedirs(wd, exist_ok=True)

    args.output = os.path.normpath(os.path.join(wd, args.output))

    prev_path = os.path.join(wd, PREV_TOTALS_FILE)
    prev_totals = load_json(prev_path) or {}

    try:
        current_totals = fetch_totals(args.url)
    except Exception as e:
        print(f"Error fetching stats: {e}", file=sys.stderr)
        sys.exit(1)

    output_data = load_json(args.output) or {}

    today = date.today()
    day_label = today.isoformat()
    week_label = f"{today.isocalendar().year}-W{today.isocalendar().week:02d}"
    year_label = str(today.year)

    for label, key, keep in [
        (day_label, "__daily_dates", HISTORY_DAYS),
        (week_label, "__weekly_dates", HISTORY_WEEKS),
        (year_label, "__yearly_dates", HISTORY_YEARS),
    ]:
        dates = output_data.setdefault(key, [])
        if not dates or dates[0] != label:
            dates.insert(0, label)
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
            prev_total = prev_metrics.get(source_key, current_total)
            delta = max(0, current_total - prev_total)

            container["totals"] = current_total
            accumulate(delta, container, "daily", len(output_data["__daily_dates"]))
            accumulate(delta, container, "weekly", len(output_data["__weekly_dates"]))
            accumulate(delta, container, "yearly", len(output_data["__yearly_dates"]))

    save_json(args.output, output_data, pretty=args.pretty)
    save_json(prev_path, current_totals)


def accumulate(value: int, container: dict, key: str, wanted_length: int):
    dates = container.get(key, [])
    # Maybe left pad data
    dates = [0] * (wanted_length - len(dates)) + dates
    # Trim to the wanted length
    dates = dates[:wanted_length]
    # Accumulate the value
    dates[0] += value
    container[key] = dates


def fetch_totals(url: str) -> dict:
    with urlopen(url) as resp:
        return json.load(resp)


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
        "--pretty",
        action="store_true",
        help="Pretty-print JSON output (indent=2)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
