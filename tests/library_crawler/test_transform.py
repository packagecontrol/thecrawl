import pytest
from packaging.specifiers import SpecifierSet

from scripts._resolve_lib import (
    ALL_BUILDS,
    SUPPORTED_PLATFORMS,
    SUPPORTED_PYTHON_VERSIONS,
    normalize_release_def,
    validate_normalized_release_def
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

        result = normalize_release_def(definition)

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

        result = normalize_release_def(definition)

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

        result = normalize_release_def(definition)

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

        result = normalize_release_def(definition)

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

        result = normalize_release_def(definition)

        assert result["base"] == expected

    def test_base_versioned_pypi_url_sets_version(self):
        definition = {
            "base": "https://pypi.org/project/Markdown/3.2.2",
        }

        result = normalize_release_def(definition)

        assert result["base"] == "https://pypi.org/project/Markdown"
        assert result["version"] == "==3.2.2"

    def test_base_versioned_pypi_url_rejects_version_field(self):
        definition = {
            "base": "https://pypi.org/project/Markdown/3.2.2",
            "version": ">=3",
        }

        with pytest.raises(ValueError, match="versioned URL"):
            normalize_release_def(definition)

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

        result = normalize_release_def(definition)

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

        result = normalize_release_def(definition)

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

        result = normalize_release_def(definition)

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

        result = normalize_release_def(definition)

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

        result = normalize_release_def(definition)

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

        result = normalize_release_def(definition)

        assert str(result["version"]) == expected


class TestValidateNormalizedReleaseDef:
    def test_rejects_unknown_platform_for_pypi_default_assets(self):
        with pytest.raises(
            ValueError, match="Can't provide default assets for platform: not-a-platform"
        ):
            validate_normalized_release_def(
                {
                    "base": "https://pypi.org/project/example",
                    "platforms": ["not-a-platform"],
                }
            )
