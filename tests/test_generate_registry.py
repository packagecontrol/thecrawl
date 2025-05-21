import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
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
            {"name": name, "details": f"https://github.com/example/{name}"} for name in package_names
        ],
        "dependencies": []
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
    assert any(pkg["name"] == "TestPackage" for pkg in result["packages"])


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
    expected_msg = f"Package DuplicatePackage in {repo2_path.as_uri()} already seen, skipping"
    assert expected_msg in captured.err
