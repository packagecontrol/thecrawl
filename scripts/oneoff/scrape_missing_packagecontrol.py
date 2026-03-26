from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from html import unescape
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urljoin
from urllib.request import Request, urlopen

DEFAULT_SEARCH_URL = "https://packagecontrol.io/search/%3Amissing"
DEFAULT_OUTPUT = "missing.json"
DEFAULT_TIMEOUT = 30.0
UTC_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

RESULTS_BLOCK_RE = re.compile(r'<ul class="packages results">(.*?)</ul>', re.S)
PACKAGE_LINK_RE = re.compile(r'href="(/packages/[^"]+)"')
NAME_RE = re.compile(r'<div id="content">.*?<h1>(.*?)</h1>', re.S)
LABELS_BLOCK_RE = re.compile(r'<div class="labels">(.*?)</div>', re.S)
LABEL_RE = re.compile(r'<a[^>]*href="/browse/labels/[^"]+"[^>]*>(.*?)</a>', re.S)
FIRST_SEEN_RE = re.compile(r'<li class="first_seen">.*?<span[^>]*title="([^"]+)"', re.S)
LAST_SEEN_RE = re.compile(r'<li class="last_seen">.*?<span[^>]*title="([^"]+)"', re.S)


def main() -> None:
    args = parse_args()
    records = scrape_missing_packages(args)
    write_output(Path(args.output), records)
    print(
        f"Wrote {len(records)} package records to {args.output}",
        file=sys.stderr,
    )


@dataclass
class Args:
    search_url: str
    output: str
    timeout: float
    max_pages: int


def parse_args() -> Args:
    parser = argparse.ArgumentParser(
        description=(
            "Scrape packagecontrol.io :missing pages and export package info "
            "to missing.json"
        )
    )
    parser.add_argument(
        "--search-url",
        default=DEFAULT_SEARCH_URL,
        help=f"Starting URL for :missing search results (default: {DEFAULT_SEARCH_URL}).",
    )
    parser.add_argument(
        "-o",
        "--output",
        default=DEFAULT_OUTPUT,
        help=f"Output JSON file path (default: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT,
        help=f"HTTP timeout in seconds (default: {DEFAULT_TIMEOUT}).",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=0,
        help="Optional page cap for testing (0 means no cap).",
    )
    ns = parser.parse_args()
    return Args(
        search_url=ns.search_url,
        output=ns.output,
        timeout=ns.timeout,
        max_pages=ns.max_pages,
    )


def scrape_missing_packages(args: Args) -> list[dict[str, object | None]]:
    package_paths = collect_package_paths(
        search_url=args.search_url,
        timeout=args.timeout,
        max_pages=args.max_pages,
    )
    records_by_name: dict[str, dict[str, object | None]] = {}

    for index, path in enumerate(package_paths, start=1):
        detail_url = urljoin(args.search_url, path)
        try:
            html = fetch_text(detail_url, timeout=args.timeout)
        except Exception as exc:  # noqa: BLE001
            print(f"Skipping {detail_url}: {exc}", file=sys.stderr)
            continue

        record = extract_package_record(path, html)
        if not record:
            print(f"Skipping {detail_url}: could not determine package name", file=sys.stderr)
            continue

        name = record["name"]
        if isinstance(name, str) and name not in records_by_name:
            records_by_name[name] = record

        print(f"[{index}/{len(package_paths)}] {name}", file=sys.stderr)

    records = list(records_by_name.values())
    records.sort(key=lambda item: str(item["name"]).casefold())
    return records


def collect_package_paths(search_url: str, timeout: float, max_pages: int) -> list[str]:
    page = 1
    seen_paths: set[str] = set()
    paths: list[str] = []

    while True:
        if max_pages > 0 and page > max_pages:
            break

        page_url = search_url if page == 1 else f"{search_url}?page={page}"
        html = fetch_text(page_url, timeout=timeout)
        page_paths = extract_package_paths_from_search(html)

        if not page_paths:
            break

        new_count = 0
        for path in page_paths:
            if path not in seen_paths:
                seen_paths.add(path)
                paths.append(path)
                new_count += 1

        print(
            f"Page {page}: {len(page_paths)} package links ({new_count} new)",
            file=sys.stderr,
        )
        page += 1

    return paths


def extract_package_paths_from_search(html: str) -> list[str]:
    if not (block_match := RESULTS_BLOCK_RE.search(html)):
        return []

    block = block_match.group(1)
    seen: set[str] = set()
    paths: list[str] = []

    for match in PACKAGE_LINK_RE.finditer(block):
        path = unescape(match.group(1)).strip()
        if not path or path in seen:
            continue
        seen.add(path)
        paths.append(path)

    return paths


def extract_package_record(path: str, html: str) -> dict[str, object | None] | None:
    name = extract_name(path, html)
    if not name:
        return None

    return {
        "name": name,
        "labels": extract_labels(html),
        "first_seen": extract_timestamp(FIRST_SEEN_RE, html),
        "last_seen": extract_timestamp(LAST_SEEN_RE, html),
    }


def extract_name(path: str, html: str) -> str:
    raw = path.rsplit("/", 1)[-1]
    name_from_path = normalize_text(unquote(raw))
    if name_from_path:
        return name_from_path

    if match := NAME_RE.search(html):
        name = normalize_text(match.group(1))
        if name:
            return name

    return ""


def extract_labels(html: str) -> list[str]:
    if not (block_match := LABELS_BLOCK_RE.search(html)):
        return []

    block = block_match.group(1)
    labels: list[str] = []
    seen: set[str] = set()

    for match in LABEL_RE.finditer(block):
        label = normalize_text(match.group(1))
        if not label or label in seen:
            continue
        seen.add(label)
        labels.append(label)

    return labels


def extract_timestamp(pattern: re.Pattern[str], html: str) -> str | None:
    if not (match := pattern.search(html)):
        return None

    value = match.group(1).strip()
    if not value:
        return None

    try:
        datetime.strptime(value, UTC_FORMAT)
    except ValueError:
        return None

    return value


def normalize_text(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", unescape(value))
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Cf")
    return " ".join(value.split())


def fetch_text(url: str, timeout: float, retries: int = 3) -> str:
    request = Request(url, headers={"User-Agent": "the-crawler missing scraper"})

    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.read().decode("utf-8", errors="replace")
        except (HTTPError, URLError, TimeoutError) as exc:
            last_error = exc
            if attempt == retries:
                break
            print(f"Retry {attempt}/{retries - 1} for {url}: {exc}", file=sys.stderr)

    if last_error is None:
        raise RuntimeError(f"Failed to fetch URL: {url}")
    raise RuntimeError(f"Failed to fetch URL after {retries} attempts: {url}") from last_error


def write_output(path: Path, records: list[dict[str, object | None]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
