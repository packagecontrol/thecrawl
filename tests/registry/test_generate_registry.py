import json
from datetime import datetime
from pathlib import Path

import pytest

from scripts.generate_registry import main


@pytest.fixture(autouse=True)
def patch_http_get(monkeypatch):
    """
    Patch generate_registry.http_get to support file:// URLs for all tests.
    """
    from scripts import generate_registry

    async def fake_http_get(location, session):
        if location.startswith("file://"):
            path = Path.from_uri(location)
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        raise RuntimeError("Only file:// URLs are supported in this test")
    monkeypatch.setattr(generate_registry, "http_get", fake_http_get)


def make_channel(path: Path, repositories: list[Path]):
    channel_data = {
        "schema_version": "3.0.0",
        "repositories": list(map(lambda r: r.as_uri(), repositories))
    }
    path.write_text(json.dumps(channel_data))


def make_repository(
    path: Path,
    package_names: list[str],
    *,
    library_names: list[str] | None = None,
):
    repo_data = {
        "schema_version": "3.0.0",
        "packages": [
            {
                "name": name,
                "details": f"https://github.com/example/{name}",
            }
            for name in package_names
        ],
        "libraries": [
            {
                "name": name,
            }
            for name in (library_names or [])
        ],
    }
    path.write_text(json.dumps(repo_data))


@pytest.mark.asyncio
async def test_main_with_fake_channel(tmp_path):
    # Create a fake channel file
    channel_path = tmp_path / "channel.json"
    repo_path = tmp_path / "repo1.json"
    make_channel(channel_path, [repo_path])

    # Create a fake repo file
    make_repository(repo_path, ["TestPackage"])

    # Output file
    output_file = tmp_path / "output.json"

    # Call main with the file channel
    await main(str(output_file), [channel_path.as_uri()])

    # Check output file exists and contents
    assert output_file.exists()
    with output_file.open() as f:
        result = json.load(f)
    assert "packages" in result
    assert result["packages"][0] == {
        "source": repo_path.as_uri(),
        "schema_version": "3.0.0",
        "name": "TestPackage",
        "details": "https://github.com/example/TestPackage",
    }


@pytest.mark.asyncio
async def test_main_with_two_repos_order_preserved(tmp_path):
    # Create two fake repo files
    repo1_path = tmp_path / "repo1.json"
    repo2_path = tmp_path / "repo2.json"
    make_repository(repo1_path, ["FirstPackage"])
    make_repository(repo2_path, ["SecondPackage"])

    # Create a channel file with both repos, in order
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo1_path, repo2_path])

    # Output file
    output_file = tmp_path / "output.json"

    # Call main with the file channel
    await main(str(output_file), [channel_path.as_uri()])

    # Check output file exists and contents
    assert output_file.exists()
    with output_file.open() as f:
        result = json.load(f)
    assert "packages" in result
    names = [pkg["name"] for pkg in result["packages"]]
    # Ensure both packages are present and order is preserved
    assert names == ["FirstPackage", "SecondPackage"]


@pytest.mark.asyncio
async def test_main_with_duplicate_package_rejected(tmp_path, capsys):
    # Create two repo files, both with the same package name
    repo1_path = tmp_path / "repo1.json"
    repo2_path = tmp_path / "repo2.json"
    make_repository(repo1_path, ["DuplicatePackage"])
    make_repository(repo2_path, ["DuplicatePackage"])

    # Create a channel file with both repos
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo1_path, repo2_path])

    # Output file
    output_file = tmp_path / "output.json"

    # Call main with the file channel
    await main(str(output_file), [channel_path.as_uri()])

    # Check output file exists and contents
    assert output_file.exists()
    with output_file.open() as f:
        result = json.load(f)
    # Only one package should be present
    names = [pkg["name"] for pkg in result["packages"]]
    assert names.count("DuplicatePackage") == 1

    # Check that an error message was printed to stderr
    captured = capsys.readouterr()
    expected_msg = f"Package DuplicatePackage from {repo2_path.as_uri()} already seen, skipping"
    assert expected_msg in captured.err


