import argparse
import asyncio
import json
import os
import re
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import partial
from pathlib import Path

import aiohttp
from .github import fetch_github_info, ReleaseAssetInfo, RepoMetadata
from .utils import drop_falsy
from packaging.specifiers import SpecifierSet
from packaging.version import InvalidVersion, Version
from rich.console import Console
from rich.progress import (
    BarColumn,
    Progress,
    TaskProgressColumn,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)


CACHE_TTL_SECONDS = 600
DEFAULT_REPO_URL = (
    "https://raw.githubusercontent.com/packagecontrol/channel/refs/heads/main/repository.json"
)
PYPI_BASE = "https://pypi.org/pypi/{}/json"
PYPI_META_LOCK = asyncio.Lock()
type VersionString = str
type AssetPattern = str
type AssetPatterns = list[AssetPattern]
type Url = str
# ReleaseDef is a raw release definition as specified in repository.json.
type ReleaseDef = dict
# NormalizedReleaseDef is a ReleaseDef with defaults applied and list-ified values.
type NormalizedReleaseDef = dict
type IncludeMetadata = bool


@dataclass(frozen=True, slots=True)
class ConcreteReleaseDef:
    base: Url
    asset_patterns: AssetPatterns
    platform: str
    python_version: str
    sublime_text: str
    version: str


# ReleaseInfo is the output release entry we emit into the output JSON.
type ReleaseInfo = dict
type ResolvedLibraryInfo = dict
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Resolve a single library (PyPI or GitHub) from repository.json."
    )
    parser.add_argument(
        "--repo",
        default="repository.json",
        help="Path to repository to crawl (default: repository.json)",
    )
    parser.add_argument(
        "--fetch-repo",
        nargs="?",
        const=DEFAULT_REPO_URL,
        help=(
            "Fetch repository.json from a URL before crawling "
            f"(default: {DEFAULT_REPO_URL})"
        ),
    )
    parser.add_argument("--name", help="Library name from repository to crawl")
    parser.add_argument(
        "--explain",
        help="Library name to print resolved release definitions for",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Number of libraries to crawl when --name/--explain is omitted (default: 10)",
    )
    parser.add_argument(
        "--output",
        "-o",
        default="libraries.json",
        help="Path to output JSON (default: libraries.json)",
    )
    parser.add_argument(
        "--crawl-db",
        default="libraries-metadb.json",
        help="Path to crawl meta database (default: libraries-metadb.json)",
    )
    parser.add_argument(
        "--cache-dir",
        default=".pypi-cache",
        help="PyPI cache directory (default: .pypi-cache)",
    )
    return parser.parse_args()


def main() -> None:
    raise SystemExit(asyncio.run(run()))


