import pytest
from packaging.tags import compatible_tags, cpython_tags, parse_tag

from scripts._resolve_lib import (
    SUPPORTED_PYTHON_VERSIONS,
    build_default_asset_patterns,
    normalize_release_def,
    resolve_pypi_releases,
    spell_out_constraint_variations,
)


@pytest.mark.parametrize("python_version", SUPPORTED_PYTHON_VERSIONS)
@pytest.mark.parametrize("platform_tag", ["win_amd64", "win32"])
def test_cpython_tags_match_packaging(python_version, platform_tag):
    major, minor = map(int, python_version.split("."))
    py = f"{major}{minor}"
    expected = [
        str(tag)
        for tag in cpython_tags(
            python_version=(major, minor),
            abis=[f"cp{py}m", f"cp{py}"],
            platforms=[platform_tag],
        )
    ]

    tags = pattern_tags(build_default_asset_patterns([platform_tag], python_version))

    assert [tag for tag in tags if tag.startswith("cp")] == expected


@pytest.mark.parametrize("python_version", SUPPORTED_PYTHON_VERSIONS)
@pytest.mark.parametrize("platform_tag", ["win_amd64", "win32"])
def test_pattern_order_follows_packaging_priority(python_version, platform_tag):
    major, minor = map(int, python_version.split("."))
    py = f"{major}{minor}"
    priority = [
        *cpython_tags(
            python_version=(major, minor),
            abis=[f"cp{py}m", f"cp{py}"],
            platforms=[platform_tag],
        ),
        *compatible_tags(
            python_version=(major, minor),
            interpreter=f"cp{py}",
            platforms=[platform_tag],
        ),
    ]

    tags = pattern_tags(build_default_asset_patterns([platform_tag], python_version))
    # Compressed tag sets like "py2.py3" rank by their best supported tag.
    ranks = [
        min(priority.index(t) for t in parse_tag(tag) if t in priority)
        for tag in tags
    ]

    assert ranks == sorted(ranks)


def test_abi3_goes_down_to_3_2():
    tags = pattern_tags(build_default_asset_patterns(["win32"], "3.3"))

    assert tags == [
        "cp33-cp33m-win32",
        "cp33-cp33-win32",
        "cp33-abi3-win32",
        "cp33-none-win32",
        "cp32-abi3-win32",
        "py3-none-win32",
        "py2.py3-none-win32",
        "py3-none-any",
        "py2.py3-none-any",
    ]


def test_platform_globs_are_kept_per_tag():
    patterns = build_default_asset_patterns(
        ["macosx_*_x86_64", "macosx_*_universal2"], "3.8"
    )

    assert patterns[4:8] == [
        "*-${version}-cp38-abi3-macosx_*_x86_64.whl",
        "*-${version}-cp38-abi3-macosx_*_universal2.whl",
        "*-${version}-cp38-none-macosx_*_x86_64.whl",
        "*-${version}-cp38-none-macosx_*_universal2.whl",
    ]


def test_cp_none_wheel_of_newer_release_wins():
    releases = {
        "0.24.0": [
            wheel("watchfiles-0.24.0-cp38-none-win_amd64.whl"),
            wheel("watchfiles-0.24.0-cp38-cp38-manylinux_2_17_x86_64.whl"),
        ],
        "0.14.1": [wheel("watchfiles-0.14.1-py3-none-win_amd64.whl")],
    }

    info = resolve(releases, platforms="windows-x64", python_versions="3.8")

    assert [r["url"] for r in info] == [url("watchfiles-0.24.0-cp38-none-win_amd64.whl")]


@pytest.mark.parametrize("python_version", ["3.8", "3.14"])
def test_older_abi3_wheel_is_accepted(python_version):
    releases = {
        "0.21.0": [wheel("watchfiles-0.21.0-cp37-abi3-win_amd64.whl")],
        "0.14.1": [wheel("watchfiles-0.14.1-py3-none-win_amd64.whl")],
    }

    info = resolve(releases, platforms="windows-x64", python_versions=python_version)

    assert [r["url"] for r in info] == [url("watchfiles-0.21.0-cp37-abi3-win_amd64.whl")]


def test_newer_abi3_wheel_is_rejected():
    releases = {
        "2.0": [wheel("pkg-2.0-cp39-abi3-win_amd64.whl")],
        "1.0": [wheel("pkg-1.0-py3-none-any.whl")],
    }

    info = resolve(releases, platforms="windows-x64", python_versions="3.8")

    assert [r["version"] for r in info] == ["1.0"]


def test_specific_abi_wins_over_abi3_within_a_release():
    releases = {
        "1.0": [
            wheel("pkg-1.0-cp37-abi3-win_amd64.whl"),
            wheel("pkg-1.0-cp38-none-win_amd64.whl"),
            wheel("pkg-1.0-cp38-cp38-win_amd64.whl"),
        ],
    }

    info = resolve(releases, platforms="windows-x64", python_versions="3.8")

    assert [r["url"] for r in info] == [url("pkg-1.0-cp38-cp38-win_amd64.whl")]


def test_free_threaded_and_pypy_wheels_are_ignored():
    releases = {
        "2.0": [
            wheel("pkg-2.0-cp314-cp314t-win_amd64.whl"),
            wheel("pkg-2.0-cp314t-cp314t-win_amd64.whl"),
            wheel("pkg-2.0-pp311-pypy311_pp73-win_amd64.whl"),
        ],
        "1.0": [wheel("pkg-1.0-cp314-cp314-win_amd64.whl")],
    }

    info = resolve(releases, platforms="windows-x64", python_versions="3.14")

    assert [r["version"] for r in info] == ["1.0"]


def test_py33_accepts_m_abi_and_cp32_abi3():
    releases = {
        "3.0": [wheel("pkg-3.0-cp34-abi3-win32.whl")],
        "2.0": [wheel("pkg-2.0-cp32-abi3-win32.whl")],
        "1.0": [wheel("pkg-1.0-cp33-cp33m-win32.whl")],
    }

    info = resolve(releases, platforms="windows-x32", python_versions="3.3")
    assert [r["version"] for r in info] == ["2.0"]

    del releases["2.0"]
    info = resolve(releases, platforms="windows-x32", python_versions="3.3")
    assert [r["version"] for r in info] == ["1.0"]


def pattern_tags(patterns: list[str]) -> list[str]:
    return [
        pattern.removeprefix("*-${version}-").removesuffix(".whl")
        for pattern in patterns
    ]


def resolve(releases: dict, **definition):
    release = {"base": "https://pypi.org/project/pkg", **definition}
    concrete_defs = spell_out_constraint_variations(
        normalize_release_def(release), auto_assets=True  # type: ignore[arg-type]
    )
    return resolve_pypi_releases(concrete_defs, releases)


def wheel(filename: str) -> dict:
    return {
        "filename": filename,
        "packagetype": "bdist_wheel",
        "url": url(filename),
        "upload_time": "2026-01-01T00:00:00",
        "digests": {"sha256": "0" * 64},
    }


def url(filename: str) -> str:
    return f"https://files.example/{filename}"
