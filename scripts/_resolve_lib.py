from __future__ import annotations

import asyncio
import json
import os
import re
import time
from collections import defaultdict
from dataclasses import dataclass
from itertools import product
from pathlib import Path
from typing import NotRequired, Required, TypedDict

import aiohttp
from packaging.specifiers import SpecifierSet
from packaging.version import InvalidVersion, Version

from .github import fetch_github_info, ReleaseAssetInfo, RepoMetadata
from .utils import drop_falsy


PYPI_BASE = "https://pypi.org/pypi/{}/json"
CACHE_TTL_SECONDS = 600
PYPI_META_LOCK = asyncio.Lock()
PYPI_DATA_CACHE: dict[str, tuple[dict, str]] = {}


type Name = str
type Url = str
type IsoTimestamp = str


class RegistryEntry(TypedDict, total=False):
    name: Required[str]
    releases: Required[list[ReleaseDef]]
    ...


class NormalizedRegistryEntry(TypedDict, total=False):
    name: Required[str]
    releases: Required[list[NormalizedReleaseDef]]
    ...


type ReleaseDef = dict
type NormalizedReleaseDef = dict

type VersionString = str
type AssetPattern = str
type AssetPatterns = list[AssetPattern]
type IncludeMetadata = bool


@dataclass(frozen=True, slots=True)
class ConcreteReleaseDef:
    base: Url
    asset_patterns: AssetPatterns
    platform: str
    python_version: str
    sublime_text: str
    version: SpecifierSet


class ResolvedLibraryInfo(TypedDict, total=False):
    name: Required[str]
    author: Required[str]
    releases: Required[list[ReleaseInfo]]

    description: str
    homepage: Url
    issues: Url
    ...


class ReleaseConstraints(TypedDict):
    sublime_text: str
    platforms: list[str]
    python_versions: list[str]


class ReleaseInfo(TypedDict, total=False):
    sublime_text: str
    platforms: list[str]
    python_versions: list[str]
    url: str
    version: str
    date: IsoTimestamp
    sha256: NotRequired[str]


type SourceInfo = str  # Labels like "pypi:cache" or "github:tags" for provenance.
type PypiAssetInfo = dict
type PypiReleases = dict[VersionString, list[PypiAssetInfo]]
SUPPORTED_PLATFORMS = [
    "windows-x64",
    "windows-x32",
    "osx-x64",
    "osx-arm64",
    "linux-x64",
    "linux-arm64",
]
SUPPORTED_PYTHON_VERSIONS = ["3.3", "3.8", "3.13"]
PLATFORM_TAG_PATTERNS = {
    "windows-x64": ["win_amd64"],
    "windows-x32": ["win32"],
    "osx-x64": ["macosx_*_x86_64", "macosx_*_universal2"],
    "osx-arm64": ["macosx_*_arm64", "macosx_*_universal2"],
    "linux-x64": ["manylinux*_x86_64"],
    "linux-arm64": ["manylinux*_aarch64"],
}


def build_default_asset_patterns(platform_tags: list[str]) -> list[AssetPattern]:
    version_var = "${version}"
    py_var = "${py_version}"
    py_tag = f"cp{py_var}"
    abi_tags = [f"cp{py_var}m", f"cp{py_var}"]

    patterns = []

    for platform_tag, abi_tag in product(platform_tags, abi_tags):
        patterns.append(f"*-{version_var}-{py_tag}-{abi_tag}-{platform_tag}.whl")
    patterns.append(f"*-{version_var}-py3-none-any.whl")
    patterns.append(f"*-{version_var}-py2.py3-none-any.whl")
    return patterns


DEFAULT_ASSET_PATTERNS: dict[str, AssetPatterns] = {
    platform: build_default_asset_patterns(platform_tags)
    for platform, platform_tags in PLATFORM_TAG_PATTERNS.items()
}


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def dump_json(path: Path, data: dict, *, sort_keys: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=True, sort_keys=sort_keys)
        handle.write("\n")


def name_and_version(url: str) -> tuple[str, str | None] | tuple[None, None]:
    match = re.match(r"^https?://pypi\.org/project/([^/#?]+)(?:/([^/#?]+?)|/?)$", url)
    if match:
        return match.groups()  # type: ignore[return-value]
    return (None, None)


def normalize_library(library: RegistryEntry) -> NormalizedRegistryEntry:
    normalized: NormalizedRegistryEntry = library.copy()
    normalized["releases"] = [
        normalize_release_def(release)
        for release in library.get("releases", [])
    ]
    return normalized