async def run() -> int:
    args = parse_args()
    repo_path = Path(args.repo)
    if args.fetch_repo is not None:
        await fetch_repository(args.fetch_repo, repo_path)
    if not repo_path.exists():
        raise FileNotFoundError(f"{repo_path} not found.")

    if args.explain and args.name:
        raise ValueError("Use either --name or --explain, not both.")

    repo = load_json(repo_path)

    if args.explain:
        library = find_library(repo, args.explain)
        if not library:
            raise ValueError(f'Library "{args.explain}" not found in {repo_path.name}.')
        concrete_defs = explain_library(library)
        print(json.dumps(concrete_defs, indent=2, ensure_ascii=True))
        return 0

    timestamp = now_timestamp()
    updated_names: list[str] = []

    crawl_path = Path(args.crawl_db)
    crawl_db = load_crawl_db(crawl_path)
    dump_meta_db = partial(dump_json, crawl_path, crawl_db, sort_keys=True)

    output_path = Path(args.output)
    output_data = load_output(output_path)
    dump_output = partial(dump_json, output_path, output_data)

    if args.name:
        library = find_library(repo, args.name)
        if not library:
            raise ValueError(f'Library "{args.name}" not found in {repo_path.name}.')

        try:
            async with aiohttp.ClientSession() as aio_session:
                info, sources = await resolve_library(
                    library, Path(args.cache_dir), aio_session
                )

            output_data["libraries"][args.name] = info
            dump_output()

            latest_version = latest_version_from_releases(info["releases"])
            if mark_success(crawl_db, args.name, timestamp, latest_version):
                updated_names.append(args.name)
            dump_meta_db()

            source_label = ", ".join(sources) if sources else "cache"
            version_label = f" {latest_version}" if latest_version else ""
            print(json.dumps(info, indent=2, ensure_ascii=True))
            print(f"Resolved {args.name}{version_label} using {source_label}.")
            print(format_updated_message(updated_names))
            return 0
        except Exception as exc:
            mark_failure(crawl_db, args.name, timestamp, str(exc))
            dump_meta_db()
            raise

    repo_names = {
        lib.get("name") for lib in repo.get("libraries", []) if lib.get("name")
    }

    removed = set(output_data["libraries"]) - repo_names
    for name in removed:
        output_data["libraries"].pop(name, None)
        mark_removed(crawl_db, name, timestamp)

    for name in repo_names:
        if name not in crawl_db or crawl_db.get(name, {}).get("removed"):
            mark_added(crawl_db, name, timestamp)

    def sort_key(name: str):
        return (
            parse_last_crawl(crawl_db.get(name, {}).get("last_crawl")),
            name.lower(),
        )

    selected = sorted(repo_names, key=sort_key)[:args.limit]
    libraries = {lib.get("name"): lib for lib in repo.get("libraries", [])}
    selected_libs = [
        library
        for name in selected
        if (library := libraries.get(name))
    ]
    if not selected_libs:
        print("Nothing to crawl.")
        return 0

    console = Console()
    disable_progress = not console.is_terminal or os.environ.get("CI") == "true"
    with Progress(
        TextColumn("[bold blue]Crawling Libraries:"),
        BarColumn(),
        TaskProgressColumn(),
        TimeElapsedColumn(),
        TimeRemainingColumn(),
        console=console,
        transient=False,
        disable=disable_progress,
    ) as progress:
        task_id = progress.add_task("Crawling Libraries", total=len(selected_libs))
        async with aiohttp.ClientSession() as aio_session:
            async def _resolve_named(
                library: dict,
            ) -> tuple[str, tuple[ResolvedLibraryInfo, list[SourceInfo]] | Exception]:
                name = library["name"]
                task = resolve_library(library, Path(args.cache_dir), aio_session)
                try:
                    return name, await task
                except Exception as exc:
                    return name, exc

            tasks = [_resolve_named(library) for library in selected_libs]
            for task in asyncio.as_completed(tasks):
                name, result = await task
                progress.advance(task_id)

                if isinstance(result, Exception):
                    mark_failure(crawl_db, name, timestamp, str(result))
                    print(f"Failed {name}: {result}")
                    continue

                info, sources = result
                output_data["libraries"][name] = info
                latest_version = latest_version_from_releases(info["releases"])
                if mark_success(crawl_db, name, timestamp, latest_version):
                    updated_names.append(name)
                source_label = ", ".join(sources) if sources else "cache"
                version_label = f" {latest_version}" if latest_version else ""
                print(f"Resolved {name}{version_label} using {source_label}.")

    dump_output()
    dump_meta_db()
    print(format_updated_message(updated_names))
    return 0


def parse_last_crawl(value: str | None) -> datetime:
    if not value:
        return datetime.min
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return datetime.min


async def fetch_repository(url: str, path: Path) -> None:
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            response.raise_for_status()
            body = await response.text()
            try:
                data = json.loads(body)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"Fetched repository at {url} is not valid JSON."
                ) from exc
    if not isinstance(data, dict):
        raise ValueError("Fetched repository JSON must be an object.")
    dump_json(path, data)
    print(f"Fetched {url} and stored as {path}.")


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def dump_json(path: Path, data: dict, *, sort_keys: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=True, sort_keys=sort_keys)
        handle.write("\n")


