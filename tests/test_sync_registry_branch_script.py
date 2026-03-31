from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest


def test_sync_registry_branch_happy_path() -> None:
    require_shell_tools()

    with tempfile.TemporaryDirectory(dir=project_root()) as temp_dir:
        sandbox = Path(temp_dir)
        origin_dir, registry_dir = init_registry_branch_repo(sandbox)
        assert_origin_is_local(registry_dir, origin_dir)

        new_registry = sandbox / "wrk-registry.json"
        write_registry(new_registry, package_names=["DemoPkg"])

        result = run_sync_script(registry_dir, new_registry)

        assert result.returncode == 0, result.stderr
        assert "fallback subject used" not in result.stdout

        commit_subject = git_output(
            ["git", "-C", str(registry_dir), "log", "-1", "--pretty=%s"],
        ).strip()
        assert commit_subject == "Added `DemoPkg`"

        local_registry = json.loads((registry_dir / "registry.json").read_text(encoding="utf-8"))
        generated_registry = json.loads(new_registry.read_text(encoding="utf-8"))
        assert local_registry == generated_registry

        local_head = git_output(["git", "-C", str(registry_dir), "rev-parse", "HEAD"]).strip()
        remote_head = git_output(
            ["git", "--git-dir", str(origin_dir), "rev-parse", "refs/heads/the-registry"],
        ).strip()
        assert local_head == remote_head


def test_sync_registry_branch_noop_when_files_match() -> None:
    require_shell_tools()

    with tempfile.TemporaryDirectory(dir=project_root()) as temp_dir:
        sandbox = Path(temp_dir)
        origin_dir, registry_dir = init_registry_branch_repo(sandbox)
        assert_origin_is_local(registry_dir, origin_dir)

        new_registry = sandbox / "wrk-registry.json"
        write_registry(new_registry, package_names=[])

        before_head = git_output(["git", "-C", str(registry_dir), "rev-parse", "HEAD"]).strip()
        result = run_sync_script(registry_dir, new_registry)
        after_head = git_output(["git", "-C", str(registry_dir), "rev-parse", "HEAD"]).strip()

        assert result.returncode == 0, result.stderr
        assert "No registry changes." in result.stdout
        assert before_head == after_head


def test_sync_registry_branch_commits_when_describe_crashes() -> None:
    require_shell_tools()

    with tempfile.TemporaryDirectory(dir=project_root()) as temp_dir:
        sandbox = Path(temp_dir)
        origin_dir, registry_dir = init_registry_branch_repo(sandbox)
        assert_origin_is_local(registry_dir, origin_dir)

        new_registry = sandbox / "wrk-registry.json"
        write_registry(new_registry, package_names=["CrashPathPkg"])

        fake_uv = sandbox / "fake-uv"
        fake_uv.write_text(
            "#!/usr/bin/env bash\n"
            "echo 'Traceback (most recent call last):' >&2\n"
            "echo '  File \"scripts/describe_registry_changes.py\", line 1, in <module>' >&2\n"
            "echo 'RuntimeError: boom' >&2\n"
            "exit 1\n",
            encoding="utf-8",
        )
        fake_uv.chmod(0o755)

        env = os.environ.copy()
        env["UV_BINARY"] = to_script_arg(fake_uv)

        result = run_sync_script(registry_dir, new_registry, env=env)

        assert result.returncode == 0, result.stderr
        assert "describe_registry_changes failed; using fallback subject" in result.stdout
        assert (
            "describe_registry_changes stderr: Traceback (most recent call last):"
            in result.stdout
        )

        commit_subject = git_output(
            ["git", "-C", str(registry_dir), "log", "-1", "--pretty=%s"],
        ).strip()
        assert commit_subject == "Update registry.json"

        commit_body = git_output(
            ["git", "-C", str(registry_dir), "log", "-1", "--pretty=%B"],
        )
        assert "describe_registry_changes.py raised" in commit_body
        assert "Traceback (most recent call last):" in commit_body
        assert "RuntimeError: boom" in commit_body

        local_head = git_output(["git", "-C", str(registry_dir), "rev-parse", "HEAD"]).strip()
        remote_head = git_output(
            ["git", "--git-dir", str(origin_dir), "rev-parse", "refs/heads/the-registry"],
        ).strip()
        assert local_head == remote_head


def require_shell_tools() -> None:
    if shutil.which("git") is None:
        pytest.skip("git is required for sync script tests")
    if bash_executable() is None:
        pytest.skip("bash is required for sync script tests")


def run_sync_script(
    registry_dir: Path,
    new_registry_path: Path,
    *,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    bash_path = bash_executable()
    if bash_path is None:
        raise RuntimeError("bash is required for sync script tests")

    effective_env = os.environ.copy()
    if env:
        effective_env.update(env)
    effective_env["GIT_ALLOW_PROTOCOL"] = "file"
    effective_env["GIT_TERMINAL_PROMPT"] = "0"

    return subprocess.run(
        [
            bash_path,
            "./.github/workflows/sync_registry_branch.sh",
            to_script_arg(registry_dir),
            to_script_arg(new_registry_path),
        ],
        cwd=project_root(),
        env=effective_env,
        capture_output=True,
        text=True,
        check=False,
    )


def init_registry_branch_repo(sandbox: Path) -> tuple[Path, Path]:
    origin_dir = sandbox / "origin.git"
    registry_dir = sandbox / ".the-registry"

    run_checked(["git", "init", "--bare", str(origin_dir)])
    run_checked(["git", "clone", str(origin_dir), str(registry_dir)])
    run_checked(["git", "-C", str(registry_dir), "checkout", "-b", "the-registry"])
    run_checked(["git", "-C", str(registry_dir), "config", "user.name", "Test User"])
    run_checked(["git", "-C", str(registry_dir), "config", "user.email", "test@example.com"])

    write_registry(registry_dir / "registry.json", package_names=[])
    run_checked(["git", "-C", str(registry_dir), "add", "registry.json"])
    run_checked(["git", "-C", str(registry_dir), "commit", "-m", "Initial"])
    run_checked(["git", "-C", str(registry_dir), "push", "-u", "origin", "the-registry"])

    return origin_dir, registry_dir


def assert_origin_is_local(registry_dir: Path, origin_dir: Path) -> None:
    origin_url = git_output(["git", "-C", str(registry_dir), "remote", "get-url", "origin"]).strip()
    assert Path(origin_url).resolve() == origin_dir.resolve()


def to_script_arg(path: Path) -> str:
    rel = path.resolve().relative_to(project_root())
    return f"./{rel.as_posix()}"


def write_registry(path: Path, *, package_names: list[str]) -> None:
    payload = {
        "packages": [{"name": name} for name in package_names],
        "libraries": [],
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def git_output(command: list[str]) -> str:
    return subprocess.check_output(command, text=True)


def run_checked(command: list[str]) -> None:
    subprocess.run(command, check=True, capture_output=True, text=True)


def bash_executable() -> str | None:
    try:
        where_output = subprocess.check_output(["where", "bash"], text=True)
    except Exception:
        return shutil.which("bash")

    for line in where_output.splitlines():
        candidate = line.strip()
        if "git" in candidate.lower() and candidate.lower().endswith("bash.exe"):
            return candidate

    return shutil.which("bash")


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]
