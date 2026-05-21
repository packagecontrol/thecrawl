from __future__ import annotations

import re
import string
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass
from functools import cached_property
from itertools import count, product
from typing import Callable

from packaging.version import InvalidVersion, Version

from ._resolve_lib import (
    ALL_MARKER,
    Release,
    SUPPORTED_PLATFORMS,
    SUPPORTED_PYTHON_VERSIONS,
)
from ._utils import unique_values_preserving_order


type StBuild = str
type Platform = str
type PyHost = str
type VersionString = str
type MatrixKey = tuple[StBuild, Platform, PyHost]
type TableKey = tuple[Platform, PyHost]
type TableCells = dict[TableKey, VersionString]


@dataclass
class MatrixTable:
    cells: TableCells

    @cached_property
    def platforms(self) -> list[Platform]:
        return sorted(
            {platform for platform, _ in self.cells},
            key=platform_sort_key,
        )

    @cached_property
    def python_versions(self) -> list[PyHost]:
        return sorted(
            {python_version for _, python_version in self.cells},
            key=python_version_sort_key,
        )

    @cached_property
    def versions(self) -> list[VersionString]:
        return unique_values_preserving_order(
            version
            for platform, python_version in product(self.platforms, self.python_versions)
            if (version := self.cells.get((platform, python_version)))
        )


type MatrixTables = dict[StBuild, MatrixTable]


def format_library_doctor(
    name: str,
    latest_version: str | None,
    sources: list[str],
    releases: list[Release],
) -> str:
    source_label = ", ".join(sources) if sources else "cache"
    lines = [
        f"{name} release matrix; -v to see the raw JSON output",
        f"Source: {source_label}",
    ]
    if latest_version:
        lines.append(f"Latest version: {latest_version}")
    lines.append("")

    tables = release_matrix(releases)
    if not tables:
        lines.append("No release matrix.")
        return "\n".join(lines)

    sublime_texts = ordered_sublime_texts(tables)
    matrix_versions = ordered_matrix_versions(tables, sublime_texts)
    version_labels = make_version_labels(matrix_versions)
    show_sublime_headings = sublime_texts != ["*"]
    if show_sublime_headings:
        lines.append("")
    for index, sublime_text in enumerate(sublime_texts):
        if index:
            lines.extend(["", ""])
        lines.extend(
            format_sublime_matrix(
                sublime_text,
                tables[sublime_text],
                version_labels,
                show_heading=show_sublime_headings,
            )
        )

    if matrix_versions:
        lines.append("")
        lines.extend(format_version_legend(matrix_versions, version_labels))

    return "\n".join(lines)


def release_matrix(releases: list[Release]) -> MatrixTables:
    cells_by_sublime_text: dict[StBuild, TableCells] = defaultdict(dict)
    for release in releases:
        for sublime_text, platform, python_version in release_coordinates(release):
            cells_by_sublime_text[sublime_text].setdefault(
                (platform, python_version), release["version"]
            )

    return {
        sublime_text: MatrixTable(cells)
        for sublime_text, cells in cells_by_sublime_text.items()
    }


def release_coordinates(release: Release) -> Iterator[MatrixKey]:
    for platform, python_version in product(
        expand_all_marker(release["platforms"], SUPPORTED_PLATFORMS),
        expand_all_marker(release["python_versions"], SUPPORTED_PYTHON_VERSIONS),
    ):
        yield release["sublime_text"], platform, python_version


def expand_all_marker(values: list[str], replacement: list[str]) -> list[str]:
    return replacement if values == ALL_MARKER else values


def format_sublime_matrix(
    sublime_text: StBuild,
    table: MatrixTable,
    version_labels: dict[str, str],
    *,
    show_heading: bool,
) -> list[str]:
    lines = []
    if show_heading:
        lines.extend([format_sublime_heading(sublime_text), ""])
    lines.extend(format_matrix_table(table, version_labels))
    return lines


