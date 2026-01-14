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


def make_repository(path: Path, package_names: list[str]):
    repo_data = {
        "schema_version": "3.0.0",
        "packages": [
            {
                "name": name,
                "details": f"https://github.com/example/{name}",
            }
            for name in package_names
        ],
        "libraries": []
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
