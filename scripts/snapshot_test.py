from __future__ import annotations

import argparse
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
import difflib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib
from typing import TextIO

from readchar import key as readchar_key
from readchar import readkey
from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.text import Text


DEFAULT_BASE = "snapshot.yml"
DEFAULT_CONF = "snapshot.toml"
DEFAULT_LOG = "snapshot.log"

RED_ON_BLACK = "\x1b[31;40m"
YELLOW_ON_BLACK = "\x1b[33;40m"
RESET = "\x1b[0m"

STDOUT_CONSOLE = Console()
STDERR_CONSOLE = Console(stderr=True)


@dataclass
class ShootContext:
    now: datetime
    commit_hash: str
    commit_subject: str


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "shoot":
        return run_shoot(args)
    if args.command == "diff":
        return run_diff(args)
    return run_auto(args)


def run_auto(args: argparse.Namespace) -> int:
    ctx = collect_shoot_context()
    base_path = Path(args.base)
    output_path = resolve_auto_output_path(base_path, args.output, ctx)

    create_snapshot_with_spinner(output_path, Path(args.conf), ctx)
    print(f"Created snapshot at {output_path}")

    if base_path.exists() and base_path.resolve() != output_path.resolve():
        print(f"Comparing {base_path} to {output_path}")
        print_snapshot_diff(base_path, output_path)

    return 0


def run_shoot(args: argparse.Namespace) -> int:
    ctx = collect_shoot_context()
    output_path = Path(args.filename)

    create_snapshot_with_spinner(output_path, Path(args.conf), ctx)
    print(f"Created snapshot at {output_path}")
    return 0


def run_diff(args: argparse.Namespace) -> int:
    files = args.files
    if len(files) > 2:
        raise SystemExit("diff accepts at most two snapshot files")

    if not files:
        snapshots = list_available_snapshots()
        if not snapshots:
            print("No snapshots found matching 'snapshot-*'.")
            return 0

        if len(snapshots) == 1:
            left = Path(args.base)
            right = snapshots[0]
            print(f"Comparing {left} to {right}")
            print_snapshot_diff(left, right)
            return 0

        if is_interactive_terminal():
            selected = select_snapshot_interactively(snapshots)
            if selected is None:
                return 0
            left = Path(args.base)
            right = selected
            print(f"Comparing {left} to {right}")
            print_snapshot_diff(left, right)
            return 0

        for path in snapshots:
            print(path.name)
        return 0

    if len(files) == 1:
        left = Path(args.base)
        right = Path(files[0])
    else:
        left = Path(files[0])
        right = Path(files[1])

    print(f"Comparing {left} to {right}")
    print_snapshot_diff(left, right)
    return 0


def list_available_snapshots() -> list[Path]:
    candidates = {
        path
        for pattern in ("snapshot-*.yml", "snapshot-*")
        for path in Path.cwd().glob(pattern)
        if path.is_file()
    }
    return sorted(candidates, key=lambda path: path.name)


def is_interactive_terminal() -> bool:
    return sys.stdin.isatty() and sys.stdout.isatty()


def select_snapshot_interactively(
    snapshots: list[Path],
    key_reader: Callable[[], str] | None = None,
    console: Console | None = None,
) -> Path | None:
    if not snapshots:
        return None

    selected = 0
    key_reader = read_key_action if key_reader is None else key_reader
    console = STDOUT_CONSOLE if console is None else console

    with Live(
        render_snapshot_selector(snapshots, selected),
        console=console,
        transient=True,
        auto_refresh=False,
    ) as live:
        while True:
            action = key_reader()

            if action == "enter":
                return snapshots[selected]
            if action in {"q", "esc", "ctrl_c"}:
                return None

            next_selected = move_selection(selected, len(snapshots), action)
            if next_selected != selected:
                selected = next_selected
                live.update(render_snapshot_selector(snapshots, selected), refresh=True)


def render_snapshot_selector(snapshots: list[Path], selected: int) -> Panel:
    body = Text("Use ↑/↓ to choose a snapshot, Enter to diff, q to cancel\n\n")
    for index, path in enumerate(snapshots):
        prefix = "❯" if index == selected else " "
        style = "bold cyan" if index == selected else ""
        body.append(f"{prefix} {path.name}\n", style=style)
    return Panel(body, title="Available snapshots")


