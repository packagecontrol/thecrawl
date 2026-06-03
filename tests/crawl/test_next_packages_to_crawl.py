from scripts.crawl import next_packages_to_crawl


def test_next_packages_to_crawl_skips_removed_entries(set_now):
    set_now("2026-03-26T00:00:00Z")

    registry = {
        "packages": [
            make_registry_entry("Alive"),
            make_registry_entry("Gone", removed="2025-01-01T00:00:00Z"),
        ]
    }
    workspace = {"packages": {}, "libraries": {}}

    result = next_packages_to_crawl(registry, workspace, limit=200, presto=False)

    assert [entry["name"] for entry in result] == ["Alive"]


def test_next_packages_to_crawl_skips_removed_entries_in_presto_mode(set_now):
    set_now("2026-03-26T00:00:00Z")

    registry = {
        "packages": [
            make_registry_entry("Alive"),
            make_registry_entry("Gone", removed="2025-01-01T00:00:00Z"),
        ]
    }
    workspace = {
        "packages": {
            "Alive": {"name": "Alive", "last_seen": "2026-03-25T23:00:00Z"},
            "Gone": {"name": "Gone", "last_seen": "2026-03-25T22:00:00Z"},
        },
        "libraries": {},
    }

    result = next_packages_to_crawl(registry, workspace, limit=200, presto=True)

    assert [entry["name"] for entry in result] == ["Alive"]


def test_next_packages_to_crawl_prioritizes_new_packages_then_oldest_due(set_now):
    set_now("2026-03-26T00:00:00Z")

    registry = {
        "packages": [
            make_registry_entry("RecentlyDue"),
            make_registry_entry("NeverCrawled"),
            make_registry_entry("LongOverdue"),
        ]
    }
    workspace = {
        "packages": {
            "RecentlyDue": {
                "name": "RecentlyDue",
                "next_crawl": "2026-03-25T23:00:00Z",
            },
            "LongOverdue": {
                "name": "LongOverdue",
                "next_crawl": "2026-03-25T00:00:00Z",
            },
        },
        "libraries": {},
    }

    result = next_packages_to_crawl(registry, workspace, limit=2, presto=False)

    assert [entry["name"] for entry in result] == ["NeverCrawled", "LongOverdue"]


def test_next_package_hint_ignores_removed_entries(set_now, capsys):
    set_now("2026-03-26T00:00:00Z")

    registry = {
        "packages": [
            make_registry_entry("Gone", removed="2025-01-01T00:00:00Z"),
            make_registry_entry("Alive"),
        ]
    }
    workspace = {
        "packages": {
            "Gone": {"name": "Gone", "next_crawl": "2026-03-26T00:01:00Z"},
            "Alive": {"name": "Alive", "next_crawl": "2026-03-26T00:10:00Z"},
        },
        "libraries": {},
    }

    result = next_packages_to_crawl(registry, workspace, limit=200, presto=False)

    assert result == []
    out = capsys.readouterr().out
    assert "Next package runs in 10 minutes." in out


def make_registry_entry(name: str, removed: str | None = None):
    entry = {
        "name": name,
        "details": f"https://github.com/example/{name.lower()}",
        "releases": [{"sublime_text": "*", "branch": True}],
        "source": "https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json",
        "schema_version": "3.0.0",
    }
    if removed:
        entry["removed"] = removed
    return entry