def normalize_release_def(release: ReleaseDef) -> NormalizedReleaseDef:
    is_static = "url" in release
    normalized = release.copy()

    base = normalized.get("base")
    if isinstance(base, str):
        normalized["base"] = normalize_base_url(base)

    platforms = normalized.get("platforms")
    if platforms is None:
        platforms = SUPPORTED_PLATFORMS
    elif isinstance(platforms, str):
        platforms = [platforms]
    if "*" in platforms:
        platforms = SUPPORTED_PLATFORMS
    normalized["platforms"] = platforms

    python_versions = normalized.get("python_versions")
    if python_versions is None:
        python_versions = SUPPORTED_PYTHON_VERSIONS
    elif isinstance(python_versions, str):
        python_versions = [python_versions]
    if "*" in python_versions:
        python_versions = SUPPORTED_PYTHON_VERSIONS
    normalized["python_versions"] = python_versions

    if is_static:
        normalized["sublime_text"] = normalized.get("sublime_text", "*")
    else:
        sublime_text = normalized.get("sublime_text")
        if sublime_text is None:
            sublime_text = ["*"]
        elif isinstance(sublime_text, str):
            sublime_text = [sublime_text]
        normalized["sublime_text"] = sublime_text

    asset = normalized.get("asset")
    if isinstance(asset, str):
        normalized["asset"] = [asset]

    if not is_static:
        version_spec = normalized.get("version")
        if isinstance(version_spec, str):
            normalized["version"] = normalize_version_spec(version_spec)
        elif version_spec is None:
            normalized["version"] = ""

    validate_normalized_release_def(normalized)
    return normalized


def normalize_base_url(base: str) -> str:
    if base.startswith("pypi:"):
        name = base[len("pypi:"):].lstrip("/")
        if not name:
            raise ValueError("Missing PyPI project name in base.")
        return f"https://pypi.org/project/{name}"
    if base.startswith("github:"):
        repo = base[len("github:"):].lstrip("/")
        if not repo:
            raise ValueError("Missing GitHub repo in base.")
        return f"https://github.com/{repo}"
    return base


def normalize_version_spec(specifier: str) -> str:
    specifier = specifier.strip()
    if not specifier or specifier == "*":
        return ""
    if specifier[0] in "<>=!~":
        return specifier
    return f"=={specifier}"


def validate_normalized_release_def(release: NormalizedReleaseDef) -> None:
    if (
        (base := release.get("base"))
        and "pypi.org/project/" in base
        and not release.get("asset")
    ):
        for platform in release["platforms"]:
            if platform not in PLATFORM_TAG_PATTERNS:
                raise ValueError(f"Can't provide default assets for platform: {platform}")


def concretize_release_defs(
    releases: list[NormalizedReleaseDef], *, auto_assets: bool
) -> list[ConcreteReleaseDef]:
    return [
        concrete
        for release in releases
        for concrete in concretize_release_def(release, auto_assets=auto_assets)
    ]


def concretize_release_def(
    release: NormalizedReleaseDef, *, auto_assets: bool
) -> list[ConcreteReleaseDef]:
    base = release["base"]
    platforms = release["platforms"]
    python_versions = release["python_versions"]
    sublime_text = release["sublime_text"]
    version_spec = release.get("version") or ""
    asset_patterns = release.get("asset")

    output: list[ConcreteReleaseDef] = []
    for st_specifier in sublime_text:
        for py_ver in python_versions:
            for platform in platforms:
                patterns = asset_patterns or (
                    DEFAULT_ASSET_PATTERNS.get(platform, [])
                    if auto_assets else []
                )
                output.append(
                    ConcreteReleaseDef(
                        base=base,
                        asset_patterns=patterns,
                        platform=platform,
                        python_version=py_ver,
                        sublime_text=st_specifier,
                        version=SpecifierSet(version_spec),
                    )
                )
    return output


def explain_library(library: RegistryEntry) -> list[dict]:
    normalized_library = normalize_library(library)
    output: list[dict] = []
    for release in normalized_library.get("releases", []):
        base = release.get("base")
        if not base:
            continue
        auto_assets = "pypi.org/project/" in base and release.get("asset") is None
        for concrete in concretize_release_def(release, auto_assets=auto_assets):
            entry = {
                "base": concrete.base,
                "asset": concrete.asset_patterns,
                "platform": concrete.platform,
                "python_version": concrete.python_version,
                "sublime_text": concrete.sublime_text,
                "version": str(concrete.version) or "*",
            }
            tags = release.get("tags")
            if tags is not None:
                entry["tags"] = tags
            output.append(entry)
    return output