def format_sublime_heading(sublime_text: str) -> str:
    if sublime_text == "*":
        return "# Sublime (all builds)"
    return f"# Sublime {sublime_text}"


def format_matrix_table(
    table: MatrixTable,
    version_labels: dict[str, str],
) -> list[str]:
    platform_width = max([len(platform) for platform in table.platforms] + [0])
    row_header_width = platform_width + 2
    headers = [format_python_header(version) for version in table.python_versions]
    col_widths = [len(header) for header in headers]
    rows = []

    for platform in table.platforms:
        values = []
        for index, python_version in enumerate(table.python_versions):
            version = table.cells.get((platform, python_version))
            value = version_labels[version] if version else "-"
            col_widths[index] = max(col_widths[index], len(value))
            values.append(value)
        rows.append((platform, values))

    value_width = sum(col_widths) + 2 * (len(col_widths) - 1)
    lines = [
        " " * (row_header_width + 3)
        + "  ".join(
            header.ljust(width)
            for header, width in zip(headers, col_widths)
        ),
        "-" * row_header_width + "+--" + "-" * value_width,
    ]
    for platform, values in rows:
        lines.append(
            platform.ljust(row_header_width)
            + "   "
            + "  ".join(
                value.ljust(width)
                for value, width in zip(values, col_widths)
            )
        )
    return lines


def format_version_legend(
    versions: list[str], version_labels: dict[str, str]
) -> list[str]:
    versions = sorted(versions, key=lambda version: version_labels[version])
    label_width = max(len(version_labels[version]) for version in versions)
    return [
        f"{version_labels[version].ljust(label_width)} = {version}"
        for version in versions
    ]


def ordered_sublime_texts(tables: MatrixTables) -> list[StBuild]:
    return sorted(tables, key=sublime_text_sort_key)


def sublime_text_sort_key(value: str) -> tuple[int, int, str]:
    if value == "*":
        return (0, 0, value)
    return (1, -sublime_text_lower_bound(value), value)


def sublime_text_lower_bound(value: str) -> int:
    if value.startswith("<"):
        return 0
    match = re.search(r"\d+", value)
    if match:
        return int(match.group())
    return 0


def platform_sort_key(platform: str) -> tuple[int, str]:
    try:
        return SUPPORTED_PLATFORMS.index(platform), platform
    except ValueError:
        return len(SUPPORTED_PLATFORMS), platform


def python_version_sort_key(python_version: str):
    try:
        return Version(python_version)
    except InvalidVersion:
        return Version("0")


def ordered_matrix_versions(
    tables: MatrixTables, sublime_texts: list[StBuild]
) -> list[VersionString]:
    return unique_values_preserving_order(
        version
        for sublime_text in sublime_texts
        for version in tables[sublime_text].versions
    )


def make_version_labels(versions: list[str]) -> dict[str, str]:
    """
    Create a lookup table from unique literal versions to matrix abbreviations.

    The input order is the matrix display order. Versions in the same
    major-version group reuse the same letter with suffixes:
    A, A', A'', A''', A5...
    """
    label = make_version_labeler()
    return {
        version: label(version)
        for version in versions
    }


def make_version_labeler() -> Callable[[VersionString], str]:
    labelers = (
        _with_suffixes(prefix)
        for size in count(1)
        for letters in product(string.ascii_uppercase, repeat=size)
        if (prefix := "".join(letters))
    )
    known_groups: dict[object, Iterator[str]] = defaultdict(lambda: next(labelers))

    def inner(version) -> str:
        group = version_group(version)
        return next(known_groups[group])

    return inner


def _with_suffixes(prefix: str) -> Iterator[str]:
    for index in range(4):
        yield prefix + index * "'"

    while True:
        index += 1
        yield f"{prefix}{index}"


def version_group(version: str):
    try:
        return Version(version).major
    except InvalidVersion:
        return version


def format_python_header(python_version: str) -> str:
    return f"py{python_version.replace('.', '')}"
