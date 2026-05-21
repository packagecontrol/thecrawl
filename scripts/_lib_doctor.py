from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from itertools import product
from typing import Literal, Mapping, cast
from urllib.parse import unquote, urlsplit

from packaging.version import InvalidVersion, Version

from ._resolve_lib import (
    NormalizedReleaseEntry,
    Release,
    ReleaseEntry,
    compile_asset_patterns,
    normalize_release_def,
    spell_out_constraint_variations,
)


@dataclass(frozen=True)
class UnmatchedReleaseDefinition:
    raw: ReleaseEntry
    missing: list[ExpectedReleaseMatch]


@dataclass(frozen=True)
class ExpectedReleaseMatch:
    sublime_text: str
    platform: str | None
    python_version: str | None


def unmatched_release_definitions(
    library: Mapping[str, object],
    releases: list[Release],
) -> list[UnmatchedReleaseDefinition]:
    output = []
    raw_releases = cast(list[ReleaseEntry], library.get("releases", []))
    for raw_release in raw_releases:
        missing = unmatched_expected_matches(raw_release, releases)
        if missing:
            output.append(UnmatchedReleaseDefinition(raw_release, missing))
    return output


def unmatched_expected_matches(
    raw_release: ReleaseEntry,
    releases: list[Release],
) -> list[ExpectedReleaseMatch]:
    normalized = normalize_release_def(deepcopy(raw_release))
    if "url" in normalized:
        return []

    concrete_defs = spell_out_constraint_variations(
        normalized,
        auto_assets="pypi.org/project/" in normalized["base"],
    )
    expected_matches = (
        ExpectedReleaseMatch(sublime_text, platform, python_version)
        for sublime_text, platform, python_version in product(
            normalized["sublime_text"],
            expected_dimension_values(raw_release, normalized, "platforms"),
            expected_dimension_values(raw_release, normalized, "python_versions"),
        )
    )
    return [
        expected
        for expected in expected_matches
        if not any(
            release_matches_expected(release, concrete, expected)
            for concrete in matching_concrete_defs(concrete_defs, expected)
            for release in releases
        )
    ]


def expected_dimension_values(
    raw_release: ReleaseEntry,
    normalized: NormalizedReleaseEntry,
    key: Literal["platforms", "python_versions"],
) -> list[str] | list[None]:
    if is_auto_dimension(raw_release, key):
        return [None]
    return normalized[key]


def is_auto_dimension(raw_release: ReleaseEntry, key: str) -> bool:
    if key not in raw_release:
        return True
    raw_values = raw_release[key]  # type: ignore[literal-required]
    if not isinstance(raw_values, list):
        raw_values = [raw_values]
    return "*" in raw_values


def matching_concrete_defs(concrete_defs: list, expected: ExpectedReleaseMatch):
    return (
        concrete for concrete in concrete_defs
        if concrete.sublime_text == expected.sublime_text
        if expected.platform is None or concrete.platform == expected.platform
        if (
            expected.python_version is None
            or concrete.python_version == expected.python_version
        )
    )


def release_matches_expected(
    release: Release,
    concrete,
    expected: ExpectedReleaseMatch,
) -> bool:
    version = release.get("version")

    try:
        if not concrete.version.contains(Version(version), prereleases=True):
            return False
    except InvalidVersion:
        return False

    if expected.platform and not list_constraint_covers(
        release.get("platforms", []), expected.platform
    ):
        return False
    if expected.python_version and not list_constraint_covers(
        release.get("python_versions", []), expected.python_version
    ):
        return False
    if not scalar_constraint_covers(
        release.get("sublime_text", "*"), expected.sublime_text
    ):
        return False

    if concrete.asset_patterns:
        filename = unquote(
            urlsplit(release.get("url", "")).path.rsplit("/", 1)[-1]
        )
        if not filename:
            return False
        return any(
            pattern.match(filename)
            for pattern in compile_asset_patterns(concrete, version)
        )
    return True


def list_constraint_covers(values: str | list[str], target: str) -> bool:
    if isinstance(values, str):
        values = [values]
    return "*" in values or target in values


def scalar_constraint_covers(value: str | list[str], target: str) -> bool:
    if isinstance(value, list):
        return list_constraint_covers(value, target)
    return value == "*" or value == target
