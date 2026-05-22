from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

FALLBACK_SUBJECT = "Update registry.json"


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    old_registry = read_registry_json(args.old)
    new_registry = read_registry_json(args.new)

    try:
        message = describe_registry_changes(old_registry, new_registry)
    except Exception:
        message = FALLBACK_SUBJECT

    print(message)
    return 0


@dataclass
class Args:
    old: str
    new: str


def parse_args(argv: list[str] | None = None) -> Args:
    parser = argparse.ArgumentParser(
        description="Describe registry changes.",
    )
    parser.add_argument("-a", "--old", required=True, help="Path to old registry JSON")
    parser.add_argument("-b", "--new", required=True, help="Path to new registry JSON")
    ns = parser.parse_args(argv)
    return Args(old=ns.old, new=ns.new)


def describe_registry_changes(
    old_registry: dict[str, Any],
    new_registry: dict[str, Any],
) -> str:
    package_changes = collect_changes(
        old_items=entity_map(old_registry, "packages"),
        new_items=entity_map(new_registry, "packages"),
        kind="package",
    )
    library_changes = collect_changes(
        old_items=entity_map(old_registry, "libraries"),
        new_items=entity_map(new_registry, "libraries"),
        kind="library",
    )
    changes = merge_changes(package_changes, library_changes)

    repositories_changed = old_registry.get("repositories") != new_registry.get("repositories")
    other_changed = strip_for_other_compare(old_registry) != strip_for_other_compare(new_registry)

    if not changes.any_changes:
        if repositories_changed or other_changed:
            return FALLBACK_SUBJECT
        return "Same."

    if changes.disappeared or other_changed:
        return FALLBACK_SUBJECT

    if changes.single_added:
        return f"Added `{changes.added[0]}`"

    if changes.single_tombstoned:
        return f"Tombstoned `{changes.tombstoned[0]}`"

    if changes.single_resurrected:
        return f"Resurrected `{changes.resurrected[0]}`"

    if changes.single_metadata_changed:
        return f"Changed metadata of `{changes.metadata_changed[0]}`"

    if changes.only_metadata_changed:
        return build_metadata_bulk_message(changes.metadata_changed)

    if changes.added or changes.tombstoned or changes.resurrected or changes.metadata_changed:
        return build_bulk_edit_message(
            added=changes.added,
            tombstoned=changes.tombstoned,
            resurrected=changes.resurrected,
            metadata_changed=changes.metadata_changed,
        )

    return FALLBACK_SUBJECT


@dataclass
class ChangeSet:
    added: list[str]
    tombstoned: list[str]
    resurrected: list[str]
    metadata_changed: list[str]
    disappeared: list[str]

    @property
    def any_changes(self) -> bool:
        return bool(
            self.added
            or self.tombstoned
            or self.resurrected
            or self.metadata_changed
            or self.disappeared
        )

    @property
    def single_added(self) -> bool:
        return self.added_only and len(self.added) == 1

    @property
    def single_tombstoned(self) -> bool:
        return self.tombstoned_only and len(self.tombstoned) == 1

    @property
    def single_resurrected(self) -> bool:
        return self.resurrected_only and len(self.resurrected) == 1

    @property
    def single_metadata_changed(self) -> bool:
        return self.only_metadata_changed and len(self.metadata_changed) == 1

    @property
    def added_only(self) -> bool:
        return bool(self.added) and not (
            self.tombstoned or self.resurrected or self.metadata_changed
        )

    @property
    def tombstoned_only(self) -> bool:
        return bool(self.tombstoned) and not (
            self.added or self.resurrected or self.metadata_changed
        )

    @property
    def resurrected_only(self) -> bool:
        return bool(self.resurrected) and not (
            self.added or self.tombstoned or self.metadata_changed
        )

    @property
    def only_metadata_changed(self) -> bool:
        return bool(self.metadata_changed) and not (
            self.added or self.tombstoned or self.resurrected
        )


