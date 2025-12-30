import pytest
from scripts.utils import parse_version, VersionInfo, is_semver, normalize_tz_aware_datetime


@pytest.mark.parametrize("input_str,expected", [
    ("1.2.3", VersionInfo(1, 2, 3, None, None)),
    ("0.0.1", VersionInfo(0, 0, 1, None, None)),
    ("10.20.30-alpha", VersionInfo(10, 20, 30, "alpha", None)),
    ("2.7.15+build.42", VersionInfo(2, 7, 15, None, "build.42")),
    ("3.4.5-beta.1+exp.sha.5114f85", VersionInfo(3, 4, 5, "beta.1", "exp.sha.5114f85")),
    ("1.0.0-rc.1+build.1", VersionInfo(1, 0, 0, "rc.1", "build.1")),
])
def test_parse_version_valid(input_str, expected):
    assert parse_version(input_str) == expected


@pytest.mark.parametrize("input_str", [
    "",
    "1.2",
    "1.2.3.4",
    "v1.2.3",
    "1.2.3-",
    "1.2.3+",
    "1.2.3-+build",
])
def test_parse_version_invalid(input_str):
    assert parse_version(input_str) is None


@pytest.mark.parametrize("input_str,expected", [
    ("1.2.3", True),
    ("0.0.1", True),
    ("10.20.30-alpha", True),
    ("2.7.15+build.42", True),
    ("3.4.5-beta.1+exp.sha.5114f85", True),
    ("1.0.0-rc.1+build.1", True),
    ("", False),
    ("1.2", False),
    ("1.2.3.4", False),
    ("v1.2.3", False),
    ("1.2.3-", False),
    ("1.2.3+", False),
    ("1.2.3-+build", False),
])
def test_is_semver(input_str, expected):
    assert is_semver(input_str) == expected


@pytest.mark.parametrize("input_str,expected", [
    ("1.2.3", True),
    ("1.2.3-alpha", False),
    ("1.2.3+build.1", False),
    ("1.2.3-alpha+build.1", False),
])
def test_version_is_final(input_str, expected):
    v = parse_version(input_str)
    assert v is not None
    assert v.is_final is expected


@pytest.mark.parametrize("input_str,expected", [
    ("1.2.3", False),
    ("1.2.3-alpha", True),
    ("1.2.3+build.1", False),
    ("1.2.3-alpha+build.1", True),
])
def test_version_is_a_prerelease(input_str, expected):
    v = parse_version(input_str)
    assert v is not None
    assert v.is_prerelease is expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2024-03-22T00:13:15+01:00", "2024-03-21T23:13:15Z"),
        ("2025-09-24T22:24:31+02:00", "2025-09-24T20:24:31Z"),
        ("2025-09-22T23:07:52+02:00", "2025-09-22T21:07:52Z"),
    ],
)
def test_normalize_tz_aware_datetime(value, expected):
    assert normalize_tz_aware_datetime(value) == expected
