import aiohttp
import pytest

import scripts._resolve_lib as resolve_lib


@pytest.mark.asyncio
async def test_static_release_passes_through_sha256(tmp_path):
    library = {
        "name": "ssl-linux",
        "description": "Python _ssl module for Linux",
        "author": "wbond",
        "issues": "https://github.com/codexns/sublime-ssl-linux/issues",
        "releases": [
            {
                "version": "1.0.0",
                "url": "http://packagecontrol.io/ssl-linux.sublime-package",
                "platforms": ["linux"],
                "date": "2026-01-01T00:00:00Z",
                "sha256": "d12a2ca2843b3c06a834652e9827a29f88872bb31bd64230775f3dbe12e0ebd4",
            }
        ],
    }

    async with aiohttp.ClientSession() as session:
        info, sources = await resolve_lib.resolve_library(
            library, tmp_path / "cache", session
        )

    assert sources == []
    assert info["name"] == "ssl-linux"
    assert info["description"] == "Python _ssl module for Linux"
    assert info["author"] == "wbond"
    assert info["issues"] == "https://github.com/codexns/sublime-ssl-linux/issues"
    assert len(info["releases"]) == 1
    release = info["releases"][0]
    assert release["version"] == "1.0.0"
    assert release["url"] == "http://packagecontrol.io/ssl-linux.sublime-package"
    assert release["platforms"] == ["linux"]
    assert release["date"] == "2026-01-01T00:00:00Z"
    assert release["sha256"] == "d12a2ca2843b3c06a834652e9827a29f88872bb31bd64230775f3dbe12e0ebd4"
    assert release["sublime_text"] == "*"
    assert set(release["python_versions"]) == set(resolve_lib.SUPPORTED_PYTHON_VERSIONS)


@pytest.mark.asyncio
async def test_static_release_passes_through_python_versions(tmp_path):
    library = {
        "name": "coverage",
        "author": "nedbatchelder",
        "description": "coverage.py - http://coverage.readthedocs.org/en/latest/",
        "homepage": "https://pypi.org/project/coverage/",
        "issues": "https://github.com/nedbat/coveragepy/issues",
        "releases": [
            {
                "platforms": ["windows-x64"],
                "python_versions": ["3.8"],
                "version": "7.3.2",
                "date": "2026-01-01T00:00:00Z",
                "url": (
                    "https://files.pythonhosted.org/packages/9f/95/"
                    "436887935a32fcead76c9f60b61f3fcd8940d4129bdbc50e2988e037a664/"
                    "coverage-7.3.2-cp38-cp38-win_amd64.whl"
                ),
            }
        ],
    }

    async with aiohttp.ClientSession() as session:
        info, sources = await resolve_lib.resolve_library(
            library, tmp_path / "cache", session
        )

    assert sources == []
    assert info["name"] == "coverage"
    assert info["author"] == "nedbatchelder"
    assert info["description"] == "coverage.py - http://coverage.readthedocs.org/en/latest/"
    assert info["issues"] == "https://github.com/nedbat/coveragepy/issues"
    assert len(info["releases"]) == 1
    release = info["releases"][0]
    assert release["platforms"] == ["windows-x64"]
    assert release["python_versions"] == ["3.8"]
    assert release["version"] == "7.3.2"
    assert release["date"] == "2026-01-01T00:00:00Z"
    assert release["sublime_text"] == "*"
    assert release["url"] == (
        "https://files.pythonhosted.org/packages/9f/95/"
        "436887935a32fcead76c9f60b61f3fcd8940d4129bdbc50e2988e037a664/"
        "coverage-7.3.2-cp38-cp38-win_amd64.whl"
    )


@pytest.mark.asyncio
async def test_static_release_copies_extra_fields(tmp_path):
    library = {
        "name": "extra-fields",
        "author": "Example Author",
        "description": "Has extra metadata.",
        "homepage": "https://example.com/extra-fields",
        "issues": "https://example.com/extra-fields/issues",
        "labels": ["featured", "stable"],
        "funding": {"type": "github", "url": "https://example.com/funding"},
        "releases": [
            {
                "platforms": ["linux-x64"],
                "version": "1.0.0",
                "date": "2026-01-01T00:00:00Z",
                "url": "https://example.com/extra-fields-1.0.0.whl",
            }
        ],
    }

    async with aiohttp.ClientSession() as session:
        info, sources = await resolve_lib.resolve_library(
            library, tmp_path / "cache", session
        )

    assert sources == []
    assert info["homepage"] == "https://example.com/extra-fields"
    assert info["labels"] == ["featured", "stable"]
    assert info["funding"] == {"type": "github", "url": "https://example.com/funding"}


def test_static_release_requires_version():
    with pytest.raises(ValueError, match="must include a version"):
        resolve_lib.validate_release_def({
            "url": "https://example.com/pkg.whl",
            "platforms": ["windows-x64"],
        })


def test_static_http_release_requires_sha256():
    with pytest.raises(ValueError, match="sha256"):
        resolve_lib.validate_release_def({
            "url": "http://example.com/pkg.whl",
            "version": "1.2.3",
        })


def test_static_https_release_allows_no_sha256():
    resolve_lib.validate_release_def({
        "url": "https://example.com/pkg.whl",
        "version": "1.2.3",
        "date": "2026-01-01T00:00:00Z",
    })
