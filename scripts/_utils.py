from __future__ import annotations
from itertools import chain
import hashlib
import json
import os
import re
import sys
from urllib.parse import urljoin

from datetime import datetime, timedelta, timezone
from typing import Callable, Iterable, Iterator, Mapping, NamedTuple, Optional, overload

import inflect


def err(*args, **kwargs):
    print(*args, **kwargs, file=sys.stderr)


def write_json(
    path: str | os.PathLike[str],
    data,
    *,
    pretty: bool = False,
    ensure_ascii: bool = False
) -> None:
    with open(os.fspath(path), "w", encoding="utf-8") as f:
        if pretty:
            json.dump(data, f, indent=2, ensure_ascii=ensure_ascii)
        else:
            json.dump(data, f, separators=(",", ":"), ensure_ascii=ensure_ascii)


# FUNC UTILS


def flatten[T](list_of_lists: Iterable[Iterable[T]]) -> Iterable[T]:
    """Flatten a list of lists into a single list."""
    return chain.from_iterable(list_of_lists)


def unique_values_preserving_order[T](values: Iterable[T]) -> list[T]:
    return list(dict.fromkeys(values))


_INFLECT = inflect.engine()


def pl(count: int, word: str) -> str:
    match word:
        case "are":
            singular = "is"
        case "have":
            singular = "has"
        case _:
            singular = _INFLECT.singular_noun(word) or word
    return f"{count} {_INFLECT.plural(singular, count)}"


def format_name_list(names: list[str]) -> str:
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return f"{', '.join(names[:-1])}, and {names[-1]}"


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
        k: d[k]
        for k in keys
        if k in d
    }