@pytest.mark.asyncio
async def test_main_with_failing_repo_logs_error(tmp_path, capsys):
    # Create a channel with one repo that does not exist
    repo_path = tmp_path / "nonexistent.json"
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])
    output_file = tmp_path / "output.json"

    # Call main, expect error message
    await main(str(output_file), [channel_path.as_uri()])
    captured = capsys.readouterr()
    expected_msg = f"Error fetching {repo_path.as_uri()}:"
    assert expected_msg in captured.err


@pytest.mark.asyncio
async def test_main_with_failing_repo_and_last_run_sets_fetching_source_failed(tmp_path):
    # Simulate previous run's package db with a package missing a failure marker
    repo_path = tmp_path / "nonexistent.json"
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])
    output_file = tmp_path / "output.json"
    # Write previous db with a package missing fetching_source_failed
    prev_db = {
        "repositories": [repo_path.as_uri()],
        "packages": [{
            "source": repo_path.as_uri(),
            "schema_version": "3.0.0",
            "name": "LostPackage",
            "details": "https://github.com/example/LostPackage"
        }],
        "libraries": []
    }
    output_file.write_text(json.dumps(prev_db))

    # Call main with previous db present
    await main(str(output_file), [channel_path.as_uri()])
    with output_file.open() as f:
        result = json.load(f)
    # Package should survive and be marked as failed with a timestamp
    failed_at = result["packages"][0]["fetching_source_failed"]
    datetime.strptime(failed_at, "%Y-%m-%dT%H:%M:%SZ")


@pytest.mark.asyncio
async def test_main_with_failing_repo_preserves_fetching_source_failed_timestamp(tmp_path):
    # Simulate previous run's package db with an existing failure timestamp
    repo_path = tmp_path / "nonexistent.json"
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])
    output_file = tmp_path / "output.json"
    prev_db = {
        "repositories": [repo_path.as_uri()],
        "packages": [{
            "source": repo_path.as_uri(),
            "schema_version": "3.0.0",
            "name": "LostPackage",
            "details": "https://github.com/example/LostPackage",
            "fetching_source_failed": "2024-01-01T00:00:00Z"
        }],
        "libraries": []
    }
    output_file.write_text(json.dumps(prev_db))

    # Call main with previous db present
    await main(str(output_file), [channel_path.as_uri()])
    with output_file.open() as f:
        result = json.load(f)
    assert result["packages"][0]["fetching_source_failed"] == "2024-01-01T00:00:00Z"


@pytest.mark.asyncio
async def test_main_with_successful_repo_and_last_run_clears_fetching_source_failed(tmp_path):
    # Create a repo with a package that was previously marked failed
    repo_path = tmp_path / "repo1.json"
    make_repository(repo_path, ["RecoveredPackage"])
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])
    output_file = tmp_path / "output.json"
    # Write previous db with fetching_source_failed package
    prev_db = {
        "repositories": [repo_path.as_uri()],
        "packages": [{
            "source": repo_path.as_uri(),
            "schema_version": "3.0.0",
            "name": "LostPackage",
            "details": "https://github.com/example/LostPackage",
            "fetching_source_failed": "2024-01-01T00:00:00Z"
        }],
        "libraries": []
    }
    output_file.write_text(json.dumps(prev_db))

    # Call main with previous db
    await main(str(output_file), [channel_path.as_uri()])
    with output_file.open() as f:
        result = json.load(f)
    # Package should no longer have fetching_source_failed
    assert "fetching_source_failed" not in result["packages"][0]


@pytest.mark.asyncio
async def test_implicit_seed_preserves_lifecycle_data(tmp_path):
    repo_path = tmp_path / "repo.json"
    make_repository(repo_path, ["Keep", "New"])
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])
    output_file = tmp_path / "registry.json"
    output_file.write_text(json.dumps({
        "repositories": [repo_path.as_uri()],
        "packages": [{
            "name": "Keep",
            "source": repo_path.as_uri(),
            "schema_version": "3.0.0",
            "details": "https://github.com/example/Keep",
            "first_seen": "2020-01-01T00:00:00Z",
        }],
        "libraries": [],
    }))

    await main(str(output_file), [channel_path.as_uri()])

    result = json.loads(output_file.read_text())
    by_name = {pkg["name"]: pkg for pkg in result["packages"]}
    assert by_name["Keep"]["first_seen"] == "2020-01-01T00:00:00Z"
    datetime.strptime(by_name["New"]["first_seen"], "%Y-%m-%dT%H:%M:%SZ")