def now_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_output(path: Path) -> dict:
    if not path.exists():
        return {"libraries": {}}
    data = load_json(path)
    if not isinstance(data, dict):
        raise ValueError(f"{path.name} must be a JSON object.")
    if "libraries" not in data:
        data["libraries"] = {}
    if not isinstance(data["libraries"], dict):
        raise ValueError(f"{path.name} libraries must be an object.")
    return data


def load_crawl_db(path: Path) -> dict:
    if not path.exists():
        return {}
    data = load_json(path)
    if not isinstance(data, dict):
        raise ValueError(f"{path.name} must be a JSON object.")
    return data


def mark_added(crawl_db: dict, name: str, timestamp: str) -> None:
    entry = crawl_db.setdefault(name, {})
    if entry.get("removed"):
        entry.pop("removed", None)
    if "added" not in entry:
        entry["added"] = timestamp


def mark_removed(crawl_db: dict, name: str, timestamp: str) -> None:
    entry = crawl_db.setdefault(name, {})
    entry["removed"] = timestamp


def mark_success(
    crawl_db: dict, name: str, timestamp: str, latest_version: str | None
) -> bool:
    entry = crawl_db.setdefault(name, {})
    previous_version = entry.get("latest_version")
    entry["last_crawl"] = timestamp
    updated = False
    if latest_version:
        entry["latest_version"] = latest_version
        if previous_version and previous_version != latest_version:
            entry["last_update"] = f"{previous_version} -> {latest_version}"
            entry["last_update_at"] = timestamp
            updated = True
    entry.pop("failing_since", None)
    entry.pop("fail_reason", None)
    entry.pop("removed", None)
    return updated


def mark_failure(crawl_db: dict, name: str, timestamp: str, reason: str) -> None:
    entry = crawl_db.setdefault(name, {})
    entry["last_crawl"] = timestamp
    if "failing_since" not in entry:
        entry["failing_since"] = timestamp
    entry["fail_reason"] = reason


def find_library(repo: dict, name: str) -> dict | None:
    for library in repo.get("libraries", []):
        if library.get("name") == name:
            return library
    return None


def name_and_version(url: str) -> tuple[str, str | None] | tuple[None, None]:
    match = re.match(r"^https?://pypi\.org/project/([^/#?]+)(?:/([^/#?]+?)|/?)$", url)
    if match:
        return match.groups()  # type: ignore[return-value]
    return (None, None)


def validate_release_def(release: ReleaseDef) -> None:
    for key in ("platforms", "python_versions", "sublime_text", "asset"):
        value = release.get(key)
        if value is None:
            continue
        if isinstance(value, str):
            continue
        if isinstance(value, list) and all(isinstance(item, str) for item in value):
            continue
        raise ValueError(f"Invalid {key} value in release.")

    version_spec = release.get("version")
    if version_spec is not None and not isinstance(version_spec, str):
        raise ValueError("Invalid version value in release.")

    url = release.get("url")
    if url is not None:
        if not isinstance(url, str) or not url:
            raise ValueError("Invalid url value in release.")
        if not isinstance(version_spec, str) or not version_spec.strip():
            raise ValueError("Static releases must include a version string.")
        if url.startswith("http://") and not release.get("sha256"):
            raise ValueError("Static http releases must include a sha256 hash.")
        if release.get("base"):
            raise ValueError("Static releases must not include a base URL.")
        return

    base = release.get("base")
    if not isinstance(base, str) or not base:
        raise ValueError("Missing base URL in release.")

    if "pypi.org/project/" in base:
        if release.get("branch") or release.get("url"):
            raise ValueError("Branch/url releases are not supported in this script.")
    elif "github.com/" in base:
        if release.get("branch") or release.get("url"):
            raise ValueError("Branch/url releases are not supported in this script.")
        parse_tag_prefix(release.get("tags"))
        if not release.get("asset") and "tags" not in release:
            raise ValueError("GitHub releases must use tags or asset patterns.")
    else:
        raise ValueError(f'Unsupported base "{base}" found in releases.')


