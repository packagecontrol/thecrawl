from __future__ import annotations

from difflib import SequenceMatcher
import json
from typing import Any

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


def print_library_explain(
    name: str,
    rows: list[tuple[dict[str, Any], list[dict[str, Any]]]],
    metadata: dict[str, Any] | None = None,
    console: Console | None = None,
) -> None:
    console = console or Console()

    if metadata is not None:
        console.print(_to_pretty_json(metadata))
        console.print()

    console.rule(f"{name}: input release definitions and normalized variations")

    table = Table(
        box=box.SIMPLE_HEAD,
        expand=True,
        show_header=True,
        show_lines=False,
    )
    table.add_column("#", style="yellow", no_wrap=True)
    table.add_column("Input definition", ratio=1, overflow="fold")
    table.add_column("Normalized variation", ratio=1, overflow="fold")

    if not rows:
        table.add_row("-", "(empty)", "(empty)")
    else:
        for release_no, (left, right_variations) in enumerate(rows, start=1):
            if release_no > 1:
                table.add_row("", "", "")

            if not right_variations:
                table.add_row(str(release_no), _to_pretty_json(left), "(empty)")
                continue

            if len(right_variations) == 1:
                table.add_row(
                    str(release_no),
                    _to_pretty_json(left),
                    _to_pretty_json(right_variations[0]),
                )
                continue

            for variation_no, right in enumerate(right_variations, start=1):
                table.add_row(
                    f"{release_no}-{variation_no}",
                    _to_pretty_json(left) if variation_no == 1 else "",
                    _to_pretty_json(right),
                )

    console.print(table)


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
