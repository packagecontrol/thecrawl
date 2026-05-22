from __future__ import annotations

from copy import deepcopy
from difflib import SequenceMatcher
import json
from typing import Any, Literal

from ._utils import parse_sublime_text_max

from rich import box
from rich.console import Console
from rich.table import Table
from rich.text import Text


ADDED_STYLE = "yellow on black"
REMOVED_STYLE = "red on black"


def print_package_explain(
    name: str,
    original: dict[str, Any],
    normalized: dict[str, Any],
    console: Console | None = None,
) -> None:
    console = console or Console()
    console.print()
    console.rule("Left: registry entry | Right: normalized entry")

    _render_json_diff_table(
        title="",
        left_obj=original,
        right_obj=normalized,
        console=console,
    )


def print_package_explain_effective(name: str, normalized: dict[str, Any]) -> None:
    releases = normalized.get("releases", [])
    sorted_releases = sorted_release_definitions(releases)
    tags_mode = classify_tags_mode(sorted_releases)

    normalized_effective = deepcopy(normalized)
    normalized_effective["releases"] = keep_newest_release_definitions(sorted_releases)

    if tags_mode:
        effectively = "(effectively) " if tags_mode == "effective" else ""
        print(f"{name} uses {effectively}the tags-mode.")
    print(json.dumps(normalized_effective, ensure_ascii=False, sort_keys=True))


def classify_tags_mode(
    sorted_releases: list[dict[str, Any]],
) -> bool | Literal["effective"]:
    if not sorted_releases:
        return False

    if all(release_uses_tags_mode(release) for release in sorted_releases):
        return True

    if release_uses_tags_mode(sorted_releases[-1]):
        return "effective"

    return False


def sorted_release_definitions(releases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(releases, key=release_definition_sort_key)


def keep_newest_release_definitions(
    releases: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not releases:
        return []

    newest_build = parse_sublime_text_max(releases[-1].get("sublime_text"))
    return [
        release
        for release in releases
        if parse_sublime_text_max(release.get("sublime_text")) == newest_build
    ]


def release_definition_sort_key(release: dict[str, Any]) -> tuple[float, str]:
    return (
        parse_sublime_text_max(release.get("sublime_text")),
        _tags_sort_value(release.get("tags")),
    )


def release_uses_tags_mode(release: dict[str, Any]) -> bool:
    return bool(release.get("tags", False))


def print_library_explain(
    name: str,
    rows: list[tuple[dict[str, Any], list[dict[str, Any]]]],
    metadata: dict[str, Any] | None = None,
    console: Console | None = None,
) -> None:
    console = console or Console()

    if metadata is not None:
        console.print(_to_pretty_json(metadata), soft_wrap=True)
        console.print()

    console.print(_library_explain_table(rows))


def _library_explain_table(
    rows: list[tuple[dict[str, Any], list[dict[str, Any]]]],
) -> Table:
    table = Table(
        box=box.SIMPLE_HEAD,
        expand=False,
        show_edge=False,
        show_header=True,
        show_lines=False,
        padding=(0, 1),
        pad_edge=False,
    )
    table.add_column("#", style="yellow", no_wrap=True, justify="right")
    table.add_column("Input definition", min_width=30, overflow="fold")
    table.add_column("Normalized variation", overflow="fold")

    for entry_no, (label, left_lines, right_lines) in enumerate(
        _library_explain_entries(rows)
    ):
        if entry_no:
            table.add_row("", "", "")
        table.add_row(label, "\n".join(left_lines), "\n".join(right_lines))

    return table


def _library_explain_entries(
    rows: list[tuple[dict[str, Any], list[dict[str, Any]]]],
) -> list[tuple[str, list[str], list[str]]]:
    if not rows:
        return [("-", ["(empty)"], ["(empty)"])]

    entries: list[tuple[str, list[str], list[str]]] = []
    for release_no, (left, right_variations) in enumerate(rows, start=1):
        if not right_variations:
            entries.append((str(release_no), _to_json_lines(left), ["(empty)"]))
            continue

        if len(right_variations) == 1:
            entries.append((
                str(release_no),
                _to_json_lines(left),
                _to_json_lines(right_variations[0]),
            ))
            continue

        for variation_no, right in enumerate(right_variations, start=1):
            entries.append((
                f"{release_no}-{variation_no}",
                _to_json_lines(left) if variation_no == 1 else [],
                _to_json_lines(right),
            ))

    return entries


def _tags_sort_value(value: Any) -> str:
    # Place plain `True` after common prefixes like `st2-`.
    if value is True:
        return "~~true"
    if isinstance(value, str):
        return value
    return ""


def _render_json_diff_table(
    title: str,
    left_obj: dict[str, Any] | list[Any],
    right_obj: dict[str, Any] | list[Any],
    console: Console,
) -> None:
    table = Table(
        title=title,
        box=box.SIMPLE_HEAD,
        expand=True,
        show_header=False,
        show_lines=False,
    )

    for left_line, right_line in _side_by_side_json_diff_rows(left_obj, right_obj):
        table.add_row(left_line, right_line)

    console.print(table)


def _side_by_side_json_diff_rows(
    left_obj: dict[str, Any] | list[Any],
    right_obj: dict[str, Any] | list[Any],
) -> list[tuple[Text, Text]]:
    left_line: str | None
    right_line: str | None
    left_lines = _to_json_lines(left_obj)
    right_lines = _to_json_lines(right_obj)

    rows: list[tuple[Text, Text]] = []
    matcher = SequenceMatcher(a=left_lines, b=right_lines)

    left_no = 1
    right_no = 1
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for left_line, right_line in zip(left_lines[i1:i2], right_lines[j1:j2], strict=True):
                rows.append((
                    _make_line(left_no, "  ", left_line),
                    _make_line(right_no, "  ", right_line),
                ))
                left_no += 1
                right_no += 1
            continue

        if tag == "replace":
            left_chunk = left_lines[i1:i2]
            right_chunk = right_lines[j1:j2]
            for idx in range(max(len(left_chunk), len(right_chunk))):
                left_line = left_chunk[idx] if idx < len(left_chunk) else None
                right_line = right_chunk[idx] if idx < len(right_chunk) else None
                left_text = (
                    _make_line(left_no, "- ", left_line, REMOVED_STYLE)
                    if left_line is not None
                    else Text("")
                )
                right_text = (
                    _make_line(right_no, "+ ", right_line, ADDED_STYLE)
                    if right_line is not None
                    else Text("")
                )
                rows.append((left_text, right_text))
                if left_line is not None:
                    left_no += 1
                if right_line is not None:
                    right_no += 1
            continue

        if tag == "delete":
            for left_line in left_lines[i1:i2]:
                rows.append((
                    _make_line(left_no, "- ", left_line, REMOVED_STYLE),
                    Text(""),
                ))
                left_no += 1
            continue

        if tag == "insert":
            for right_line in right_lines[j1:j2]:
                rows.append((
                    Text(""),
                    _make_line(right_no, "+ ", right_line, ADDED_STYLE),
                ))
                right_no += 1

    if not rows:
        rows.append((Text("(empty)"), Text("(empty)")))
    return rows


def _make_line(number: int, marker: str, content: str, style: str = "") -> Text:
    line = Text()
    line.append(f"{number:>4} ", style="dim")
    line.append(marker, style=style)
    line.append(content, style=style)
    return line


def _to_pretty_json(obj: dict[str, Any] | list[Any]) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=True)


def _to_json_lines(obj: dict[str, Any] | list[Any]) -> list[str]:
    return _to_pretty_json(obj).splitlines()
