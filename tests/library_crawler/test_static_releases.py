import aiohttp
import pytest

import scripts.crawl_libraries as crawl_libraries


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
                "sha256": "d12a2ca2843b3c06a834652e9827a29f88872bb31bd64230775f3dbe12e0ebd4",
            }
        ],
    }

    async with aiohttp.ClientSession() as session:
        info, sources = await crawl_libraries.resolve_library(
            library, tmp_path / "cache", session
        )

    assert sources == []
    assert info["name"] == "ssl-linux"
    assert info["description"] == "Python _ssl module for Linux"
    assert info["author"] == "wbond"
    assert info["issues"] == "https://github.com/codexns/sublime-ssl-linux/issues"
    assert info["releases"] == [
        {
            "version": "1.0.0",
            "url": "http://packagecontrol.io/ssl-linux.sublime-package",
            "platforms": ["linux"],
            "sha256": "d12a2ca2843b3c06a834652e9827a29f88872bb31bd64230775f3dbe12e0ebd4",
        }
    ]


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
                "url": (
                    "https://files.pythonhosted.org/packages/9f/95/"
                    "436887935a32fcead76c9f60b61f3fcd8940d4129bdbc50e2988e037a664/"
                    "coverage-7.3.2-cp38-cp38-win_amd64.whl"
                ),
            }
        ],
    }

    async with aiohttp.ClientSession() as session:
        info, sources = await crawl_libraries.resolve_library(
            library, tmp_path / "cache", session
        )

    assert sources == []
    assert info["name"] == "coverage"
    assert info["author"] == "nedbatchelder"
    assert info["description"] == "coverage.py - http://coverage.readthedocs.org/en/latest/"
    assert info["issues"] == "https://github.com/nedbat/coveragepy/issues"
    assert info["releases"] == [
        {
            "platforms": ["windows-x64"],
            "python_versions": ["3.8"],
            "version": "7.3.2",
            "url": (
                "https://files.pythonhosted.org/packages/9f/95/"
                "436887935a32fcead76c9f60b61f3fcd8940d4129bdbc50e2988e037a664/"
                "coverage-7.3.2-cp38-cp38-win_amd64.whl"
            ),
        }
    ]


def test_static_release_requires_version():
    with pytest.raises(ValueError, match="must include a version"):
        crawl_libraries.validate_release_def({
            "url": "https://example.com/pkg.whl",
            "platforms": ["windows-x64"],
        })


def test_static_http_release_requires_sha256():
    with pytest.raises(ValueError, match="sha256"):
        crawl_libraries.validate_release_def({
            "url": "http://example.com/pkg.whl",
            "version": "1.2.3",
        })


def test_static_https_release_allows_no_sha256():
    crawl_libraries.validate_release_def({
        "url": "https://example.com/pkg.whl",
        "version": "1.2.3",
    })