def validate_normalized_release_def(release: NormalizedReleaseDef) -> None:
    base = release["base"]
    if "pypi.org/project/" in base and not release.get("asset"):
        for platform in release["platforms"]:
            if platform not in PLATFORM_TAG_PATTERNS:
                raise ValueError(f"Unsupported platform for auto assets: {platform}")


def validate_library(library: dict) -> None:
    for release in library.get("releases", []):
        validate_release_def(release)


async def fetch_pypi_json(
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


def normalize_release_def(release: ReleaseDef) -> NormalizedReleaseDef:
    normalized = release.copy()

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

    sublime_text = normalized.get("sublime_text")
    if sublime_text is None:
        sublime_text = ["*"]
    elif isinstance(sublime_text, str):
        sublime_text = [sublime_text]
    normalized["sublime_text"] = sublime_text

    asset = normalized.get("asset")
    if isinstance(asset, str):
        normalized["asset"] = [asset]

    version_spec = normalized.get("version")
    if isinstance(version_spec, str):
        normalized["version"] = normalize_version_spec(version_spec)
    elif version_spec is None:
        normalized["version"] = ""

    validate_normalized_release_def(normalized)
    return normalized


def concretize_release_def(
    release: NormalizedReleaseDef, *, auto_assets: bool
) -> list[ConcreteReleaseDef]:
    base = release["base"]
    platforms = release["platforms"]
    python_versions = release["python_versions"]
    sublime_text = release["sublime_text"]
    version_spec = release.get("version") or ""
    asset_patterns = release.get("asset")

    platform_patterns: dict[str, AssetPatterns] = {}
    if not asset_patterns and auto_assets:
        for platform in platforms:
            tag_patterns = PLATFORM_TAG_PATTERNS[platform]
            platform_patterns[platform] = build_auto_asset_patterns(tag_patterns)

    output: list[ConcreteReleaseDef] = []
    for st_specifier in sublime_text:
        for py_ver in python_versions:
            for platform in platforms:
                patterns = asset_patterns or platform_patterns.get(platform, [])
                output.append(
                    ConcreteReleaseDef(
                        base=base,
                        asset_patterns=patterns,
                        platform=platform,
                        python_version=py_ver,
                        sublime_text=st_specifier,
                        version=version_spec,
                    )
                )
    return output


def concretize_release_defs(
    releases: list[ReleaseDef], *, auto_assets: bool
) -> list[ConcreteReleaseDef]:
    normalized_defs = [normalize_release_def(release) for release in releases]
    return [
        concrete
        for normalized in normalized_defs
        for concrete in concretize_release_def(normalized, auto_assets=auto_assets)
    ]


def explain_library(library: dict) -> list[dict]:
    validate_library(library)
    output: list[dict] = []
    for release in library.get("releases", []):
        normalized = normalize_release_def(release)
        base = normalized.get("base", "")
        auto_assets = "pypi.org/project/" in base and normalized.get("asset") is None
        for concrete in concretize_release_def(normalized, auto_assets=auto_assets):
            entry = {
                "base": concrete.base,
                "asset": concrete.asset_patterns,
                "platform": concrete.platform,
                "python_version": concrete.python_version,
                "sublime_text": concrete.sublime_text,
                "version": concrete.version,
            }
            tags = normalized.get("tags")
            if tags is not None:
                entry["tags"] = tags
            output.append(entry)
    return output


def build_auto_asset_patterns(platform_tags: list[str]) -> list[AssetPattern]:
    version_var = "${version}"
    py_var = "${py_version}"
    py_tag = f"cp{py_var}"
    abi_tags = [f"cp{py_var}m", f"cp{py_var}"]

    patterns = []
    for platform_tag in platform_tags:
        for abi_tag in abi_tags:
            patterns.append(f"*-{version_var}-{py_tag}-{abi_tag}-{platform_tag}.whl")
    patterns.append(f"*-{version_var}-py3-none-any.whl")
    patterns.append(f"*-{version_var}-py2.py3-none-any.whl")
    return patterns


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
    return info


def normalize_output_constraints(concrete: ConcreteReleaseDef) -> dict:
    return {
        "platforms": [concrete.platform],
        "python_versions": [concrete.python_version],
        "sublime_text": concrete.sublime_text,
    }


def normalize_version_spec(specifier: str) -> str:
    specifier = specifier.strip()
    if not specifier or specifier == "*":
        return ""
    if specifier[0] in "<>=!~":
        return specifier
    return f"=={specifier}"


def matches_version_spec(version: str, specifier: str | None) -> bool:
    if not specifier:
        return True
    try:
        parsed = Version(version)
    except InvalidVersion:
        return False
    return SpecifierSet(specifier).contains(parsed, prereleases=True)


def is_final_version(version: Version) -> bool:
    return not (version.is_prerelease or version.is_devrelease)


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


def download_info_from_fixed_version(
    version: VersionString,
    concrete_defs: list[ConcreteReleaseDef],
    releases: PypiReleases,
) -> list[ReleaseInfo]:
    assets = releases.get(version, [])
    return [
        info
        for concrete in concrete_defs
        if matches_version_spec(version, concrete.version)
        if (info := find_release_info(concrete, version, assets))
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
        specifier = concrete.version
        spec_set = SpecifierSet(specifier) if specifier else None
        for version, version_string in sorted(versions, reverse=True):
            if version.is_prerelease or version.is_devrelease:
                continue
            if spec_set and not spec_set.contains(version, prereleases=True):
                continue
            assets = releases[version_string]
            info = find_release_info(concrete, version_string, assets)
            if info:
                output.append(info)
                break

    return output


def match_release_asset(
    pattern: re.Pattern,
    assets: list[ReleaseAssetInfo]
) -> ReleaseAssetInfo | None:
    for asset in assets:
        name = asset.get("name") or ""
        if pattern.match(name):
            return asset
    return None


async def download_info_from_github_releases(
    session: aiohttp.ClientSession,
    base_url: str,
    concrete_defs: list[tuple[ConcreteReleaseDef, str | None]],
    *,
    include_metadata: IncludeMetadata = False,
) -> tuple[list[dict], RepoMetadata]:
    if not concrete_defs:
        return [], {}
    scopes = ("RELEASES", "METADATA") if include_metadata else ("RELEASES",)
    gh_info = await fetch_github_info(session, base_url, scopes, hints=["no_readme"])
    metadata = gh_info.get("metadata", {})

    output = []
    for concrete, tag_prefix in concrete_defs:
        spec_set = SpecifierSet(concrete.version) if concrete.version else None
        async for release in gh_info["releases"]:
            if release.get("is_draft"):
                continue
            tag_match = match_tag_version(release["tag_name"], tag_prefix)
            if not tag_match:
                continue
            version, version_str = tag_match
            if spec_set and not spec_set.contains(version, prereleases=True):
                continue

            for re_pattern in compile_asset_patterns(concrete, version_str):
                asset = match_release_asset(re_pattern, release.get("assets", []))
                if asset:
                    break
            else:
                continue

            release_info = {
                "url": asset["url"],
                "version": version_str,
                "date": normalize_timestamp(release["date"]),
            }
            release_info.update(normalize_output_constraints(concrete))
            output.append(release_info)
            if is_final_version(version):
                break

    return output, metadata


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


def combine_releases(releases: list[dict]) -> list[dict]:
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
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


def latest_version_from_releases(releases: list[dict]) -> str | None:
    if not releases:
        return None
    newest = sorted(releases, key=lambda rel: rel.get("date") or "")[-1]
    version = newest.get("version")
    return version if isinstance(version, str) else None


def format_updated_message(names: list[str]) -> str:
    if not names:
        return "Nothing new."
    if len(names) == 1:
        return f"{names[0]} has been updated."
    if len(names) == 2:
        return f"{names[0]} and {names[1]} have been updated."
    return f"{', '.join(names[:-1])}, and {names[-1]} have been updated."


async def resolve_library(
    library: dict, cache_dir: Path, aio_session: aiohttp.ClientSession
) -> tuple[ResolvedLibraryInfo, list[SourceInfo]]:
    validate_library(library)

    output_releases: list[dict] = []
    static_releases: list[dict] = []
    sources: set[str] = set()
    pypi_data_by_name: dict[str, dict] = {}  # Cache PyPI JSON per project name.
    included_github_metadata = False

    pypi_bases: dict[Url, list[ReleaseDef]] = defaultdict(list)
    github_asset_defs: dict[Url, list[tuple[ReleaseDef, IncludeMetadata]]] = defaultdict(list)
    github_tag_defs: dict[Url, list[tuple[ReleaseDef, IncludeMetadata]]] = defaultdict(list)

    for release in library.get("releases", []):
        base_url = release.get("base")
        if release.get("url") and not base_url:
            static_releases.append(release.copy())
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

            if base_name not in pypi_data_by_name:
                pypi_data, pypi_source = await fetch_pypi_json(
                    base_name, cache_dir, aio_session
                )
                pypi_data_by_name[base_name] = pypi_data
                sources.add(f"pypi:{pypi_source}")
            else:
                pypi_data = pypi_data_by_name[base_name]

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
    })
    pypi_info: dict = next((data.get("info", {}) for data in pypi_data_by_name.values()), {})
    lib_info_from_pypi = drop_falsy({
        "description": pypi_info.get("summary"),
        "author": pypi_info.get("author"),
        "issues": (
            pypi_info.get("bugtrack_url")
            or (pypi_info.get("project_urls") or {}).get("Issues")
        ),
    })
    info = lib_info_from_github | lib_info_from_pypi | drop_falsy({
        "name": library["name"],
        "description": library.get("description"),
        "author": library.get("author"),
        "issues": library.get("issues"),
        "releases": sort_releases(combine_releases(output_releases + static_releases)),
    })

    for key in ("description", "author", "issues"):
        if not info.get(key):
            raise ValueError(f'Missing required "{key}" value.')

    return info, sorted(sources)


