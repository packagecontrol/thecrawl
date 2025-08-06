import pytest
from scripts.utils import parse_version, VersionInfo, is_semver


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
