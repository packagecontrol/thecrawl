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
    for pkg, metrics in current_totals.items():
        prev_metrics = prev_totals.get(pkg, {})
        pkg_data = output_data.setdefault(pkg, {})

        for source_key, target_key in (
            ("install", "installs"), ("upgrade", "upgrades"), ("remove", "removals")
        ):
            container = pkg_data.setdefault(target_key, {
                "daily": {"dates": [], "data": []},
                "weekly": {"dates": [], "data": []},
                "yearly": {"dates": [], "data": []},
            })

            current_total = metrics.get(source_key, 0)
            prev_total = prev_metrics.get(source_key, current_total)
            delta = max(0, current_total - prev_total)

            container["totals"] = current_total
            accumulate(delta, container["daily"], day_label, HISTORY_DAYS)
            accumulate(delta, container["weekly"], week_label, HISTORY_WEEKS)
            accumulate(delta, container["yearly"], year_label, HISTORY_YEARS)

    save_json(args.output, output_data)
    save_json(prev_path, current_totals)


def accumulate(value: int, section_data: dict, label: str, keep: int):
    if not section_data["dates"] or section_data["dates"][0] != label:
        # start new period
        section_data["dates"].insert(0, label)
        section_data["data"].insert(0, value)
    else:
        section_data["data"][0] += value

    # trim history
    section_data["dates"] = section_data["dates"][:keep]
    section_data["data"] = section_data["data"][:keep]


def fetch_totals(url: str) -> dict:
    with urlopen(url) as resp:
        return json.load(resp)


def load_json(path: str) -> dict | None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def save_json(path: str, data: dict):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


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
    return parser.parse_args()


if __name__ == "__main__":
    main()