@pytest.mark.asyncio
async def test_explicit_seed_overrides_output_path(tmp_path):
    repo_path = tmp_path / "repo.json"
    make_repository(repo_path, ["Keep"])
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])

    output_file = tmp_path / "output.json"
    output_file.write_text(json.dumps({
        "repositories": [repo_path.as_uri()],
        "packages": [{
            "name": "Keep",
            "source": repo_path.as_uri(),
            "schema_version": "3.0.0",
            "first_seen": "2011-01-01T00:00:00Z",
        }],
        "libraries": [],
    }))

    seed_file = tmp_path / "seed.json"
    seed_file.write_text(json.dumps({
        "repositories": [repo_path.as_uri()],
        "packages": [{
            "name": "Keep",
            "source": repo_path.as_uri(),
            "schema_version": "3.0.0",
            "first_seen": "2010-01-01T00:00:00Z",
        }],
        "libraries": [],
    }))

    await main(str(output_file), [channel_path.as_uri()], seed_path=str(seed_file))

    result = json.loads(output_file.read_text())
    assert result["packages"][0]["first_seen"] == "2010-01-01T00:00:00Z"


@pytest.mark.asyncio
async def test_explicit_missing_seed_fails_hard(tmp_path):
    repo_path = tmp_path / "repo.json"
    make_repository(repo_path, ["Keep"])
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])
    output_file = tmp_path / "output.json"

    with pytest.raises(FileNotFoundError):
        await main(
            str(output_file),
            [channel_path.as_uri()],
            seed_path=str(tmp_path / "missing.json"),
        )


@pytest.mark.asyncio
async def test_no_seed_outputs_raw_registry_without_lifecycle_fields(tmp_path):
    repo_path = tmp_path / "repo.json"
    make_repository(repo_path, ["Keep"])
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])

    output_file = tmp_path / "registry.json"
    output_file.write_text(json.dumps({
        "repositories": [repo_path.as_uri()],
        "packages": [
            {
                "name": "Keep",
                "source": repo_path.as_uri(),
                "schema_version": "3.0.0",
                "first_seen": "2010-01-01T00:00:00Z",
            },
            {
                "name": "Gone",
                "source": repo_path.as_uri(),
                "first_seen": "2011-01-01T00:00:00Z",
            },
        ],
        "libraries": [],
    }))

    await main(str(output_file), [channel_path.as_uri()], no_seed=True)

    result = json.loads(output_file.read_text())
    by_name = {pkg["name"]: pkg for pkg in result["packages"]}
    assert "first_seen" not in by_name["Keep"]
    assert "Gone" not in by_name


@pytest.mark.asyncio
async def test_package_disappearance_creates_minimal_tombstone(tmp_path):
    repo_path = tmp_path / "repo.json"
    make_repository(repo_path, [])
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])

    output_file = tmp_path / "registry.json"
    output_file.write_text(json.dumps({
        "repositories": [repo_path.as_uri()],
        "packages": [
            {
                "name": "Gone",
                "source": repo_path.as_uri(),
                "schema_version": "3.0.0",
                "first_seen": "2010-01-01T00:00:00Z",
                "labels": ["theme"],
            },
        ],
        "libraries": [],
    }))

    await main(str(output_file), [channel_path.as_uri()])

    result = json.loads(output_file.read_text())
    assert len(result["packages"]) == 1
    tombstone = result["packages"][0]
    assert set(tombstone.keys()) == {"name", "source", "first_seen", "removed", "labels"}
    assert tombstone["name"] == "Gone"
    assert tombstone["source"] == repo_path.as_uri()
    assert tombstone["first_seen"] == "2010-01-01T00:00:00Z"
    assert tombstone["labels"] == ["theme"]
    datetime.strptime(tombstone["removed"], "%Y-%m-%dT%H:%M:%SZ")


