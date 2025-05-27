from __future__ import annotations
import re
import sys
from urllib.parse import urljoin

from typing import Iterable, Iterator, overload


def err(*args, **kwargs):
    print(*args, **kwargs, file=sys.stderr)


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


SEMVER_RE = re.compile(
    r'^'
    r'(0|[1-9]\d*)\.'                     # major
    r'(0|[1-9]\d*)\.'                     # minor
    r'(0|[1-9]\d*)'                       # patch
    r'(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?'   # pre-release
    r'(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?'  # build metadata
    r'$'
)


def is_semver(s: str) -> bool:
    return bool(SEMVER_RE.match(s))
