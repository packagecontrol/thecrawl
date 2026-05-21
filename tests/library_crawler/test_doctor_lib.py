import pytest

from scripts._doctor_lib import (
    format_library_doctor,
    make_version_labeler,
    make_version_labels,
)


@pytest.mark.parametrize(
    ("versions", "expected"),
    [
        ([], {}),
        (["1.0.0"], {"1.0.0": "A"}),
        (["1.0.0", "2.0.0"], {"1.0.0": "A", "2.0.0": "B"}),
        (
            ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"],
            {
                "1.0.0": "A",
                "1.1.0": "A'",
                "1.2.0": "A''",
                "1.3.0": "A'''",
                "1.4.0": "A4",
            },
        ),
        (
            ["1.0.0", "2.0.0", "1.1.0", "2.1.0"],
            {
                "1.0.0": "A",
                "2.0.0": "B",
                "1.1.0": "A'",
                "2.1.0": "B'",
            },
        ),
        (["dev", "other"], {"dev": "A", "other": "B"}),
    ],
)
def test_make_version_labels(versions, expected):
    assert make_version_labels(versions) == expected


def test_make_version_labeler_reuses_group_labels_with_suffixes():
    label = make_version_labeler()

    assert [label(f"1.{minor}.0") for minor in range(7)] == [
        "A",
        "A'",
        "A''",
        "A'''",
        "A4",
        "A5",
        "A6",
    ]


def test_make_version_labeler_generates_spreadsheet_style_group_labels():
    label = make_version_labeler()

    assert [label(f"{major}.0.0") for major in range(29)] == [
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "G",
        "H",
        "I",
        "J",
        "K",
        "L",
        "M",
        "N",
        "O",
        "P",
        "Q",
        "R",
        "S",
        "T",
        "U",
        "V",
        "W",
        "X",
        "Y",
        "Z",
        "AA",
        "AB",
        "AC",
    ]


def test_doctor_omits_the_all_builds_heading_for_a_single_table():
    releases = [
        {
            "url": "https://example.test/example-1.0.0.zip",
            "version": "1.0.0",
            "sublime_text": "*",
            "platforms": ["linux-x64"],
            "python_versions": ["3.8"],
        },
    ]

    output = format_library_doctor(
        name="example",
        latest_version="1.0.0",
        sources=["stub"],
        releases=releases,
    )

    assert strip_trailing_whitespace(output) == """example release matrix; -v to see the raw JSON output
Source: stub
Latest version: 1.0.0

           py38
linux-x64  A

A = 1.0.0"""


def test_doctor_formats_tables_with_one_global_legend():
    releases = [
        {
            "url": "https://example.test/example-2.2.1.zip",
            "version": "2.2.1",
            "sublime_text": "3154 - 4069",
            "platforms": ["*"],
            "python_versions": ["3.3", "3.8"],
        },
        {
            "url": "https://example.test/example-3.7.2.zip",
            "version": "3.7.2",
            "sublime_text": ">=4070",
            "platforms": ["*"],
            "python_versions": ["3.8", "3.13", "3.14"],
        },
    ]

    output = format_library_doctor(
        name="example",
        latest_version="3.7.2",
        sources=["stub"],
        releases=releases,
    )

    assert strip_trailing_whitespace(output) == """example release matrix; -v to see the raw JSON output
Source: stub
Latest version: 3.7.2


# Sublime >=4070

             py38  py313  py314
windows-x64  A     A      A
windows-x32  A     A      A
osx-x64      A     A      A
osx-arm64    A     A      A
linux-x64    A     A      A
linux-arm64  A     A      A


# Sublime 3154 - 4069

             py33  py38
windows-x64  B     B
windows-x32  B     B
osx-x64      B     B
osx-arm64    B     B
linux-x64    B     B
linux-arm64  B     B

A = 3.7.2
B = 2.2.1"""


def strip_trailing_whitespace(value: str) -> str:
    return "\n".join(line.rstrip() for line in value.splitlines())
