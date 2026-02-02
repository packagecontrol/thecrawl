import json

from scripts.generate_channel import main, normalize_library, normalize_package


def test_generate_channel_filters_removed_and_dropped_packages(tmp_path):
    registry = {
        "repositories": [
            "https://repo.one",
            "https://repo.two",
        ]
    }
    workspace = {
        "packages": {
            "valid": {
                "name": "Alpha",
                "author": ["Ada"],
                "last_modified": "2024-03-20T01:02:03Z",
                "source": "https://repo.one",
                "releases": [
                    {
                        "sublime_text": "4100",
                        "platforms": ["*"],
                        "version": "1.0.0",
                        "url": "https://repo.one/alpha.zip",
                        "date": "2024-03-20T01:02:03Z",
                    }
                ],
            },
            "removed": {
                "name": "Removed",
                "removed": True,
                "source": "https://repo.two",
            },
            "fatal": {
                "name": "Fatal",
                "fail_reason": "fatal: no repo",
                "source": "https://repo.two",
            },
            "dropped": {
                "name": "Dropped",
                "author": ["Missing Releases"],
                "last_modified": "2024-03-20T01:02:03Z",
                "source": "https://repo.two",
                "releases": [],
            },
        },
        "libraries": {},
    }

    registry_path = tmp_path / "registry.json"
    workspace_path = tmp_path / "workspace.json"
    output_path = tmp_path / "channel.json"

    registry_path.write_text(json.dumps(registry), encoding="utf-8")
    workspace_path.write_text(json.dumps(workspace), encoding="utf-8")

    main(str(registry_path), str(workspace_path), str(output_path), False, False)

    channel = json.loads(output_path.read_text(encoding="utf-8"))
    assert channel["repositories"] == ["https://repo.one"]
    assert list(channel["packages_cache"].keys()) == ["https://repo.one"]
    assert [pkg["name"] for pkg in channel["packages_cache"]["https://repo.one"]] == [
        "Alpha"
    ]


def test_generate_channel_filters_removed_and_dropped_libraries(tmp_path):
    registry = {
        "repositories": [
            "https://repo.one",
            "https://repo.two",
        ]
    }
    workspace = {
        "packages": {},
        "libraries": {
            "valid": {
                "name": "Lib",
                "source": "https://repo.one",
                "releases": [
                    {
                        "sublime_text": "4100",
                        "platforms": ["*"],
                        "python_versions": ["3.8"],
                        "version": "1.0.0",
                        "url": "https://repo.one/lib.whl",
                        "date": "2024-01-02T03:04:05Z",
                    }
                ],
            },
            "removed": {
                "name": "RemovedLib",
                "removed": True,
                "source": "https://repo.two",
            },
            "dropped": {
                "name": "DroppedLib",
                "source": "https://repo.two",
                "releases": [],
            },
        },
    }

    registry_path = tmp_path / "registry.json"
    workspace_path = tmp_path / "workspace.json"
    output_path = tmp_path / "channel.json"

    registry_path.write_text(json.dumps(registry), encoding="utf-8")
    workspace_path.write_text(json.dumps(workspace), encoding="utf-8")

    main(str(registry_path), str(workspace_path), str(output_path), False, False)

    channel = json.loads(output_path.read_text(encoding="utf-8"))
    assert channel["repositories"] == ["https://repo.one"]
    assert list(channel["libraries_cache"].keys()) == ["https://repo.one"]
    assert [lib["name"] for lib in channel["libraries_cache"]["https://repo.one"]] == [
        "Lib"
    ]


def test_normalize_package_formats_fields_and_defaults():
    pkg = {
        "name": "Example",
        "author": "Ada",
        "last_modified": "2024-03-22T12:13:14Z",
        "source": "https://repo.example",
        "details": "https://details.example",
        "releases": [
            {
                "sublime_text": "4100",
                "platforms": ["*"],
                "version": "1.0.0",
                "url": "https://repo.example/example.zip",
                "date": "2024-03-22T12:13:14Z",
                "extra": "drop",
            },
            {
                "sublime_text": "4100",
                "platforms": ["*"],
                "version": "1.0.1",
                "date": "2024-03-23T12:13:14Z",
            },
        ],
        "extra_field": "drop",
    }

    normalized = normalize_package(pkg)

    assert normalized == {
        "name": "Example",
        "author": ["Ada"],
        "last_modified": "2024-03-22 12:13:14",
        "releases": [
            {
                "sublime_text": "4100",
                "platforms": ["*"],
                "version": "1.0.0",
                "url": "https://repo.example/example.zip",
                "date": "2024-03-22 12:13:14",
            }
        ],
        "homepage": "https://details.example",
        "description": None,
        "previous_names": [],
        "labels": [],
        "readme": None,
        "issues": None,
        "donate": None,
        "buy": None,
    }