def compile_asset_patterns(
    concrete: ConcreteReleaseDef, version: VersionString
) -> list[re.Pattern]:
    st_build = normalize_st_build(concrete.sublime_text)
    py_version = concrete.python_version.replace(".", "")
    compiled: list[re.Pattern] = []
    for pattern in concrete.asset_patterns:
        pattern = pattern.replace("${platform}", concrete.platform)
        pattern = pattern.replace("${py_version}", py_version)
        pattern = pattern.replace("${st_build}", st_build)
        pattern = pattern.replace("${version}", version)
        pattern = pattern.replace(".", r"\.")
        pattern = pattern.replace("?", r".")
        pattern = pattern.replace("*", r".*?")
        compiled.append(re.compile(pattern))
    return compiled


def normalize_st_build(st_specifier: str) -> str:
    """
    Convert a sublime_text selector into the ${st_build} replacement.

    Supported patterns:
    - "*" -> "any"
    - "4147" -> "4147"
    - ">4147" -> "4147"
    - ">=4147" -> "4147"
    - "<=4147" -> "4147"
    - "4147 - 4200" -> "4147"

    Any other prefix style is assumed to start with two non-digits, so the
    build number begins at index 2. Comma-separated specifiers are not
    supported.
    """
    if st_specifier == "*":
        return "any"
    if st_specifier[0].isdigit():
        return st_specifier[:4]
    if st_specifier[1].isdigit():
        return st_specifier[1:]
    return st_specifier[2:]


def find_release_info(
    concrete: ConcreteReleaseDef,
    version: VersionString,
    assets: list[PypiAssetInfo],
) -> ReleaseInfo | None:
    python_versions = [Version(concrete.python_version)]
    for re_pattern in compile_asset_patterns(concrete, version):
        asset = match_pypi_asset(re_pattern, python_versions, assets)
        if not asset:
            continue
        return create_release_info_from_asset(asset, concrete, version)
    return None


def match_pypi_asset(
    file_pattern: re.Pattern,
    python_versions: list[Version],
    assets: list[PypiAssetInfo],
) -> PypiAssetInfo | None:
    for asset in assets:
        if asset.get("packagetype") != "bdist_wheel":
            continue
        if asset.get("yanked"):
            continue
        if not file_pattern.match(asset.get("filename", "")):
            continue

        specs = asset.get("requires_python")
        if specs:
            spec_set = SpecifierSet(specs)
            if not all(
                spec_set.contains(ver, prereleases=True) for ver in python_versions
            ):
                continue

        return asset

    return None


def create_release_info_from_asset(
    asset: PypiAssetInfo,
    concrete: ConcreteReleaseDef,
    version: VersionString,
) -> ReleaseInfo:
    output_constraints = normalize_output_constraints(concrete)
    info = {
        "url": asset["url"],
        "version": version,
        "date": asset["upload_time"][:19] + "Z",
        "sha256": asset["digests"]["sha256"],
    }
    info.update(output_constraints)
    return info  # type: ignore[return-value]


def normalize_output_constraints(concrete: ConcreteReleaseDef) -> ReleaseConstraints:
    return {
        "platforms": [concrete.platform],
        "python_versions": [concrete.python_version],
        "sublime_text": concrete.sublime_text,
    }


def normalize_timestamp(timestamp: str) -> str:
    if not timestamp:
        return timestamp
    return timestamp[:19] + "Z"


def parse_tag_prefix(value) -> str | None:
    if value is True or value is None:
        return None
    if isinstance(value, str):
        return value
    raise ValueError("Invalid tags value; must be true or a prefix string.")