def move_selection(current: int, total: int, key: str) -> int:
    if total <= 0:
        return 0
    if key == "up":
        return (current - 1) % total
    if key == "down":
        return (current + 1) % total
    return current


def read_key_action() -> str:
    try:
        pressed = readkey()
    except KeyboardInterrupt:
        return "ctrl_c"
    return normalize_key_press(pressed)


def normalize_key_press(pressed: str) -> str:
    if pressed == readchar_key.UP:
        return "up"
    if pressed == readchar_key.DOWN:
        return "down"
    if pressed in {readchar_key.ENTER, "\r", "\n"}:
        return "enter"
    if pressed == readchar_key.ESC:
        return "esc"
    if pressed == readchar_key.CTRL_C:
        return "ctrl_c"
    if pressed.lower() == "q":
        return "q"
    return "other"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    raw_argv = list(sys.argv[1:] if argv is None else argv)

    if raw_argv and raw_argv[0] == "auto":
        return parse_auto_args(raw_argv[1:])

    if is_auto_mode_argv(raw_argv):
        return parse_auto_args(raw_argv)

    parser = build_main_parser()
    normalized_argv = normalize_argv(raw_argv)
    return parser.parse_args(normalized_argv)


def normalize_argv(argv: list[str]) -> list[str]:
    if not argv:
        return argv
    if argv[0] in {"-h", "--help", "shoot", "diff"}:
        return argv
    return ["shoot", *argv]


class SubcommandHelpFormatter(argparse.HelpFormatter):
    def _format_action(self, action: argparse.Action) -> str:
        if isinstance(action, argparse._SubParsersAction):
            return "".join(self._format_action(choice) for choice in action._get_subactions())
        return super()._format_action(action)


def build_main_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create and diff crawler snapshots.",
        formatter_class=SubcommandHelpFormatter,
    )
    add_auto_mode_arguments(parser)

    subparsers = parser.add_subparsers(
        title="subcommands",
        dest="command",
        required=True,
    )

    shoot = subparsers.add_parser("shoot", help="Create or overwrite a snapshot")
    shoot.add_argument(
        "filename",
        nargs="?",
        default=DEFAULT_BASE,
        help=f"Output snapshot path (default: {DEFAULT_BASE})",
    )
    shoot.add_argument(
        "--conf",
        default=DEFAULT_CONF,
        help=f"Snapshot config file (default: {DEFAULT_CONF})",
    )

    diff = subparsers.add_parser("diff", help="Diff one or two snapshots")
    diff.add_argument(
        "--base",
        default=DEFAULT_BASE,
        help=f"Default base snapshot if one file is provided (default: {DEFAULT_BASE})",
    )
    diff.add_argument("files", nargs="*", help="Snapshot file(s) to diff")

    return parser


def parse_auto_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="snapshot_test.py",
        description="Create and diff crawler snapshots.",
    )
    add_auto_mode_arguments(parser)
    args = parser.parse_args(argv)
    args.command = "auto"
    return args


def add_auto_mode_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--base",
        default=DEFAULT_BASE,
        help=f"Base snapshot used for diffing (default: {DEFAULT_BASE})",
    )
    parser.add_argument(
        "--conf",
        default=DEFAULT_CONF,
        help=f"Snapshot config file (default: {DEFAULT_CONF})",
    )
    parser.add_argument(
        "--output",
        "-o",
        default=None,
        help=(
            "Output snapshot path. "
            "Default: when base exists use snapshot-<YYYY-MM-DD-HHMM>-<short-hash>.yml, "
            "otherwise write to --base."
        ),
    )


def is_auto_mode_argv(argv: list[str]) -> bool:
    if not argv:
        return True
    if argv[0] in {"shoot", "diff", "-h", "--help"}:
        return False
    return argv[0].startswith("-")