def merge_changes(*changesets: ChangeSet) -> ChangeSet:
    return ChangeSet(
        added=sort_names(name for c in changesets for name in c.added),
        tombstoned=sort_names(name for c in changesets for name in c.tombstoned),
        resurrected=sort_names(name for c in changesets for name in c.resurrected),
        metadata_changed=sort_names(name for c in changesets for name in c.metadata_changed),
        disappeared=sort_names(name for c in changesets for name in c.disappeared),
    )


def read_registry_json(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def collect_changes(
    old_items: dict[str, dict[str, Any]],
    new_items: dict[str, dict[str, Any]],
    *,
    kind: str,
) -> ChangeSet:
    added: list[str] = []
    tombstoned: list[str] = []
    resurrected: list[str] = []
    metadata_changed: list[str] = []

    disappeared = [display_name(kind, name) for name in old_items.keys() - new_items.keys()]

    for name in sort_names(new_items.keys() - old_items.keys()):
        display = display_name(kind, name)
        if is_tombstoned(new_items[name]):
            tombstoned.append(display)
        else:
            added.append(display)

    for name in sort_names(old_items.keys() & new_items.keys()):
        old_entry = old_items[name]
        new_entry = new_items[name]
        display = display_name(kind, name)
        old_tombstoned = is_tombstoned(old_entry)
        new_tombstoned = is_tombstoned(new_entry)

        if old_tombstoned and not new_tombstoned:
            resurrected.append(display)
            continue

        if not old_tombstoned and new_tombstoned:
            tombstoned.append(display)
            continue

        if old_entry != new_entry:
            metadata_changed.append(display)

    return ChangeSet(
        added=sort_names(added),
        tombstoned=sort_names(tombstoned),
        resurrected=sort_names(resurrected),
        metadata_changed=sort_names(metadata_changed),
        disappeared=sort_names(disappeared),
    )


def entity_map(registry: dict[str, Any], key: str) -> dict[str, dict[str, Any]]:
    entries = registry.get(key, [])
    return {
        entry["name"]: entry
        for entry in entries
    }


def strip_for_other_compare(registry: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in registry.items()
        if key not in {"packages", "libraries", "repositories"}
    }


def build_metadata_bulk_message(metadata_changed: list[str]) -> str:
    lines = [
        "Metadata bulk edit",
        "",
        "Record metadata edits of the following packages:",
        *[f"- {name}" for name in metadata_changed],
    ]
    return "\n".join(lines)


def build_bulk_edit_message(
    *,
    added: list[str],
    tombstoned: list[str],
    resurrected: list[str],
    metadata_changed: list[str],
) -> str:
    sections: list[str] = [bulk_edit_subject(
        added=added,
        tombstoned=tombstoned,
        resurrected=resurrected,
        metadata_changed=metadata_changed,
    )]

    if added:
        sections.extend([
            "",
            "Record addition of following packages:",
            *[f"- {name}" for name in added],
        ])

    if tombstoned:
        sections.extend([
            "",
            "Record tombstoning the following packages:",
            *[f"- {name}" for name in tombstoned],
        ])

    if resurrected:
        sections.extend([
            "",
            "Record resurrection of the following packages:",
            *[f"- {name}" for name in resurrected],
        ])

    if metadata_changed:
        sections.extend([
            "",
            "Record metadata edit of the following packages:",
            *[f"- {name}" for name in metadata_changed],
        ])

    return "\n".join(sections)


def bulk_edit_subject(
    *,
    added: list[str],
    tombstoned: list[str],
    resurrected: list[str],
    metadata_changed: list[str],
) -> str:
    if added and not (tombstoned or resurrected or metadata_changed):
        return "Bulk additions"
    if tombstoned and not (added or resurrected or metadata_changed):
        return "Bulk removals"
    return "Bulk edit"


def sort_names(names: Any) -> list[str]:
    return sorted(names, key=str.casefold)


def display_name(kind: str, name: str) -> str:
    if kind == "library":
        return f"{name} (library)"
    return name


def is_tombstoned(entry: dict[str, Any]) -> bool:
    return "removed" in entry


if __name__ == "__main__":
    raise SystemExit(main())