async def resolve_library(
    library: RegistryEntry, cache_dir: Path, aio_session: aiohttp.ClientSession
) -> tuple[ResolvedLibraryInfo, list[SourceInfo]]:
    normalized_library = normalize_library(library)

    output_releases: list[ReleaseInfo] = []
    static_releases: list[ReleaseInfo] = []
    sources: set[str] = set()
    pypi_metadata: dict = {}
    included_github_metadata = False

    type ByUrl[T] = dict[Url, list[T]]

    pypi_bases: ByUrl[NormalizedReleaseDef] = defaultdict(list)
    github_asset_defs: ByUrl[tuple[NormalizedReleaseDef, IncludeMetadata]] = defaultdict(list)
    github_tag_defs: ByUrl[tuple[NormalizedReleaseDef, IncludeMetadata]] = defaultdict(list)

    for release in normalized_library.get("releases", []):
        base_url = release.get("base")
        if release.get("url") and not base_url:
            static_releases.append(release.copy())  # type: ignore[arg-type]
            continue
        if base_url and "pypi.org/project/" in base_url:
            pypi_bases[base_url].append(release)
        elif base_url and "github.com/" in base_url:
            container = github_asset_defs if "asset" in release else github_tag_defs
            container[base_url].append((release, not included_github_metadata))
            if not included_github_metadata:
                included_github_metadata = True

    if pypi_bases:
        for base_url, rel_defs in pypi_bases.items():
            concrete_defs = concretize_release_defs(rel_defs, auto_assets=True)
            base_name, base_version = name_and_version(base_url)
            if not base_name:
                raise ValueError(f'Invalid PyPI base URL "{base_url}".')

            pypi_data, pypi_source = await fetch_pypi_json(base_name, cache_dir, aio_session)
            sources.add(f"pypi:{pypi_source}")
            if not pypi_metadata:
                pypi_metadata = pypi_data.get("info", {}) or {}

            releases: PypiReleases = pypi_data.get("releases", {})
            if base_version:
                downloads = download_info_from_fixed_version(
                    base_version, concrete_defs, releases
                )
            else:
                downloads = download_info_from_latest_versions(concrete_defs, releases)
            output_releases.extend(downloads)

    if github_asset_defs or github_tag_defs:
        if not os.getenv("GITHUB_TOKEN"):
            raise RuntimeError("GITHUB_TOKEN env var is required for GitHub access.")

    github_metadata: RepoMetadata = {}
    if github_asset_defs:
        downloads, metadata = await resolve_github_releases(aio_session, github_asset_defs)
        if downloads:
            output_releases.extend(downloads)
            sources.add("github:releases")
        github_metadata |= metadata

    if github_tag_defs:
        downloads, metadata = await resolve_github_tags(aio_session, github_tag_defs)
        if downloads:
            output_releases.extend(downloads)
            sources.add("github:tags")
        github_metadata |= metadata

    if not output_releases and not static_releases:
        raise ValueError("No matching releases found.")

    lib_info_from_github = drop_falsy({
        "description": github_metadata.get("description"),
        "author": github_metadata.get("author"),
        "issues": github_metadata.get("issues"),
        "homepage": github_metadata.get("homepage"),
    })
    lib_info_from_pypi = drop_falsy({
        "description": pypi_metadata.get("summary"),
        "author": pypi_metadata.get("author"),
        "issues": (
            pypi_metadata.get("bugtrack_url")
            or (pypi_metadata.get("project_urls") or {}).get("Issues")
        ),
        "homepage": pypi_homepage(pypi_metadata),
    })
    info: ResolvedLibraryInfo = (
        lib_info_from_github
        | lib_info_from_pypi
        | normalized_library
        | {"releases": sort_releases(combine_releases(output_releases + static_releases))}
    )

    for key in ("description", "author", "issues"):
        if not info.get(key):
            raise ValueError(f'Missing required "{key}" value.')

    return info, sorted(sources)


def pypi_homepage(info: dict) -> str | None:
    project_urls = info.get("project_urls") or {}  # project_urls can be None!
    return (
        project_urls.get("Homepage")
        or project_urls.get("homepage")
        or info.get("home_page")
        or info.get("project_url")
        or info.get("package_url")
    )


def sort_releases(releases: list[dict]) -> list[dict]:
    def key(item: dict):
        version = item.get("version", "")
        try:
            parsed = Version(version)
        except InvalidVersion:
            parsed = Version("0")
        platforms = item.get("platforms", [])
        return (parsed, platforms)

    return sorted(releases, key=key, reverse=True)


