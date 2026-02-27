import pytest

from scripts.crawl import normalize_limit_argv, parse_args


def test_normalize_limit_argv_rewrites_numeric_shorthand() -> None:
    assert normalize_limit_argv(["--presto", "-1000", "--name", "Example"]) == [
        "--presto",
        "--limit",
        "1000",
        "--name",
        "Example",
    ]


def test_parse_args_accepts_numeric_shorthand_limit() -> None:
    args = parse_args(["-1000"])

    assert args.limit == 1000


def test_parse_args_still_accepts_explicit_limit() -> None:
    args = parse_args(["--limit", "75"])

    assert args.limit == 75


def test_parse_args_rejects_duplicate_limit_flags() -> None:
    with pytest.raises(SystemExit):
        parse_args(["-n", "100", "-n", "75"])



def test_parse_args_rejects_shorthand_plus_limit_flag() -> None:
    with pytest.raises(SystemExit):
        parse_args(["-100", "--limit", "24"])
