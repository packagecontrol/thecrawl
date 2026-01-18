# mypy: ignore-errors
import pytest
from packaging.specifiers import SpecifierSet

from scripts._lib_transformation import (
    ALL_BUILDS,
    SUPPORTED_PLATFORMS,
    SUPPORTED_PYTHON_VERSIONS,
    normalize_release_definition,
)


BASE_STATIC_DEFINITION = {
    "url": "https://example.com/pkg.whl",
    "version": "1.0.0",
}
BASE_UNSATISFIED_DEFINITION = {
    "base": "https://pypi.org/project/example",
}
MISSING = object()


class TestNormalizeReleaseDefinitionStaticReleases:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (MISSING, ALL_BUILDS),
            ("*", "*"),
            ("4117", "4117"),
        ],
    )
    def test_sublime_text(self, value, expected):
        definition = dict(BASE_STATIC_DEFINITION)
        if value is not MISSING:
            definition["sublime_text"] = value

        result = normalize_release_definition(definition)

        assert result["sublime_text"] == expected

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (MISSING, SUPPORTED_PLATFORMS),
            ("*", SUPPORTED_PLATFORMS),
            (["*"], SUPPORTED_PLATFORMS),
            ("windows-x64", ["windows-x64"]),
            (["windows-x64"], ["windows-x64"]),
        ],
    )
    def test_platforms(self, value, expected):
        definition = dict(BASE_STATIC_DEFINITION)
        if value is not MISSING:
            definition["platforms"] = value

        result = normalize_release_definition(definition)

        assert result["platforms"] == expected

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (MISSING, SUPPORTED_PYTHON_VERSIONS),
            ("*", SUPPORTED_PYTHON_VERSIONS),
            (["*"], SUPPORTED_PYTHON_VERSIONS),
            ("3.8", ["3.8"]),
            (["3.8"], ["3.8"]),
        ],
    )
    def test_python_versions(self, value, expected):
        definition = dict(BASE_STATIC_DEFINITION)
        if value is not MISSING:
            definition["python_versions"] = value

        result = normalize_release_definition(definition)

        assert result["python_versions"] == expected

    @pytest.mark.parametrize(
        ("date_value", "sha_value"),
        [
            (MISSING, MISSING),
            ("2024-01-01T00:00:00Z", MISSING),
            (MISSING, "abc123"),
            ("2024-01-01T00:00:00Z", "abc123"),
        ],
    )
    def test_passes_fields(self, date_value, sha_value):
        definition = dict(BASE_STATIC_DEFINITION)
        if date_value is not MISSING:
            definition["date"] = date_value
        if sha_value is not MISSING:
            definition["sha256"] = sha_value

        result = normalize_release_definition(definition)

        assert result["url"] == BASE_STATIC_DEFINITION["url"]
        assert result["version"] == BASE_STATIC_DEFINITION["version"]
        if date_value is MISSING:
            assert "date" not in result
        else:
            assert result["date"] == date_value
        if sha_value is MISSING:
            assert "sha256" not in result
        else:
            assert result["sha256"] == sha_value


class TestNormalizeReleaseDefinitionUnsatisfiedReleases:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("pypi:example", "https://pypi.org/project/example"),
            ("github:octo/repo", "https://github.com/octo/repo"),
        ],
    )
    def test_base_transforms(self, value, expected):
        definition = {
            "base": value,
        }

        result = normalize_release_definition(definition)

        assert result["base"] == expected

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (MISSING, ["*"]),
            ("*", ["*"]),
            (["*"], ["*"]),
            ("4117", ["4117"]),
            (["4117"], ["4117"]),
        ],
    )
    def test_sublime_text(self, value, expected):
        definition = dict(BASE_UNSATISFIED_DEFINITION)
        if value is not MISSING:
            definition["sublime_text"] = value

        result = normalize_release_definition(definition)

        assert result["sublime_text"] == expected

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (MISSING, SUPPORTED_PLATFORMS),
            ("*", SUPPORTED_PLATFORMS),
            (["*"], SUPPORTED_PLATFORMS),
            ("windows-x64", ["windows-x64"]),
            (["windows-x64"], ["windows-x64"]),
        ],
    )
    def test_platforms(self, value, expected):
        definition = dict(BASE_UNSATISFIED_DEFINITION)
        if value is not MISSING:
            definition["platforms"] = value

        result = normalize_release_definition(definition)

        assert result["platforms"] == expected

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (MISSING, SUPPORTED_PYTHON_VERSIONS),
            ("*", SUPPORTED_PYTHON_VERSIONS),
            (["*"], SUPPORTED_PYTHON_VERSIONS),
            ("3.8", ["3.8"]),
            (["3.8"], ["3.8"]),
        ],
    )
    def test_python_versions(self, value, expected):
        definition = dict(BASE_UNSATISFIED_DEFINITION)
        if value is not MISSING:
            definition["python_versions"] = value

        result = normalize_release_definition(definition)

        assert result["python_versions"] == expected

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (MISSING, MISSING),
            ("pkg.whl", ["pkg.whl"]),
            (["pkg.whl"], ["pkg.whl"]),
        ],
    )
    def test_asset(self, value, expected):
        definition = dict(BASE_UNSATISFIED_DEFINITION)
        if value is not MISSING:
            definition["asset"] = value

        result = normalize_release_definition(definition)

        if expected is MISSING:
            assert "asset" not in result
        else:
            assert result["asset"] == expected

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (True, True),
            ("v1.2.3", "v1.2.3"),
        ],
    )
    def test_tags(self, value, expected):
        definition = dict(BASE_UNSATISFIED_DEFINITION)
        definition["tags"] = value

        result = normalize_release_definition(definition)

        assert result["tags"] == expected

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("", ""),
            ("*", ""),
            ("1.2.3", "==1.2.3"),
            (">=1.0", ">=1.0"),
        ],
    )
    def test_version(self, value, expected):
        definition = dict(BASE_UNSATISFIED_DEFINITION)
        definition["version"] = value

        result = normalize_release_definition(definition)

        assert isinstance(result["version"], SpecifierSet)
        assert str(result["version"]) == expected
