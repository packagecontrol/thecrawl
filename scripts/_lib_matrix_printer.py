from __future__ import annotations

import re
import string
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass
from functools import cached_property
from itertools import count, product
from typing import Callable, Iterable

from packaging.version import InvalidVersion, Version

from ._resolve_lib import (
    ALL_MARKER,
    Release,
    SUPPORTED_PLATFORMS,
    SUPPORTED_PYTHON_VERSIONS,
)
from ._lib_doctor import UnmatchedReleaseDefinition
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
    missing_cells: frozenset[TableKey] = frozenset()

    @cached_property
    def platforms(self) -> list[Platform]:
        return sorted(
            {platform for platform, _ in set(self.cells) | self.missing_cells},
            key=platform_sort_key,
        )

    @cached_property
    def python_versions(self) -> list[PyHost]:
        return sorted(
            {
                python_version
                for _, python_version in set(self.cells) | self.missing_cells
            },
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


def format_library_matrix(
    name: str,
    latest_version: str | None,
    sources: list[str],
    releases: list[Release],
    unmatched_definitions: list[UnmatchedReleaseDefinition] = [],
) -> str:
    source_label = ", ".join(sources) if sources else "cache"
    lines = [
        f"{name} release matrix; -v to see the raw JSON output",
        f"Source: {source_label}",
    ]
    if latest_version:
        lines.append(f"Latest version: {latest_version}")
    lines.append("")

    has_unmatched_definitions = bool(unmatched_definitions)
    missing_coordinates = missing_matrix_coordinates(unmatched_definitions)
    tables = release_matrix(releases, missing_coordinates)
    if not tables:
        lines.append("No release matrix.")
        if has_unmatched_definitions:
            lines.append(
                "Some expected release definitions did not match; run -v for details."
            )
        return "\n".join(lines)

    sublime_texts = ordered_sublime_texts(tables)
    matrix_versions = ordered_matrix_versions(tables, sublime_texts)
    reserved_labels = {"X"} if missing_coordinates else set()
    version_labels = make_version_labels(matrix_versions, reserved_labels)
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

    if matrix_versions or missing_coordinates or has_unmatched_definitions:
        lines.append("")
    legend_label_width = 1
    if matrix_versions or missing_coordinates:
        legend_label_width = max(
            [len(version_labels[version]) for version in matrix_versions]
            + ([1] if missing_coordinates else [])
        )
    if matrix_versions:
        lines.extend(
            format_version_legend(
                matrix_versions,
                version_labels,
                label_width=legend_label_width,
            )
        )
    if missing_coordinates:
        lines.append(
            f"{'X'.ljust(legend_label_width)} = no version found, run -v for details"
        )
    elif has_unmatched_definitions:
        lines.append(
            "Some expected release definitions did not match; run -v for details."
        )

    return "\n".join(lines)


def missing_matrix_coordinates(
    unmatched: Iterable[UnmatchedReleaseDefinition],
) -> list[MatrixKey]:
    coordinates = []
    seen = set()
    for definition in unmatched:
        for missing in definition.missing:
            if not missing.platform or not missing.python_version:
                continue
            coordinate = (
                missing.sublime_text,
                missing.platform,
                missing.python_version,
            )
            if coordinate in seen:
                continue
            seen.add(coordinate)
            coordinates.append(coordinate)
    return coordinates


def release_matrix(
    releases: list[Release],
    missing_coordinates: Iterable[MatrixKey] = (),
) -> MatrixTables:
    cells_by_sublime_text: dict[StBuild, TableCells] = defaultdict(dict)
    missing_by_sublime_text: dict[StBuild, set[TableKey]] = defaultdict(set)
    for release in releases:
        for sublime_text, platform, python_version in release_coordinates(release):
            cells_by_sublime_text[sublime_text].setdefault(
                (platform, python_version), release["version"]
            )

    for sublime_text, platform, python_version in missing_coordinates:
        missing_by_sublime_text[sublime_text].add((platform, python_version))

    return {
        sublime_text: MatrixTable(
            cells_by_sublime_text[sublime_text],
            frozenset(missing_by_sublime_text[sublime_text]),
        )
        for sublime_text in (
            cells_by_sublime_text.keys() | missing_by_sublime_text.keys()
        )
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
            key = (platform, python_version)
            version = table.cells.get(key)
            value = (
                "X"
                if key in table.missing_cells
                else version_labels[version] if version else "-"
            )
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
    versions: list[str],
    version_labels: dict[str, str],
    *,
    label_width: int | None = None,
) -> list[str]:
    versions = sorted(versions, key=lambda version: version_labels[version])
    if label_width is None:
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


def make_version_labels(
    versions: list[str], reserved: set[str] | None = None
) -> dict[str, str]:
    """
    Create a lookup table from unique literal versions to matrix abbreviations.

    The input order is the matrix display order. Versions in the same
    major-version group reuse the same letter with suffixes:
    A, A', A'', A''', A5...
    """
    label = make_version_labeler(reserved or set())
    return {
        version: label(version)
        for version in versions
    }


def make_version_labeler(
    reserved: set[str] | None = None
) -> Callable[[VersionString], str]:
    reserved = reserved or set()
    labelers = (
        _with_suffixes(prefix)
        for size in count(1)
        for letters in product(string.ascii_uppercase, repeat=size)
        if (prefix := "".join(letters)) not in reserved
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
