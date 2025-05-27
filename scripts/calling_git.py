from __future__ import annotations

import asyncio
import os
import re
import subprocess
import shutil
import sys
from functools import lru_cache
from typing import Iterable, TypedDict

from .package_control.pep440 import PEP440Version
from .utils import drop_falsy


type Ref = str
type Sha = str


class RepoConfig(TypedDict):
    url: str
    name: str


if sys.platform == "win32":
    STARTUPINFO = subprocess.STARTUPINFO()
    STARTUPINFO.dwFlags |= subprocess.STARTF_USESHOWWINDOW
else:
    STARTUPINFO = None


@lru_cache(1)
def git_binary() -> str:
    return shutil.which("git") or "git"


async def git(*args, cwd: str, check: bool = True) -> str:
    process = await asyncio.create_subprocess_exec(
        git_binary(), *drop_falsy(args),
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        startupinfo=STARTUPINFO
    )

    stdout, stderr = await process.communicate()

    if check and process.returncode:
        raise subprocess.CalledProcessError(
            process.returncode, args, output=stdout, stderr=stderr
        )

    return stdout.decode().strip()


class GitCallable:
    def __init__(self, repo_path: str):
        self.repo_path = repo_path

    @property
    def git_dir(self) -> str:
        return os.path.join(self.repo_path, ".git")

    async def __call__(self, *args: str, check: bool = True) -> str:
        return await git(*args, cwd=self.repo_path, check=check)


async def fetch_remote_refs(remote: str, refs: str = None) -> dict[Ref, Sha]:
    # Fetch remote refs
    output = await git("ls-remote", "--sort=v:refname", remote, refs, cwd=".")
    return parse_ref_output(output)


def parse_ref_output(stdout: str, remove_prefix: str = "") -> dict[Ref, Sha]:
    # Parse the output and organize tag data
    rv = {}
    for line in stdout.strip().split("\n"):
        if not line:
            continue

        parts = line.split()
        if len(parts) != 2:
            continue

        """
        Example line format:
        c80596e48e4fedd78596a66b3d79c67488f828aa        refs/tags/2.47.1
        f3fad6a5617c802c95b46c4eeada797bc282e7cd        refs/tags/2.47.1^{}
        """
        commit_hash, ref = parts

        ref = ref[len(remove_prefix):]
        # Check if it's a dereferenced tag (^{})
        is_deref = ref.endswith("^{}")
        if is_deref:
            ref = ref[:-3]  # Remove suffix "^{}"
            rv[ref] = commit_hash
        else:
            rv.setdefault(ref, commit_hash)

    return rv


def best_version_for(refs: Iterable[Ref], prefix: str = "") -> Ref | None:
    tags = (
        ref.removeprefix("refs/tags/")
        for ref in refs
        if ref.startswith(prefix)
    )
    return max(
        tags,
        key=lambda it: parse_version(it.removeprefix(prefix)),  # type: ignore[union-attr]
        default=None
    )


def parse_version(version: str) -> PEP440Version | tuple:
    """
    Convert a version string into a tuple for comparison.

    Args:
        version: A version string (e.g., "1.2.3", "1.2.3-alpha")

    Returns:
        A tuple with integer and string parts for comparison
    """
    version = strip_possible_prefix(version)
    try:
        return PEP440Version(version)
    except Exception:
        return tuple(
            int(part) if part.isdigit() else part
            for part in re.split(r'[.-]', version)
        )


def strip_possible_prefix(version: str) -> str:
    """Strip possible build prefixes from a tag."""
    return re.sub(r'^(st\d+-|\d+-|v)', '', version)


async def ensure_repository(
    root_dir: str, config: RepoConfig, Git: type[GitCallable]
) -> GitCallable:
    """
    Ensure a local git repository is properly configured for a package.

    """
    # Create/use package directory
    package_name = config['name']
    package_dir = os.path.join(root_dir, package_name)
    os.makedirs(package_dir, exist_ok=True)

    git = Git(package_dir)
    if not os.path.exists(git.git_dir) or not repo_is_valid(git):
        await git("init")
        await git("sparse-checkout", "set", "--cone")
        await git("config", "core.fsmonitor", "false")
        await git("config", "core.usebuiltinfsmonitor", "false")
        await git("fsmonitor--daemon", "stop", check=False)

    # Always set the remote to ensure it follows configuration changes
    await configure_remote(config['url'], git)
    return git


async def repo_is_valid(git: GitCallable) -> bool:
    try:
        await git("rev-parse", "--is-inside-work-tree")
    except subprocess.CalledProcessError:
        return False
    else:
        return True


async def configure_remote(remote_url: str, git: GitCallable):
    try:
        await git("remote", "add", "origin", remote_url)
    except Exception:
        # Remote exists, update URL
        await git("remote", "set-url", "origin", remote_url)


async def get_commit_date(sha: Sha, git: GitCallable) -> int:
    """Get commit timestamp as Unix epoch seconds."""
    try:
        return int((await git("show", sha, "--no-patch", "--format=%ct")).strip())
    except Exception:
        await git("fetch", "--depth=1", "origin", sha)
        return int((await git("show", sha, "--no-patch", "--format=%ct")).strip())


def find_readme(root_dir) -> str | None:
    return next((
        name
        for name in os.listdir(root_dir)
        if (lname := name.lower())
        if lname == "readme" or lname.startswith("readme.")
    ), None)


async def find_default_branch(remote: str) -> str | None:
    refs = await fetch_remote_refs(remote)
    try:
        head_sha = refs["HEAD"]
    except KeyError:
        return None

    candidates = [
        ref
        for ref, sha in refs.items()
        if ref != "HEAD" and sha == head_sha
    ]
    if len(candidates) > 1:
        plausible = ("main", "master",)
        for name in plausible:
            if name in candidates:
                return name
    return candidates[0]