def pick_and_map[K, V, Q](
    d: Mapping[K, V], keys: Iterable[K], lift: Callable[[V], Q]
) -> Mapping[K, Q]:
    return {
        k: lift(d[k])
        for k in keys
        if k in d
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


@overload
def drop_falsy[K, V](it: dict[K, V | None]) -> dict[K, V]: ...  # noqa: E704
@overload
def drop_falsy[T](it: list[T | None]) -> list[T]: ...  # noqa: E704
@overload
def drop_falsy[T](it: tuple[T | None, ...]) -> tuple[T, ...]: ...  # noqa: E704
@overload
def drop_falsy[T](it: set[T | None]) -> set[T]: ...  # noqa: E704
@overload
def drop_falsy[T](it: Iterable[T | None]) -> Iterable[T]: ...  # noqa: E704

def drop_falsy[T](it: Iterable[T | None]) -> Iterable[T]:  # noqa: E302
    """
    Drop falsy values (None, False, 0, '', etc.) from an iterable.
    Preserve the container type.
    """
    if isinstance(it, dict):
        return {
            k: v for k, v in it.items() if v
        }

    rv = filter(None, it)
    if isinstance(it, list):
        return list(rv)
    elif isinstance(it, tuple):
        return tuple(rv)
    elif isinstance(it, set):
        return set(rv)
    return rv


#


def resolve_urls(root_url: str, uris: list[str]) -> Iterator[str]:
    """
    Convert a list of relative uri's to absolute urls/paths.

    :param root_url:
        The root url string

    :param uris:
        An iterable of relative uri's to resolve.

    :returns:
        A generator of resolved URLs
    """

    scheme_match = re.match(r'^(file:/|https?:)//', root_url, re.I)

    for url in uris:
        if not url:
            continue
        if url.startswith('//'):
            if scheme_match is not None:
                url = scheme_match.group(1) + url
            else:
                url = 'https:' + url
        elif url.startswith('/'):
            # We don't allow absolute repositories
            continue
        elif url.startswith('./') or url.startswith('../'):
            url = urljoin(root_url, url)
        yield url


def resolve_url(root_url: str, url: str) -> str:
    return next(resolve_urls(root_url, [url]))


def update_url(url: str) -> str:
    if not url:
        return url
    url = url.replace('://raw.github.com/', '://raw.githubusercontent.com/')
    url = url.replace('://nodeload.github.com/', '://codeload.github.com/')
    url = re.sub(
        r'^(https://codeload\.github\.com/[^/#?]+/[^/#?]+/)zipball(/.*)$',
        '\\1zip\\2',
        url
    )
    if url in {
        'https://sublime.wbond.net/repositories.json',
        'https://sublime.wbond.net/channel.json',
    }:
        url = 'https://packagecontrol.io/channel_v3.json'
    return url


UTC_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def normalize_tz_aware_datetime(value: str) -> str:
    if not value:
        return value
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt.astimezone(timezone.utc).strftime(UTC_FORMAT)


class VersionInfo(NamedTuple):
    major: int
    minor: int
    patch: int
    prerelease: Optional[str]
    build: Optional[str]

    @property
    def is_final(self) -> bool:
        return self.prerelease is None and self.build is None

    @property
    def is_prerelease(self) -> bool:
        return self.prerelease is not None


SEMVER_RE = re.compile(
    r'^'
    r'(0|[1-9]\d*)\.'                     # major
    r'(0|[1-9]\d*)\.'                     # minor
    r'(0|[1-9]\d*)'                       # patch
    r'(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?'   # pre-release
    r'(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?'  # build metadata
    r'$'
)


def parse_version(s: str) -> Optional[VersionInfo]:
    m = SEMVER_RE.match(s)
    if not m:
        return None
    major, minor, patch, prerelease, build = m.groups()
    return VersionInfo(
        int(major),
        int(minor),
        int(patch),
        prerelease,
        build
    )


def is_semver(s: str) -> bool:
    return parse_version(s) is not None


def parse_sublime_text_max(selector: object) -> float:
    if not isinstance(selector, str):
        return float("inf")

    s = re.sub(r"\s+", "", selector)
    if s in ("", "*"):
        return float("inf")

    range_index = s.find("-")
    if range_index != -1:
        right = s[range_index + 1:]
        n = parse_int_prefix(right)
        return float(n) if n is not None else float("inf")

    if s.startswith("<="):
        n = parse_int_prefix(s[2:])
        return float(n) if n is not None else float("inf")

    if s.startswith("<"):
        n = parse_int_prefix(s[1:])
        return float(max(0, n - 1)) if n is not None else float("inf")

    if s.startswith(">=") or s.startswith(">"):
        return float("inf")

    n = parse_int_prefix(s)
    return float(n) if n is not None else float("inf")


def parse_int_prefix(text: str) -> int | None:
    if match := re.match(r"^\d+", text):
        return int(match.group(0))
    return None


SECONDS_PER_DAY = 24 * 60 * 60


def next_run(
    name: str,
    *,
    window: timedelta = timedelta(days=1),
    now: datetime | None = None,
    seed: bytes = b""
) -> datetime:
    """
    Next run time: the next occurrence of that task's window time-of-day (UTC).
    """
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        raise ValueError("now must be timezone-aware")

    window_seconds = int(window.total_seconds())
    if window_seconds <= 0:
        raise ValueError("window must be > 0")

    offset = map_name_to_range(name, upper_bound=window_seconds, seed=seed)
    epoch_seconds = int(now.timestamp())
    window_start = epoch_seconds - (epoch_seconds % window_seconds)
    candidate = datetime.fromtimestamp(window_start, tz=timezone.utc) + timedelta(seconds=offset)

    if candidate <= now:
        candidate += timedelta(seconds=window_seconds)

    return candidate


def next_run_in_a_day(name: str, *, now: datetime | None = None, seed: bytes = b"") -> datetime:
    """
    Next run time: the next occurrence of that task's daily time-of-day (UTC).
    """
    return next_run(name, window=timedelta(days=1), now=now, seed=seed)


def map_name_to_range(
    name: str,
    *,
    upper_bound: int = SECONDS_PER_DAY,
    seed: bytes = b""
) -> int:
    """
    Stable mapping: name -> [0, upper_bound).
    - name: unique task identifier (e.g. "Advanced CSV")
    - seed: optional global salt/seed to decouple from plain hashing
    """
    if upper_bound <= 0:
        raise ValueError("upper_bound must be > 0")

    h = hashlib.blake2s(digest_size=8, key=seed)  # 64-bit output
    h.update(name.encode("utf-8"))
    x = int.from_bytes(h.digest(), "big")         # 0..2^64-1

    # Map to range with *minimal* modulo bias using multiply-high:
    # floor(x * upper_bound / 2^64)
    return (x * upper_bound) >> 64
