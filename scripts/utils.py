from __future__ import annotations

from typing import Iterable, overload


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