async def resolve_github_releases(
    session: aiohttp.ClientSession,
    github_asset_defs: dict[str, list[tuple[ReleaseDef, IncludeMetadata]]],
) -> tuple[list[dict], RepoMetadata]:
    output: list[dict] = []
    metadata: RepoMetadata = {}

    for base_url, defs in github_asset_defs.items():
        include_metadata = any(include for _, include in defs)
        concrete_defs: list[tuple[ConcreteReleaseDef, str | None]] = []
        for release, _ in defs:
            normalized = normalize_release_def(release)
            tag_prefix = parse_tag_prefix(normalized.get("tags"))
            for concrete in concretize_release_def(normalized, auto_assets=False):
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


async def resolve_github_tags(
    session: aiohttp.ClientSession,
    github_tag_defs: dict[str, list[tuple[ReleaseDef, IncludeMetadata]]],
) -> tuple[list[dict], RepoMetadata]:
    output: list[dict] = []
    metadata: RepoMetadata = {}

    for base_url, defs in github_tag_defs.items():
        include_metadata = any(include for _, include in defs)
        scopes = ("TAGS", "METADATA") if include_metadata else ("TAGS",)
        gh_info = await fetch_github_info(session, base_url, scopes, hints=["no_readme"])
        metadata |= gh_info.get("metadata", {})

        for release, _ in defs:
            normalized = normalize_release_def(release)
            tag_prefix = parse_tag_prefix(normalized.get("tags"))
            version_spec = normalized.get("version")
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
            downloads = []
            for version, version_str, tag in tagged_versions:
                downloads.append({
                    "url": tag["url"],
                    "version": version_str,
                    "date": normalize_timestamp(tag["date"]),
                })
                if is_final_version(version):
                    break

            concrete_defs = concretize_release_def(normalized, auto_assets=False)
            for concrete in concrete_defs:
                for download in downloads:
                    release_info = download.copy()
                    release_info.update(normalize_output_constraints(concrete))
                    output.append(release_info)

    return output, metadata


if __name__ == "__main__":
    main()
