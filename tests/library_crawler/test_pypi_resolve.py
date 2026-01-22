# mypy: ignore-errors
import aiohttp
import json
from pathlib import Path
import pytest

import scripts._resolve_lib as resolve_lib
from scripts._resolve_lib import (
    spell_out_constraint_variations,
    download_info_from_latest_versions,
    normalize_release_def,
)

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def resolve_latest(release: dict, fixture: str):
    return download_info_from_latest_versions(
        make_concrete(release), load_releases(fixture)
    )


def make_concrete(release: dict, auto_assets: bool = True):
    return spell_out_constraint_variations(normalize_release_def(release), auto_assets=auto_assets)


def load_releases(name: str):
    return json.loads((FIXTURES_DIR / f"{name}.json").read_text())["releases"]


def test_pypi_latest_cp313_picks_6_0_2():
    release = {
        "base": "https://pypi.org/project/lxml",
        "platforms": "windows-x64",
        "python_versions": "3.13",
    }
    info = resolve_latest(release, "lxml")

    assert len(info) == 1
    assert info[0]["version"] == "6.0.2"
    assert info[0]["url"].endswith("lxml-6.0.2-cp313-cp313-win_amd64.whl")


def test_pypi_versioned_url():
    release = {
        "base": "https://pypi.org/project/lxml/4.2.1",
        "platforms": "osx-x64",
        "python_versions": "3.3",
    }
    info = resolve_latest(release, "lxml")

    assert len(info) == 1
    assert info[0]["version"] == "4.2.1"
    assert info[0]["url"].endswith(
        "lxml-4.2.1-cp33-cp33m-macosx_10_6_x86_64.macosx_10_9_intel.macosx_10_9_x86_64.macosx_10_10_intel.macosx_10_10_x86_64.whl"
    )


def test_pypi_cp33_windows_latest():
    release = {
        "base": "https://pypi.org/project/lxml",
        "platforms": "windows-x64",
        "python_versions": "3.3",
    }
    info = resolve_latest(release, "lxml")

    assert len(info) == 1
    assert info[0]["version"] == "4.2.6"
    assert info[0]["url"].endswith("lxml-4.2.6-cp33-cp33m-win_amd64.whl")


def test_pypi_version_spec_exact_pin():
    release = {
        "base": "https://pypi.org/project/lxml",
        "platforms": ["osx-x64", "windows-x64"],
        "python_versions": "3.3",
        "version": "4.2.1",
    }
    info = resolve_latest(release, "lxml")
    by_platform = {item["platforms"][0]: item for item in info}

    assert len(info) == 2
    assert set(by_platform) == {"osx-x64", "windows-x64"}
    assert all(item["version"] == "4.2.1" for item in by_platform.values())


def test_pypi_version_spec_wildcard():
    release = {
        "base": "https://pypi.org/project/lxml",
        "platforms": ["osx-x64", "windows-x64"],
        "python_versions": "3.3",
        "version": "4.2.*",
    }
    info = resolve_latest(release, "lxml")
    by_platform = {item["platforms"][0]: item for item in info}

    assert len(info) == 2
    assert by_platform["osx-x64"]["version"] == "4.2.1"
    assert by_platform["windows-x64"]["version"] == "4.2.6"


def test_pypi_backrefs_post_release_py38():
    release = {
        "base": "https://pypi.org/project/backrefs",
        "asset": "backrefs-*-py${py_version}-none-any.whl",
        "platforms": "windows-x64",
        "python_versions": "3.8",
    }
    info = resolve_latest(release, "backrefs")

    assert len(info) == 1
    assert info[0]["version"] == "5.7.post1"
    assert info[0]["url"].endswith("backrefs-5.7.post1-py38-none-any.whl")


class FetchCalled(Exception):
    pass


@pytest.mark.asyncio
async def test_resolve_library_pypi_base_name(monkeypatch, tmp_path):
    async def fake_fetch_pypi_json(name, cache_dir, aio_session, ttl_seconds=0):
        assert name == "Markdown"
        raise FetchCalled

    monkeypatch.setattr(resolve_lib, "fetch_pypi_json", fake_fetch_pypi_json)
    library = {
        "name": "Markdown",
        "releases": [
            {
                "base": "https://pypi.org/project/Markdown",
            }
        ],
    }

    session = object()
    with pytest.raises(FetchCalled):
        await resolve_lib.resolve_library(library, tmp_path / "cache", session)


@pytest.mark.asyncio
async def test_resolve_library_pypi_base_name_rejects_empty(tmp_path):
    library = {
        "name": "EmptyBase",
        "releases": [
            {
                "base": "https://pypi.org/project/",
            }
        ],
    }

    session = object()
    with pytest.raises(ValueError, match="Invalid PyPI base URL"):
        await resolve_lib.resolve_library(library, tmp_path / "cache", session)
