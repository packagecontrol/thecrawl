import scripts.describe_registry_changes as describe_script


def test_describe_registry_changes_same() -> None:
    old = {"packages": [pkg("A")]}
    new = {"packages": [pkg("A")]}

    assert describe_script.describe_registry_changes(old, new) == "Same."


def test_describe_registry_changes_single_added() -> None:
    old = {"packages": []}
    new = {"packages": [pkg("Gloom")]}

    assert describe_script.describe_registry_changes(old, new) == "Added `Gloom`"


def test_describe_registry_changes_single_tombstoned() -> None:
    old = {"packages": [pkg("Gloom")]}
    new = {"packages": [pkg("Gloom", removed="2026-01-01T00:00:00Z")]}

    assert describe_script.describe_registry_changes(old, new) == "Tombstoned `Gloom`"


def test_describe_registry_changes_bulk_additions() -> None:
    old = {"packages": []}
    new = {"packages": [pkg("Gloom"), pkg("Terminus")]}

    assert describe_script.describe_registry_changes(old, new) == (
        "Bulk additions\n\n"
        "Record addition of following packages:\n"
        "- Gloom\n"
        "- Terminus"
    )


def test_describe_registry_changes_bulk_removals() -> None:
    old = {"packages": [pkg("Gloom"), pkg("Terminus")]}
    new = {
        "packages": [
            pkg("Gloom", removed="2026-01-01T00:00:00Z"),
            pkg("Terminus", removed="2026-01-01T00:00:00Z"),
        ]
    }

    assert describe_script.describe_registry_changes(old, new) == (
        "Bulk removals\n\n"
        "Record tombstoning the following packages:\n"
        "- Gloom\n"
        "- Terminus"
    )


def test_describe_registry_changes_single_resurrected() -> None:
    old = {"packages": [pkg("Gloom", removed="2026-01-01T00:00:00Z")]}
    new = {"packages": [pkg("Gloom")]}

    assert describe_script.describe_registry_changes(old, new) == "Resurrected `Gloom`"


def test_describe_registry_changes_single_metadata_change() -> None:
    old = {"packages": [pkg("Gloom", labels=["theme"])]}
    new = {"packages": [pkg("Gloom", labels=["theme", "dark"])]}

    assert describe_script.describe_registry_changes(old, new) == "Changed metadata of `Gloom`"


def test_describe_registry_changes_single_added_library() -> None:
    old = {"packages": [], "libraries": []}
    new = {"packages": [], "libraries": [lib("JsonSchema")]}

    assert describe_script.describe_registry_changes(old, new) == "Added `JsonSchema (library)`"


def test_describe_registry_changes_mixed_package_and_library_bulk_edit() -> None:
    old = {
        "packages": [pkg("DropMe")],
        "libraries": [lib("JsonSchema", removed="2026-01-01T00:00:00Z")],
    }
    new = {
        "packages": [pkg("DropMe", removed="2026-01-01T00:00:00Z")],
        "libraries": [lib("JsonSchema")],
    }

    assert describe_script.describe_registry_changes(old, new) == (
        "Bulk edit\n\n"
        "Record tombstoning the following packages:\n"
        "- DropMe\n\n"
        "Record resurrection of the following packages:\n"
        "- JsonSchema (library)"
    )


def test_describe_registry_changes_metadata_bulk_edit() -> None:
    old = {
        "packages": [
            pkg("A", labels=["x"]),
            pkg("B", labels=["x"]),
        ]
    }
    new = {
        "packages": [
            pkg("A", labels=["x", "y"]),
            pkg("B", labels=["x", "y"]),
        ]
    }

    assert describe_script.describe_registry_changes(old, new) == (
        "Metadata bulk edit\n\n"
        "Record metadata edits of the following packages:\n"
        "- A\n"
        "- B"
    )


def test_describe_registry_changes_bulk_edit() -> None:
    old = {
        "packages": [
            pkg("DropMe"),
            pkg("Meta", labels=["a"]),
        ]
    }
    new = {
        "packages": [
            pkg("DropMe", removed="2026-01-01T00:00:00Z"),
            pkg("Meta", labels=["a", "b"]),
            pkg("NewPkg"),
        ]
    }

    assert describe_script.describe_registry_changes(old, new) == (
        "Bulk edit\n\n"
        "Record addition of following packages:\n"
        "- NewPkg\n\n"
        "Record tombstoning the following packages:\n"
        "- DropMe\n\n"
        "Record metadata edit of the following packages:\n"
        "- Meta"
    )