@pytest.mark.asyncio
async def test_existing_tombstone_keeps_removed_timestamp(tmp_path):
    repo_path = tmp_path / "repo.json"
    make_repository(repo_path, [])
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])

    output_file = tmp_path / "registry.json"
    output_file.write_text(json.dumps({
        "repositories": [repo_path.as_uri()],
        "packages": [
            {
                "name": "Gone",
                "source": repo_path.as_uri(),
                "first_seen": "2010-01-01T00:00:00Z",
                "removed": "2020-02-02T00:00:00Z",
            },
        ],
        "libraries": [],
    }))

    await main(str(output_file), [channel_path.as_uri()])

    result = json.loads(output_file.read_text())
    assert result["packages"][0]["removed"] == "2020-02-02T00:00:00Z"


@pytest.mark.asyncio
async def test_tombstoned_package_resurrection_preserves_first_seen(tmp_path):
    repo_path = tmp_path / "repo.json"
    make_repository(repo_path, ["Phoenix"])
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])

    output_file = tmp_path / "registry.json"
    output_file.write_text(json.dumps({
        "repositories": [repo_path.as_uri()],
        "packages": [
            {
                "name": "Phoenix",
                "source": repo_path.as_uri(),
                "first_seen": "2010-01-01T00:00:00Z",
                "removed": "2020-02-02T00:00:00Z",
            },
        ],
        "libraries": [],
    }))

    await main(str(output_file), [channel_path.as_uri()])

    result = json.loads(output_file.read_text())
    phoenix = result["packages"][0]
    assert phoenix["name"] == "Phoenix"
    assert phoenix["first_seen"] == "2010-01-01T00:00:00Z"
    assert "removed" not in phoenix


@pytest.mark.asyncio
async def test_disappeared_libraries_are_not_tombstoned(tmp_path):
    repo_path = tmp_path / "repo.json"
    make_repository(repo_path, [])
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])

    output_file = tmp_path / "registry.json"
    output_file.write_text(json.dumps({
        "repositories": [repo_path.as_uri()],
        "packages": [],
        "libraries": [
            {
                "name": "GoneLib",
                "source": repo_path.as_uri(),
                "removed": "2020-02-02T00:00:00Z",
            }
        ],
    }))

    await main(str(output_file), [channel_path.as_uri()])

    result = json.loads(output_file.read_text())
    assert result["libraries"] == []


@pytest.mark.asyncio
async def test_seeded_output_packages_are_name_sorted(tmp_path):
    repo_path = tmp_path / "repo.json"
    make_repository(repo_path, ["Zulu", "Bravo"])
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])

    output_file = tmp_path / "registry.json"
    output_file.write_text(json.dumps({
        "repositories": [repo_path.as_uri()],
        "packages": [
            {
                "name": "Alpha",
                "source": repo_path.as_uri(),
                "first_seen": "2010-01-01T00:00:00Z",
            },
            {
                "name": "Zulu",
                "source": repo_path.as_uri(),
                "first_seen": "2011-01-01T00:00:00Z",
            },
        ],
        "libraries": [],
    }))

    await main(str(output_file), [channel_path.as_uri()])

    result = json.loads(output_file.read_text())
    assert [pkg["name"] for pkg in result["packages"]] == ["Alpha", "Bravo", "Zulu"]


@pytest.mark.asyncio
@pytest.mark.parametrize("no_seed", [False, True])
async def test_fetching_source_failed_behavior_unchanged_with_no_seed_toggle(tmp_path, no_seed):
    repo_path = tmp_path / "missing.json"
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])

    output_file = tmp_path / "registry.json"
    output_file.write_text(json.dumps({
        "repositories": [repo_path.as_uri()],
        "packages": [{
            "name": "Lost",
            "source": repo_path.as_uri(),
            "schema_version": "3.0.0",
            "details": "https://github.com/example/Lost",
        }],
        "libraries": [],
    }))

    await main(str(output_file), [channel_path.as_uri()], no_seed=no_seed)

    result = json.loads(output_file.read_text())
    assert "fetching_source_failed" in result["packages"][0]


