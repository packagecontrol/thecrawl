import pytest

from scripts._doctor_lib import format_library_doctor, make_version_labels


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
                "1.4.0": "A5",
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


def test_doctor_orders_sublime_builds_newest_first_and_labels_globally():
    library = {
        "name": "example",
        "releases": [
            {
                "url": "https://example.test/example-2.2.1.zip",
                "version": "2.2.1",
                "sublime_text": "3154 - 4069",
                "platforms": ["windows-x64"],
                "python_versions": ["3.3"],
            },
            {
                "url": "https://example.test/example-3.7.1.zip",
                "version": "3.7.1",
                "sublime_text": ">=4070",
                "platforms": ["windows-x64"],
                "python_versions": ["3.8"],
            },
        ],
    }

    output = format_library_doctor(
        name="example",
        latest_version="3.7.1",
        sources=["stub"],
        releases=library["releases"],
    )

    assert output.index("Sublime >=4070") < output.index("Sublime 3154 - 4069")
    assert "windows-x64  A" in output
    assert "windows-x64  B" in output
    assert "A = 3.7.1" in output
    assert "B = 2.2.1" in output