def test_describe_registry_changes_falls_back_when_package_disappears() -> None:
    old = {"packages": [pkg("A")]}
    new = {"packages": []}

    assert describe_script.describe_registry_changes(old, new) == "Update registry.json"


def test_describe_registry_changes_falls_back_when_only_repositories_change() -> None:
    old = {
        "repositories": ["https://raw.githubusercontent.com/a/repository.json"],
        "packages": [pkg("A")],
        "libraries": [lib("L")],
    }
    new = {
        "repositories": ["https://raw.githubusercontent.com/b/repository.json"],
        "packages": [pkg("A")],
        "libraries": [lib("L")],
    }

    assert describe_script.describe_registry_changes(old, new) == "Update registry.json"


def test_describe_registry_changes_bulk_resurrection() -> None:
    old = {
        "packages": [
            pkg("A", removed="2026-01-01T00:00:00Z"),
            pkg("B", removed="2026-01-01T00:00:00Z"),
        ]
    }
    new = {"packages": [pkg("A"), pkg("B")]}

    assert describe_script.describe_registry_changes(old, new) == (
        "Bulk edit\n\n"
        "Record resurrection of the following packages:\n"
        "- A\n"
        "- B"
    )


def test_describe_registry_changes_bulk_edit_with_resurrection_and_other_changes() -> None:
    old = {
        "packages": [
            pkg("OldGone", removed="2026-01-01T00:00:00Z"),
            pkg("KeepMeta", labels=["a"]),
        ]
    }
    new = {
        "packages": [
            pkg("OldGone"),
            pkg("KeepMeta", labels=["a", "b"]),
            pkg("NewPkg"),
        ]
    }

    assert describe_script.describe_registry_changes(old, new) == (
        "Bulk edit\n\n"
        "Record addition of following packages:\n"
        "- NewPkg\n\n"
        "Record resurrection of the following packages:\n"
        "- OldGone\n\n"
        "Record metadata edit of the following packages:\n"
        "- KeepMeta"
    )


def test_main_reads_both_registries_via_loader_and_prints_message(capsys, monkeypatch) -> None:
    old = {"packages": []}
    new = {"packages": [pkg("Gloom")]}

    def fake_read(path: str):
        if path == "old_registry.json":
            return old
        if path == "new_registry.json":
            return new
        raise AssertionError(path)

    monkeypatch.setattr(describe_script, "read_registry_json", fake_read)

    rc = describe_script.main(["-a", "old_registry.json", "-b", "new_registry.json"])

    assert rc == 0
    assert capsys.readouterr().out.strip() == "Added `Gloom`"


def test_main_falls_back_when_classifier_crashes(capsys, monkeypatch) -> None:
    monkeypatch.setattr(describe_script, "read_registry_json", lambda path: {"packages": []})

    def boom(old_registry, new_registry):
        raise RuntimeError("boom")

    monkeypatch.setattr(describe_script, "describe_registry_changes", boom)

    rc = describe_script.main(["-a", "old_registry.json", "-b", "new_registry.json"])

    assert rc == 0
    assert capsys.readouterr().out.strip() == "Update registry.json"


def pkg(
    name: str,
    *,
    removed: str | None = None,
    labels: list[str] | None = None,
) -> dict[str, object]:
    entry: dict[str, object] = {
        "name": name,
        "source": "https://raw.githubusercontent.com/sublimehq/package_control_channel/refs/heads/master/repository.json",
        "schema_version": "3.0.0",
        "releases": [{"url": f"https://example.com/{name}.zip", "date": "2026-01-01T00:00:00Z"}],
    }
    if removed is not None:
        entry["removed"] = removed
    if labels is not None:
        entry["labels"] = labels
    return entry


def lib(name: str, *, removed: str | None = None) -> dict[str, object]:
    entry: dict[str, object] = {
        "name": name,
        "source": "https://raw.githubusercontent.com/sublimehq/package_control_channel/refs/heads/master/repository.json",
        "schema_version": "4.0.0",
        "releases": [{"version": "1.0.0"}],
    }
    if removed is not None:
        entry["removed"] = removed
    return entry
