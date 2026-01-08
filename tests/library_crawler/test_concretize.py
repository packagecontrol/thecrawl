from scripts.crawl_libraries import (
    SUPPORTED_PLATFORMS,
    combine_releases,
    concretize_release_def,
    normalize_release_def,
)


def make_concrete(release: dict, auto_assets: bool = True):
    return concretize_release_def(normalize_release_def(release), auto_assets=auto_assets)


def test_concretize_single_manual_release():
    release = {
        "base": "https://pypi.org/project/cffi",
        "asset": "cffi-*-cp${py_version}-cp${py_version}-win_amd64.whl",
        "platforms": "windows-x64",
        "python_versions": "3.13",
    }
    concrete_defs = make_concrete(release, auto_assets=True)

    assert len(concrete_defs) == 1
    concrete = concrete_defs[0]
    assert concrete.base == release["base"]
    assert concrete.asset_patterns == [release["asset"]]
    assert concrete.platform == "windows-x64"
    assert concrete.python_version == "3.13"
    assert concrete.sublime_text == "*"
    assert concrete.version == ""


def test_concretize_matrix_expansion():
    release = {
        "base": "https://pypi.org/project/watchdog",
        "asset": "watchdog-*-py3-none-win32.whl",
        "platforms": ["windows-x32", "linux-x64"],
        "python_versions": ["3.8", "3.13"],
        "sublime_text": ["3154 - 4069", ">=4070"],
        "version": "5.*",
    }
    concrete_defs = make_concrete(release, auto_assets=True)

    assert len(concrete_defs) == 8
    assert {item.version for item in concrete_defs} == {"==5.*"}
    assert {item.platform for item in concrete_defs} == {"windows-x32", "linux-x64"}
    assert {item.python_version for item in concrete_defs} == {"3.8", "3.13"}
    assert {item.sublime_text for item in concrete_defs} == {"3154 - 4069", ">=4070"}


def test_concretize_auto_assets_by_platform():
    release = {
        "base": "https://pypi.org/project/orjson",
        "platforms": ["windows-x64", "linux-x64"],
        "python_versions": "3.13",
    }
    concrete_defs = make_concrete(release, auto_assets=True)

    assert len(concrete_defs) == 2
    patterns_by_platform = {item.platform: item.asset_patterns for item in concrete_defs}

    assert any("win_amd64" in pat for pat in patterns_by_platform["windows-x64"])
    assert any(
        "manylinux*_x86_64" in pat for pat in patterns_by_platform["linux-x64"]
    )


def test_combine_releases_by_url_and_sublime_text():
    releases = [
        {
            "url": "https://example.com/pkg.whl",
            "version": "1.0",
            "date": "2026-01-01T00:00:00Z",
            "sha256": "abc",
            "platforms": ["windows-x64"],
            "python_versions": ["3.8"],
            "sublime_text": "*",
        },
        {
            "url": "https://example.com/pkg.whl",
            "version": "1.0",
            "date": "2026-01-01T00:00:00Z",
            "sha256": "abc",
            "platforms": ["linux-x64"],
            "python_versions": ["3.13"],
            "sublime_text": "*",
        },
        {
            "url": "https://example.com/pkg.whl",
            "version": "1.0",
            "date": "2026-01-01T00:00:00Z",
            "sha256": "abc",
            "platforms": ["osx-x64"],
            "python_versions": ["3.8"],
            "sublime_text": ">=4070",
        },
        {
            "url": "https://example.com/other.whl",
            "version": "2.0",
            "date": "2026-01-02T00:00:00Z",
            "sha256": "def",
            "platforms": ["windows-x64"],
            "python_versions": ["3.8"],
            "sublime_text": "*",
        },
    ]
    combined = combine_releases(releases)

    merged = next(
        item
        for item in combined
        if item["url"] == "https://example.com/pkg.whl"
        and item["sublime_text"] == "*"
    )
    assert set(merged["platforms"]) == {"windows-x64", "linux-x64"}
    assert set(merged["python_versions"]) == {"3.8", "3.13"}

    st_split = next(
        item
        for item in combined
        if item["url"] == "https://example.com/pkg.whl"
        and item["sublime_text"] == ">=4070"
    )
    assert set(st_split["platforms"]) == {"osx-x64"}


def test_combine_releases_all_platforms_to_star():
    releases = [
        {
            "url": "https://example.com/all.whl",
            "version": "1.0",
            "date": "2026-01-01T00:00:00Z",
            "sha256": "abc",
            "platforms": [platform],
            "python_versions": ["3.8"],
            "sublime_text": "*",
        }
        for platform in SUPPORTED_PLATFORMS
    ]
    combined = combine_releases(releases)

    assert len(combined) == 1
    assert combined[0]["platforms"] == ["*"]