def test_normalize_package_compresses_versions_by_build_and_platform():
    pkg = {
        "name": "Monokai Pro",
        "author": ["Monokai"],
        "last_modified": "2026-01-11T10:00:00Z",
        "source": "https://repo.example",
        "releases": [
            {
                "sublime_text": ">=3000",
                "platforms": ["*"],
                "version": "2.0.3",
                "url": "https://repo.example/2.0.3.zip",
                "date": "2024-12-04T14:00:00Z",
            },
            {
                "sublime_text": ">=3000",
                "platforms": ["*"],
                "version": "2.0.6",
                "url": "https://repo.example/2.0.6.zip",
                "date": "2025-01-15T13:30:00Z",
            },
            {
                "sublime_text": ">=4050",
                "platforms": ["*"],
                "version": "2.1.5",
                "url": "https://repo.example/2.1.5.zip",
                "date": "2025-12-17T10:00:00Z",
            },
            {
                "sublime_text": ">=4050",
                "platforms": ["*"],
                "version": "2.1.6",
                "url": "https://repo.example/2.1.6.zip",
                "date": "2026-01-07T10:00:00Z",
            },
            {
                "sublime_text": ">=4050",
                "platforms": ["*"],
                "version": "2.2.0-rc1",
                "url": "https://repo.example/2.2.0-rc1.zip",
                "date": "2026-01-10T10:00:00Z",
            },
        ],
    }

    normalized = normalize_package(pkg)

    versions = sorted(rel["version"] for rel in normalized["releases"])
    assert versions == ["2.0.6", "2.1.6", "2.2.0-rc1"]


def test_normalize_package_drops_prerelease_older_than_final():
    pkg = {
        "name": "Example",
        "author": ["Ada"],
        "last_modified": "2024-03-22T12:13:14Z",
        "source": "https://repo.example",
        "releases": [
            {
                "sublime_text": ">=4100",
                "platforms": ["*"],
                "version": "1.0.0-rc1",
                "url": "https://repo.example/1.0.0-rc1.zip",
                "date": "2024-03-20T12:13:14Z",
            },
            {
                "sublime_text": ">=4100",
                "platforms": ["*"],
                "version": "1.0.0",
                "url": "https://repo.example/1.0.0.zip",
                "date": "2024-03-21T12:13:14Z",
            },
        ],
    }

    normalized = normalize_package(pkg)

    versions = [rel["version"] for rel in normalized["releases"]]
    assert versions == ["1.0.0"]


def test_normalize_package_handles_non_semver_release():
    pkg = {
        "name": "Repeat Macro",
        "author": ["Siva"],
        "last_modified": "2018-05-27T17:41:14Z",
        "source": "https://repo.example",
        "releases": [
            {
                "sublime_text": "*",
                "platforms": ["*"],
                "version": "2018.05.27.17.41.14",
                "url": "https://repo.example/repeat-macro.zip",
                "date": "2018-05-27 17:41:14",
            }
        ],
    }

    normalized = normalize_package(pkg)

    assert [rel["version"] for rel in normalized["releases"]] == [
        "2018.05.27.17.41.14"
    ]


def test_normalize_library_formats_release_dates_and_pick_fields():
    lib = {
        "name": "Lib",
        "author": "Bob",
        "description": "Library description",
        "homepage": "https://lib.example",
        "issues": "https://lib.example/issues",
        "releases": [
            {
                "sublime_text": "4100",
                "platforms": ["*"],
                "python_versions": ["3.11"],
                "version": "2.0.0",
                "url": "https://lib.example/lib.whl",
                "date": "2024-02-02T03:04:05Z",
                "sha256": "hash",
                "extra": "drop",
            }
        ],
        "extra_field": "drop",
    }

    normalized = normalize_library(lib)

    assert normalized == {
        "name": "Lib",
        "author": "Bob",
        "description": "Library description",
        "homepage": "https://lib.example",
        "issues": "https://lib.example/issues",
        "releases": [
            {
                "sublime_text": "4100",
                "platforms": ["*"],
                "python_versions": ["3.11"],
                "version": "2.0.0",
                "url": "https://lib.example/lib.whl",
                "date": "2024-02-02 03:04:05",
                "sha256": "hash",
            }
        ],
    }
