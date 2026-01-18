from __future__ import annotations
from functools import partial
from typing import Final, Iterable, Literal, NotRequired, Required, TypedDict, final
from typing import Callable, Mapping, cast

from packaging.specifiers import SpecifierSet


type ReleasePartial = StaticPartial | AssetPartial | TagsPartial


@final
class StaticPartial(TypedDict):
    url: str
    version: str
    date: NotRequired[str]
    sha256: NotRequired[str]

    sublime_text: NotRequired[str]
    platforms: NotRequired[str | list[str]]
    python_versions: NotRequired[str | list[str]]


class _UnsatisfiedPartial(TypedDict):
    base: str

    sublime_text: NotRequired[str | list[str]]
    platforms: NotRequired[str | list[str]]
    python_versions: NotRequired[str | list[str]]

    version: NotRequired[str]


@final
class AssetPartial(_UnsatisfiedPartial):
    asset: NotRequired[str | list[str]]


@final
class TagsPartial(_UnsatisfiedPartial):
    tags: Literal[True] | str


type ReleaseDef = Release | AssetBasedRelease | TagsBasedRelease


class ReleaseConstraints(TypedDict):
    sublime_text: str
    platforms: list[str]
    python_versions: list[str]


@final
class Release(ReleaseConstraints, total=False):
    url: str
    version: str
    date: NotRequired[str]
    sha256: NotRequired[str]


class _UnresolvedRelease(TypedDict, total=False):
    base: str

    sublime_text: list[str]
    platforms: list[str]
    python_versions: list[str]

    version: SpecifierSet


@final
class AssetBasedRelease(_UnresolvedRelease, total=False):
    asset: list[str]


@final
class TagsBasedRelease(_UnresolvedRelease, total=False):
    tags: Literal[True] | str


ALL_BUILDS = "*"
ALL_PLATFORMS = ["*"]
ALL_MARKER = ["*"]
SUPPORTED_PLATFORMS = [
    "windows-x64",
    "windows-x32",
    "osx-x64",
    "osx-arm64",
    "linux-x64",
    "linux-arm64",
]
SUPPORTED_PYTHON_VERSIONS = ["3.3", "3.8", "3.13"]


def normalize_release_definition(definition: ReleasePartial) -> ReleaseDef:
    if "url" in definition:
        defaults = {
            "sublime_text": ALL_BUILDS,
            "platforms": SUPPORTED_PLATFORMS,
            "python_versions": SUPPORTED_PYTHON_VERSIONS
        }
        return defaults | transform(  # type: ignore[return-value]
            definition,
            ["sublime_text"],
            ["platforms", ensure_list, unpack_star(SUPPORTED_PLATFORMS)],
            ["python_versions", ensure_list, unpack_star(SUPPORTED_PYTHON_VERSIONS)],
            ["url"],
            ["version"],
            ["date"],
            ["sha256"],
        )

    if "base" in definition:
        defaults = {
            "sublime_text": [ALL_BUILDS],
            "platforms": SUPPORTED_PLATFORMS,
            "python_versions": SUPPORTED_PYTHON_VERSIONS
        }
        return defaults | transform(  # type: ignore[return-value]
            definition,
            ["sublime_text", ensure_list],
            ["platforms", ensure_list, unpack_star(SUPPORTED_PLATFORMS)],
            ["python_versions", ensure_list, unpack_star(SUPPORTED_PYTHON_VERSIONS)],
            ["base", normalize_base_url],
            ["asset", ensure_list],
            ["tags"],
            ["version", normalize_version_spec, SpecifierSet],
        )


def normalize_version_spec(specifier: str) -> str:
    specifier = specifier.strip()
    if specifier in ("*", ""):
        return ""
    if specifier[0] in "<>=!~":
        return specifier
    return f"=={specifier}"


def normalize_base_url(base: str) -> str:
    if base.startswith("pypi:"):
        _, name = base.split(":", 1)
        return f"https://pypi.org/project/{name}"
    if base.startswith("github:"):
        _, repo = base.split(":", 1)
        return f"https://github.com/{repo}"
    return base


def transform(d: Mapping, *specs) -> dict:
    rv = {}
    for s in specs:
        key, fns = s[0], s[1:]
        if key in d:
            rv[key] = pipe(d.get(key), *fns)
    return rv


def unpack_star(replacement, marker=["*"]):
    def unpack_star_(val):
        return replacement if val == marker else val
    return unpack_star_


def ensure_list[T](v: T | list[T]) -> list[T]:
    if not isinstance(v, list):
        return [v]
    return v


# FUNC UTILS


def pipe(v, *fns):
    for fn in fns:
        v = fn(v)
    return v


def lcompose(fns):
    def lcompose_(rv):
        for fn in fns:
            rv = fn(rv)
        return rv
    return lcompose_


def compose(fns):
    return lcompose(reversed(fns))


def apply(v, fn):
    return fn(v)


def pick[K, V](keys: Iterable[K], d: Mapping[K, V]) -> Mapping[K, V]:
    return {
        k: v
        for k, v in d.items()
        if k in keys
    }


def pick_and_map[K, V, Q](
    d: Mapping[K, V], keys: Iterable[K], lift: Callable[[V], Q]
) -> Mapping[K, Q]:
    return {
        k: lift(v)
        for k, v in d.items()
        if k in keys
    }


def mapval[K, V, P](mapfn: Callable[[V], P], d: Mapping[K, V]) -> Mapping[K, P]:
    return {
        k: mapfn(v)
        for k, v in d.items()
    }


def mapkey[K, V, P](mapfn: Callable[[K], P], d: Mapping[K, V]) -> Mapping[P, V]:
    return {
        mapfn(k): v
        for k, v in d.items()
    }


def filtermap[K, V](predicate: Callable[[V], bool], d: Mapping[K, V]) -> Mapping[K, V]:
    return {
        k: v
        for k, v in d.items()
        if predicate(v)
    }


def filterkey[K, V](predicate: Callable[[K], bool], d: Mapping[K, V]) -> Mapping[K, V]:
    return {
        k: v
        for k, v in d.items()
        if predicate(k)
    }