def collect_shoot_context() -> ShootContext:
    now = datetime.now()
    short_hash = run_capture(["git", "rev-parse", "--short", "HEAD"])
    commit_subject = run_capture(["git", "log", "-1", "--pretty=%s"])
    return ShootContext(now=now, commit_hash=short_hash, commit_subject=commit_subject)


def resolve_auto_output_path(
    base_path: Path,
    output_arg: str | None,
    ctx: ShootContext,
) -> Path:
    if output_arg:
        return Path(output_arg)
    if not base_path.exists():
        return base_path

    stamp = ctx.now.strftime("%Y-%m-%d-%H%M")
    return Path(f"snapshot-{stamp}-{ctx.commit_hash}.yml")


def create_snapshot_with_spinner(
    output_path: Path,
    conf_path: Path,
    ctx: ShootContext,
) -> None:
    with STDERR_CONSOLE.status("Creating snapshot", spinner="dots"):
        create_snapshot(output_path, conf_path, ctx)


def create_snapshot(output_path: Path, conf_path: Path, ctx: ShootContext) -> None:
    names = load_snapshot_packages(conf_path)
    if not names:
        raise ValueError(f"{conf_path} does not contain any snapshot packages.")

    temp_dir = resolve_temp_dir(ctx)
    log_path = temp_dir / DEFAULT_LOG

    cleanup = False
    try:
        with log_path.open("w", encoding="utf-8") as log_file:
            write_log(log_file, f"date: {ctx.now.isoformat()}")
            write_log(log_file, f"commit: {ctx.commit_hash} {ctx.commit_subject}")
            write_log(log_file, f"temp_dir: {temp_dir}")
            write_log(log_file, f"output: {output_path}")

            reduced_registry, channel = build_snapshot_payload(temp_dir, names, log_file)
            snapshot_text = render_snapshot(ctx, names, reduced_registry, channel)

            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(snapshot_text, encoding="utf-8")
            cleanup = True
    finally:
        if cleanup:
            shutil.rmtree(temp_dir, ignore_errors=True)
        else:
            print(f"Snapshot failed. Kept temp dir for introspection: {temp_dir}", file=sys.stderr)
            if log_path.exists():
                print(f"Log: {log_path}", file=sys.stderr)


def resolve_temp_dir(ctx: ShootContext) -> Path:
    stamp = ctx.now.strftime("%Y-%m-%d-%H%M")
    stem = f"tmp--{stamp}-{ctx.commit_hash}"
    candidate = Path.cwd() / stem
    index = 1
    while candidate.exists():
        candidate = Path.cwd() / f"{stem}-{index}"
        index += 1
    candidate.mkdir(parents=True, exist_ok=False)
    return candidate


def build_snapshot_payload(
    temp_dir: Path,
    names: list[str],
    log_file: TextIO,
) -> tuple[dict, dict]:
    full_registry = temp_dir / "registry-full.json"
    reduced_registry_path = temp_dir / "registry.json"
    workspace_path = temp_dir / "workspace.json"
    channel_path = temp_dir / "channel.json"

    run_step([
        sys.executable,
        "-m",
        "scripts.generate_registry",
        "--output",
        str(full_registry),
    ], log_file)

    write_log(log_file, f"Reducing registry to {len(names)} configured packages")
    reduced_registry = write_reduced_registry(full_registry, reduced_registry_path, names)

    run_step([
        sys.executable,
        "-m",
        "scripts.crawl",
        "--registry",
        str(reduced_registry_path),
        "--workspace",
        str(workspace_path),
        "--limit",
        str(max(len(names), 1)),
    ], log_file)

    run_step([
        sys.executable,
        "-m",
        "scripts.generate_channel",
        "--registry",
        str(reduced_registry_path),
        "--workspace",
        str(workspace_path),
        "--output",
        str(channel_path),
    ], log_file)

    channel = read_json(channel_path)
    return reduced_registry, channel


