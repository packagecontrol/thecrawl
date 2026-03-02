import argparse
from datetime import datetime
from pathlib import Path
import sys

from scripts.snapshot_test import (
    ShootContext,
    load_snapshot_packages,
    move_selection,
    normalize_argv,
    ordinal,
    parse_args,
    print_snapshot_diff,
    resolve_auto_output_path,
    run_diff,
    run_step,
)


def test_normalize_argv_keeps_empty_argv_unchanged() -> None:
    assert normalize_argv([]) == []


def test_parse_args_treats_positional_as_shoot_filename() -> None:
    args = parse_args(["snapshot-next.yml"])

    assert args.command == "shoot"
    assert args.filename == "snapshot-next.yml"


def test_parse_args_treats_options_without_command_as_auto() -> None:
    args = parse_args(["--base", "snapshot.yml"])

    assert args.command == "auto"
    assert args.base == "snapshot.yml"


def test_resolve_auto_output_path_appends_yml_extension_for_new_snapshot(
    tmp_path: Path,
) -> None:
    ctx = ShootContext(
        now=datetime(2026, 3, 2, 12, 53),
        commit_hash="abc1234",
        commit_subject="subject",
    )
    base_path = tmp_path / "snapshot.yml"
    base_path.write_text("base", encoding="utf-8")

    output = resolve_auto_output_path(base_path, None, ctx)

    assert output.name == "snapshot-2026-03-02-1253-abc1234.yml"


def test_load_snapshot_packages_from_toml(tmp_path: Path) -> None:
    config = tmp_path / "snapshot.toml"
    config.write_text(
        "[snapshot]\n"
        "packages = [\"foo\", \"bar\"]\n",
        encoding="utf-8",
    )

    assert load_snapshot_packages(config) == ["foo", "bar"]


def test_load_snapshot_packages_rejects_non_toml_config(tmp_path: Path) -> None:
    config = tmp_path / "snapshot.toml"
    config.write_text(
        "[snapshot]\n"
        "packages =\n"
        "  foo\n"
        "  bar\n",
        encoding="utf-8",
    )

    try:
        load_snapshot_packages(config)
    except ValueError as exc:
        assert "Invalid TOML" in str(exc)
    else:
        raise AssertionError("Expected ValueError for invalid TOML")


def test_run_step_writes_stdout_and_stderr_to_log(tmp_path: Path) -> None:
    log_path = tmp_path / "snapshot.log"
    with log_path.open("w", encoding="utf-8") as log_file:
        run_step(
            [
                sys.executable,
                "-c",
                "import sys; print('hello out'); print('hello err', file=sys.stderr)",
            ],
            log_file,
        )

    text = log_path.read_text(encoding="utf-8")
    assert "hello out" in text
    assert "hello err" in text


def test_print_snapshot_diff_hides_unified_file_headers(
    tmp_path: Path,
    capsys,
) -> None:
    left = tmp_path / "left.yml"
    right = tmp_path / "right.yml"
    left.write_text("date: one\nvalue: old\n", encoding="utf-8")
    right.write_text("date: one\nvalue: new\n", encoding="utf-8")

    print_snapshot_diff(left, right)
    lines = capsys.readouterr().out.splitlines()

    assert not any(line.startswith("--- ") for line in lines)
    assert not any(line.startswith("+++ ") for line in lines)
    assert any(line.startswith("@@") for line in lines)


def test_run_diff_with_single_candidate_without_files_shows_diff(
    tmp_path: Path,
    monkeypatch,
    capsys,
) -> None:
    base = tmp_path / "snapshot.yml"
    candidate = tmp_path / "snapshot-2026-03-02-1253-abc1234.yml"
    base.write_text("value: old\n", encoding="utf-8")
    candidate.write_text("value: new\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    result = run_diff(argparse.Namespace(files=[], base=str(base)))

    out = capsys.readouterr().out
    assert result == 0
    assert "Comparing" in out
    assert candidate.name in out
    assert "@@" in out


def test_move_selection_wraps_for_up_and_down() -> None:
    assert move_selection(0, 3, "up") == 2
    assert move_selection(2, 3, "down") == 0


def test_move_selection_ignores_unknown_keys() -> None:
    assert move_selection(1, 3, "x") == 1


def test_ordinal_suffixes() -> None:
    assert ordinal(1) == "1st"
    assert ordinal(2) == "2nd"
    assert ordinal(3) == "3rd"
    assert ordinal(4) == "4th"
    assert ordinal(11) == "11th"
    assert ordinal(23) == "23rd"