def combine_releases(releases: list[ReleaseInfo]) -> list[dict]:
    grouped: dict[tuple[str, str], list[ReleaseInfo]] = defaultdict(list)
    for release in releases:
        sublime_text = release.get("sublime_text", "*")
        url = release.get("url")
        if not url:
            raise ValueError("Release entry missing url.")
        grouped[(sublime_text, url)].append(release)

    output = []
    for (sublime_text, url), entries in grouped.items():
        platforms = {p for entry in entries for p in entry.get("platforms", [])}
        platform_list = sorted(platforms)
        if platforms == set(SUPPORTED_PLATFORMS):
            platform_list = ["*"]
        python_versions = {
            p for entry in entries for p in entry.get("python_versions", [])
        }

        merged: dict = {}
        for entry in entries:
            merged |= entry

        if platform_list:
            merged["platforms"] = platform_list

        if python_versions:
            merged["python_versions"] = list(python_versions)

        output.append(merged)

    return output


async def fetch_pypi_json(
    name: str,
    cache_dir: Path,
    aio_session: aiohttp.ClientSession,
    ttl_seconds: int = CACHE_TTL_SECONDS,
) -> tuple[dict, str]:
    cached = PYPI_DATA_CACHE.get(name)
    if cached is not None:
        return cached

    data, source = await _fetch_pypi_json(
        name, cache_dir, aio_session, ttl_seconds=ttl_seconds
    )
    PYPI_DATA_CACHE[name] = (data, source)
    return data, source


async def _fetch_pypi_json(
    name: str,
    cache_dir: Path,
    aio_session: aiohttp.ClientSession,
    ttl_seconds: int = CACHE_TTL_SECONDS,
) -> tuple[dict, str]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{name}.json"
    has_cache = cache_path.exists()
    meta_path = cache_dir / "meta.json"

    now = time.time()
    async with PYPI_META_LOCK:
        meta = load_json(meta_path) if meta_path.exists() else {}
        entry = meta.get(name, {})
        if has_cache:
            fetched_at = entry.get("fetched_at")
            if fetched_at and now - fetched_at < ttl_seconds:
                return load_json(cache_path), "cache"

    headers = {}
    if has_cache:
        if entry.get("etag"):
            headers["If-None-Match"] = entry["etag"]
        if entry.get("last_modified"):
            headers["If-Modified-Since"] = entry["last_modified"]

    url = PYPI_BASE.format(name)
    async with aio_session.get(url, headers=headers) as resp:
        if resp.status == 304:
            async with PYPI_META_LOCK:
                meta = load_json(meta_path) if meta_path.exists() else {}
                entry = meta.get(name, {})
                entry["fetched_at"] = now
                meta[name] = entry
                dump_json(meta_path, meta)
            return load_json(cache_path), "cache-304"
        resp.raise_for_status()
        text = await resp.text()
        data = json.loads(text)

        cache_path.write_text(text, encoding="utf-8")
        async with PYPI_META_LOCK:
            meta = load_json(meta_path) if meta_path.exists() else {}
            meta[name] = {
                "etag": resp.headers.get("ETag"),
                "last_modified": resp.headers.get("Last-Modified"),
                "fetched_at": now,
            }
            dump_json(meta_path, meta)
        return data, "network"


def download_info_from_fixed_version(
    version_string: VersionString,
    concrete_defs: list[ConcreteReleaseDef],
    releases: PypiReleases,
) -> list[ReleaseInfo]:
    try:
        version = Version(version_string)
    except InvalidVersion:
        return []

    assets = releases.get(version_string, [])
    return [
        info
        for concrete in concrete_defs
        if concrete.version.contains(version, prereleases=True)
        if (info := find_release_info(concrete, version_string, assets))
    ]


def download_info_from_latest_versions(
    concrete_defs: list[ConcreteReleaseDef], releases: PypiReleases
) -> list[ReleaseInfo]:
    versions = []
    for version_string in releases:
        try:
            versions.append((Version(version_string), version_string))
        except InvalidVersion:
            continue

    output = []
    for concrete in concrete_defs:
        for version, version_string in sorted(versions, reverse=True):
            if version.is_prerelease or version.is_devrelease:
                continue
            if not concrete.version.contains(version, prereleases=True):
                continue
            assets = releases[version_string]
            info = find_release_info(concrete, version_string, assets)
            if info:
                output.append(info)
                break

    return output