def write_reduced_registry(
    full_registry_path: Path,
    reduced_registry_path: Path,
    names: list[str],
) -> dict:
    full_registry = read_json(full_registry_path)
    wanted = set(names)

    selected_packages = [
        package
        for package in full_registry.get("packages", [])
        if package.get("name") in wanted
    ]

    found_names = {package["name"] for package in selected_packages if package.get("name")}
    missing = [name for name in names if name not in found_names]
    if missing:
        joined = ", ".join(missing)
        raise ValueError(f"Packages listed in config but missing from generated registry: {joined}")

    selected_sources = {
        package["source"]
        for package in selected_packages
        if package.get("source")
    }
    repositories = [
        repo
        for repo in full_registry.get("repositories", [])
        if repo in selected_sources
    ]

    reduced_registry = {
        "repositories": repositories,
        "packages": selected_packages,
        "libraries": [],
    }
    reduced_registry_path.write_text(
        json.dumps(reduced_registry, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return reduced_registry


def render_snapshot(
    ctx: ShootContext,
    names: list[str],
    reduced_registry: dict,
    channel: dict,
) -> str:
    package_lines = [f"  - {name}" for name in names]
    header_lines = [
        f"date: {format_snapshot_date(ctx.now)}",
        f"commit: {ctx.commit_hash} {ctx.commit_subject}",
        "packages:",
        *package_lines,
    ]

    registry_json = json.dumps(reduced_registry, indent=2, ensure_ascii=False)
    channel_json = json.dumps(channel, indent=2, ensure_ascii=False)

    return "\n".join([
        *header_lines,
        "---",
        registry_json,
        "---",
        channel_json,
        "",
    ])


def format_snapshot_date(now: datetime) -> str:
    return f"{now.strftime('%B %Y')}, {ordinal(now.day)} {now.strftime('%H:%M')}"


def ordinal(day: int) -> str:
    if 10 <= day % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"{day}{suffix}"


def print_snapshot_diff(left: Path, right: Path) -> None:
    if not left.exists():
        raise FileNotFoundError(f"Base snapshot not found: {left}")
    if not right.exists():
        raise FileNotFoundError(f"Snapshot not found: {right}")

    left_lines = left.read_text(encoding="utf-8").splitlines()
    right_lines = right.read_text(encoding="utf-8").splitlines()

    diff_lines = list(difflib.unified_diff(
        left_lines,
        right_lines,
        fromfile=str(left),
        tofile=str(right),
        lineterm="",
    ))

    if not diff_lines:
        print("No differences.")
        return

    for line in diff_lines:
        if line.startswith("--- ") or line.startswith("+++ "):
            continue
        if line.startswith("-"):
            print(f"{RED_ON_BLACK}{line}{RESET}")
        elif line.startswith("+"):
            print(f"{YELLOW_ON_BLACK}{line}{RESET}")
        else:
            print(line)


def load_snapshot_packages(conf_path: Path) -> list[str]:
    if not conf_path.exists():
        raise FileNotFoundError(f"Snapshot config not found: {conf_path}")

    text = conf_path.read_text(encoding="utf-8")
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        raise ValueError(f"Invalid TOML in {conf_path}: {exc}") from exc

    packages = data.get("snapshot", {}).get("packages", [])
    if not isinstance(packages, list):
        raise ValueError(f"Invalid config in {conf_path}: snapshot.packages must be a list")
    return [str(package) for package in packages if str(package).strip()]


def read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return data


def run_capture(command: list[str]) -> str:
    completed = subprocess.run(command, check=True, capture_output=True, text=True)
    return completed.stdout.strip()


def run_step(command: list[str], log_file: TextIO) -> None:
    printable = " ".join(command)
    write_log(log_file, f"$ {printable}")

    try:
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        append_command_output(log_file, exc.stdout, exc.stderr)
        write_log(log_file, f"Command failed with exit code {exc.returncode}")
        raise

    append_command_output(log_file, completed.stdout, completed.stderr)


def append_command_output(log_file: TextIO, stdout: str | None, stderr: str | None) -> None:
    if stdout:
        log_file.write(stdout)
        if not stdout.endswith("\n"):
            log_file.write("\n")
    if stderr:
        log_file.write(stderr)
        if not stderr.endswith("\n"):
            log_file.write("\n")
    log_file.flush()


def write_log(log_file: TextIO, message: str) -> None:
    log_file.write(f"{message}\n")
    log_file.flush()


if __name__ == "__main__":
    raise SystemExit(main())