@pytest.mark.asyncio
async def test_non_registry_seed_does_not_recreate_failed_repo_entries(tmp_path, capsys):
    repo_path = tmp_path / "missing.json"
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])

    output_file = tmp_path / "registry.json"
    seed_file = tmp_path / "workspace.json"
    seed_file.write_text(json.dumps({
        "packages": {
            "SFTP": {
                "name": "SFTP",
                "source": repo_path.as_uri(),
                "first_seen": "2011-12-15T14:11:26Z",
                "description": "Commercial SFTP/FTP plugin",
                "labels": ["ftp", "sync"],
            }
        }
    }))

    await main(
        str(output_file),
        [channel_path.as_uri()],
        seed_path=str(seed_file),
    )

    result = json.loads(output_file.read_text())
    pkg = result["packages"][0]
    assert pkg["name"] == "SFTP"
    assert "description" not in pkg
    assert "fetching_source_failed" not in pkg

    captured = capsys.readouterr()
    assert "seed file knows 1 package" in captured.err


@pytest.mark.asyncio
async def test_workspace_seed_uses_prior_output_registry_for_failed_repo_recovery(tmp_path, capsys):
    repo_path = tmp_path / "missing.json"
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])

    output_file = tmp_path / "registry.json"
    output_file.write_text(json.dumps({
        "repositories": [repo_path.as_uri()],
        "packages": [
            {
                "name": "SFTP",
                "source": repo_path.as_uri(),
                "schema_version": "3.0.0",
                "details": "https://example.com/sftp",
                "first_seen": "2015-01-01T00:00:00Z",
            }
        ],
        "libraries": [],
    }))

    seed_file = tmp_path / "workspace.json"
    seed_file.write_text(json.dumps({
        "packages": {
            "SFTP": {
                "name": "SFTP",
                "source": repo_path.as_uri(),
                "first_seen": "2011-12-15T14:11:26Z",
                "description": "Commercial SFTP/FTP plugin",
            }
        }
    }))

    await main(
        str(output_file),
        [channel_path.as_uri()],
        seed_path=str(seed_file),
    )

    result = json.loads(output_file.read_text())
    pkg = result["packages"][0]
    assert pkg["name"] == "SFTP"
    assert pkg["first_seen"] == "2011-12-15T14:11:26Z"
    assert "fetching_source_failed" in pkg
    assert "description" not in pkg

    captured = capsys.readouterr()
    assert "recover full entries" not in captured.err


@pytest.mark.asyncio
async def test_compact_seed_without_sources_warns_on_failed_repo(tmp_path, capsys):
    repo_path = tmp_path / "missing.json"
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])

    output_file = tmp_path / "registry.json"
    seed_file = tmp_path / "seed.json"
    seed_file.write_text(json.dumps({
        "SFTP": {
            "name": "SFTP",
            "first_seen": "2011-12-15T14:11:26Z",
        }
    }))

    await main(
        str(output_file),
        [channel_path.as_uri()],
        seed_path=str(seed_file),
    )

    captured = capsys.readouterr()
    assert "repository recovery cannot be guaranteed with a compact seed" in captured.err
    assert "full registry.json seed for complete recovery" in captured.err
    assert "recover full entries" not in captured.err


@pytest.mark.asyncio
async def test_registry_seed_without_source_entries_does_not_emit_compact_warning(tmp_path, capsys):
    repo_path = tmp_path / "missing.json"
    channel_path = tmp_path / "channel.json"
    make_channel(channel_path, [repo_path])

    output_file = tmp_path / "registry.json"
    seed_file = tmp_path / "registry_seed.json"
    seed_file.write_text(json.dumps({
        "repositories": [repo_path.as_uri()],
        "packages": [],
        "libraries": [],
    }))

    await main(
        str(output_file),
        [channel_path.as_uri()],
        seed_path=str(seed_file),
    )

    captured = capsys.readouterr()
    assert "repository recovery cannot be guaranteed with a compact seed" not in captured.err