async def resolve_github_releases(
    session: aiohttp.ClientSession,
    github_asset_defs: dict[str, list[tuple[NormalizedReleaseDef, IncludeMetadata]]],
) -> tuple[list[ReleaseInfo], RepoMetadata]:
    output: list[ReleaseInfo] = []
    metadata: RepoMetadata = {}

    for base_url, defs in github_asset_defs.items():
        include_metadata = any(include for _, include in defs)
        concrete_defs: list[tuple[ConcreteReleaseDef, str | None]] = []
        for release, _ in defs:
            tag_prefix = parse_tag_prefix(release.get("tags"))
            for concrete in concretize_release_def(release, auto_assets=False):
                concrete_defs.append((concrete, tag_prefix))

        downloads, new_metadata = await download_info_from_github_releases(
            session,
            base_url,
            concrete_defs,
            include_metadata=include_metadata,
        )
        output.extend(downloads)
        metadata |= new_metadata

    return output, metadata


async def download_info_from_github_releases(
    session: aiohttp.ClientSession,
    base_url: str,
    concrete_defs: list[tuple[ConcreteReleaseDef, str | None]],
    *,
    include_metadata: IncludeMetadata = False,
) -> tuple[list[ReleaseInfo], RepoMetadata]:
    if not concrete_defs:
        return [], {}
    scopes = ("RELEASES", "METADATA") if include_metadata else ("RELEASES",)
    gh_info = await fetch_github_info(session, base_url, scopes, hints=["no_readme"])
    metadata: RepoMetadata = {}
    if include_metadata:
        metadata = {"homepage": base_url} | gh_info.get("metadata", {})

    output = []
    for concrete, tag_prefix in concrete_defs:
        async for release in gh_info["releases"]:
            if release.get("is_draft"):
                continue
            tag_match = match_tag_version(release["tag_name"], tag_prefix)
            if not tag_match:
                continue
            version, version_str = tag_match
            if not concrete.version.contains(version, prereleases=True):
                continue

            for re_pattern in compile_asset_patterns(concrete, version_str):
                asset = match_release_asset(re_pattern, release.get("assets", []))
                if asset:
                    break
            else:
                continue

            release_info: ReleaseInfo = {
                "url": asset["url"],
                "version": version_str,
                "date": normalize_timestamp(release["date"]),
            }
            release_info.update(normalize_output_constraints(concrete))
            output.append(release_info)
            if is_final_version(version):
                break

    return output, metadata


def match_release_asset(
    pattern: re.Pattern,
    assets: list[ReleaseAssetInfo]
) -> ReleaseAssetInfo | None:
    for asset in assets:
        name = asset.get("name") or ""
        if pattern.match(name):
            return asset
    return None


async def resolve_github_tags(
    session: aiohttp.ClientSession,
    github_tag_defs: dict[str, list[tuple[NormalizedReleaseDef, IncludeMetadata]]],
) -> tuple[list[ReleaseInfo], RepoMetadata]:
    output: list[ReleaseInfo] = []
    metadata: RepoMetadata = {}

    for base_url, defs in github_tag_defs.items():
        include_metadata = any(include for _, include in defs)
        scopes = ("TAGS", "METADATA") if include_metadata else ("TAGS",)
        gh_info = await fetch_github_info(session, base_url, scopes, hints=["no_readme"])
        if include_metadata:
            metadata |= {"homepage": base_url} | gh_info.get("metadata", {})

        for release, _ in defs:
            tag_prefix = parse_tag_prefix(release.get("tags"))
            version_spec = release.get("version")
            spec_set = SpecifierSet(version_spec) if version_spec else None

            tagged_versions = []
            async for tag in gh_info["tags"]:
                match = match_tag_version(tag["name"], tag_prefix)
                if not match:
                    continue
                version, version_str = match
                if spec_set and not spec_set.contains(version, prereleases=True):
                    continue
                tagged_versions.append((version, version_str, tag))

            tagged_versions.sort(key=lambda item: item[0], reverse=True)
            for version, version_str, tag in tagged_versions:
                download_info: ReleaseInfo = {
                    "url": tag["url"],
                    "version": version_str,
                    "date": normalize_timestamp(tag["date"]),
                }
                for concrete in concretize_release_def(release, auto_assets=False):
                    release_info = download_info | normalize_output_constraints(concrete)
                    output.append(release_info)

                if is_final_version(version):
                    break

    return output, metadata


def match_tag_version(
    tag_name: str, tag_prefix: str | None
) -> tuple[Version, str] | None:
    if tag_prefix:
        if not tag_name.startswith(tag_prefix):
            return None
        version_str = tag_name[len(tag_prefix):]
    else:
        version_str = tag_name.removeprefix("v")

    try:
        return Version(version_str), version_str
    except InvalidVersion:
        return None


def is_final_version(version: Version) -> bool:
    return not (version.is_prerelease or version.is_devrelease)
