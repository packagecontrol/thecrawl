import io
import json

import pytest

import scripts.crawl_libraries as crawl_libraries


def write_json(path, data):
    path.write_text(json.dumps(data), encoding="utf-8")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def make_args(
    tmp_path,
    registry_path,
    output_path,
    *,
    name=None,
    explain=None,
    try_definition=None,
    try_definition_shortcut=False,
    limit=10,
    allowed_source=None,
    write=False,
    verbose=False,
):
    if allowed_source is None:
        allowed_source = []
    return crawl_libraries.Args(
        registry=registry_path,
        allowed_sources=set(allowed_source),
        name=name,
        explain=explain,
        try_definition=try_definition,
        try_definition_shortcut=try_definition_shortcut,
        write=write,
        verbose=verbose,
        limit=limit,
        workspace=output_path,
        cache_dir=tmp_path / "cache",
    )


def make_info(name, version="1.0.0", date="2026-01-01T00:00:00Z"):
    return {
        "name": name,
        "description": f"{name} desc",
        "author": f"{name} author",
        "issues": f"https://example.com/{name}/issues",
        "releases": [{"version": version, "date": date}],
    }


def make_resolver(calls, version="1.0.0"):
    async def resolver(library, cache_dir, session):
        name = library["name"]
        calls.append(name)
        return make_info(name, version=version), ["stub"]

    return resolver


def test_main_reports_missing_name_without_traceback(monkeypatch, tmp_path, capsys):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": [{"name": "stay"}]})
    output_path = tmp_path / "libraries.json"
    monkeypatch.setattr(
        "sys.argv",
        [
            "crawl_libraries",
            "--registry",
            str(repo_path),
            "--workspace",
            str(output_path),
            "--name",
            "msgpack",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        crawl_libraries.main()

    captured = capsys.readouterr()
    assert exc_info.value.code == 1
    assert captured.out == 'Library "msgpack" not found in registry.json.\n'
    assert "Traceback" not in captured.err
    assert "Traceback" not in captured.out


@pytest.mark.asyncio
async def test_creates_output_with_only_libraries_key_if_not_present(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": [{"name": "alpha"}]})
    output_path = tmp_path / "libraries.json"
    args = make_args(tmp_path, repo_path, output_path)

    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-01T00:00:00Z"
    )
    monkeypatch.setattr(crawl_libraries, "resolve_library", make_resolver([]))

    await crawl_libraries.run(args)

    data = read_json(output_path)
    assert set(data.keys()) == {"libraries"}
    entry = data["libraries"]["alpha"]
    assert entry["added"] == "2026-01-01T00:00:00Z"
    assert entry["last_crawl"] == "2026-01-01T00:00:00Z"
    assert entry["latest_version"] == "1.0.0"


@pytest.mark.asyncio
async def test_preserves_existing_output_keys(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": [{"name": "alpha"}]})
    output_path = tmp_path / "libraries.json"
    write_json(output_path, {"packages": {"x": 1}, "other": "keep"})
    args = make_args(tmp_path, repo_path, output_path)

    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-01T00:00:00Z"
    )
    monkeypatch.setattr(crawl_libraries, "resolve_library", make_resolver([]))

    await crawl_libraries.run(args)

    data = read_json(output_path)
    assert data["packages"] == {"x": 1}
    assert data["other"] == "keep"
    assert "libraries" in data


@pytest.mark.asyncio
async def test_record_last_crawl_and_added(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": [{"name": "alpha"}]})
    output_path = tmp_path / "libraries.json"
    args = make_args(tmp_path, repo_path, output_path)

    monkeypatch.setattr(crawl_libraries, "resolve_library", make_resolver([]))

    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-01T00:00:00Z"
    )
    await crawl_libraries.run(args)

    data = read_json(output_path)
    entry = data["libraries"]["alpha"]
    assert entry["added"] == "2026-01-01T00:00:00Z"
    assert entry["last_crawl"] == "2026-01-01T00:00:00Z"

    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-02T00:00:00Z"
    )
    await crawl_libraries.run(args)

    data = read_json(output_path)
    entry = data["libraries"]["alpha"]
    assert entry["added"] == "2026-01-01T00:00:00Z"
    assert entry["last_crawl"] == "2026-01-02T00:00:00Z"


@pytest.mark.asyncio
async def test_reports_new_library_as_added(monkeypatch, tmp_path, capsys):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": [{"name": "alpha"}]})
    output_path = tmp_path / "libraries.json"
    args = make_args(tmp_path, repo_path, output_path)

    monkeypatch.setattr(crawl_libraries, "resolve_library", make_resolver([]))
    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-01T00:00:00Z"
    )

    await crawl_libraries.run(args)

    captured = capsys.readouterr()
    assert "Added alpha." in captured.out
    assert "Nothing new." not in captured.out


@pytest.mark.asyncio
async def test_reports_multiple_updated_libraries(monkeypatch, tmp_path, capsys):
    repo_path = tmp_path / "registry.json"
    write_json(
        repo_path,
        {"libraries": [{"name": "alpha"}, {"name": "beta"}]},
    )
    output_path = tmp_path / "libraries.json"
    write_json(
        output_path,
        {
            "libraries": {
                "alpha": make_info("alpha", version="1.0.0")
                | {"added": "2025-01-01T00:00:00Z", "latest_version": "1.0.0"},
                "beta": make_info("beta", version="1.0.0")
                | {"added": "2025-01-01T00:00:00Z", "latest_version": "1.0.0"},
            }
        },
    )
    args = make_args(tmp_path, repo_path, output_path)

    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-01T00:00:00Z"
    )
    monkeypatch.setattr(
        crawl_libraries,
        "resolve_library",
        make_resolver([], version="2.0.0"),
    )

    await crawl_libraries.run(args)

    captured = capsys.readouterr()
    assert "alpha and beta have been updated." in captured.out
    assert "Added" not in captured.out


@pytest.mark.asyncio
async def test_allowed_source_filters_registry_and_reports(monkeypatch, tmp_path, capsys):
    registry_path = tmp_path / "registry.json"
    write_json(
        registry_path,
        {
            "libraries": [
                {"name": "allowed", "source": "https://allowed.example"},
                {"name": "denied", "source": "https://denied.example"},
                {"name": "missing-source"},
            ]
        },
    )
    output_path = tmp_path / "libraries.json"
    calls = []
    args = make_args(
        tmp_path,
        registry_path,
        output_path,
        allowed_source=["https://allowed.example"],
    )

    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-01T00:00:00Z"
    )
    monkeypatch.setattr(crawl_libraries, "resolve_library", make_resolver(calls))
    monkeypatch.setenv("CI", "true")

    await crawl_libraries.run(args)

    assert calls == ["allowed"]
    captured = capsys.readouterr()
    assert "Ignoring 1 libraries from https://denied.example" in captured.out
    assert "Ignoring 1 libraries without a source." in captured.out
    assert "Ignoring 1 libraries from https://allowed.example" not in captured.out
    assert "Crawled 1 libraries." in captured.out


@pytest.mark.asyncio
async def test_allowed_source_blocks_named_library(monkeypatch, tmp_path, capsys):
    registry_path = tmp_path / "registry.json"
    write_json(
        registry_path,
        {"libraries": [{"name": "denied", "source": "https://denied.example"}]},
    )
    output_path = tmp_path / "libraries.json"
    calls = []
    args = make_args(
        tmp_path,
        registry_path,
        output_path,
        name="denied",
        allowed_source=["https://allowed.example"],
    )

    async def resolver(library, cache_dir, session):
        calls.append(library["name"])
        return make_info(library["name"]), ["stub"]

    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-01T00:00:00Z"
    )
    monkeypatch.setattr(crawl_libraries, "resolve_library", resolver)
    monkeypatch.setenv("CI", "true")

    await crawl_libraries.run(args)

    assert calls == []
    captured = capsys.readouterr()
    assert "Library is not on an allowed source." in captured.out


@pytest.mark.asyncio
async def test_record_failures_and_clear_failures(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": [{"name": "alpha"}]})
    output_path = tmp_path / "libraries.json"
    write_json(
        output_path,
        {
            "libraries": {
                "alpha": make_info("alpha") | {"added": "2025-01-01T00:00:00Z"}
            }
        },
    )
    args = make_args(tmp_path, repo_path, output_path)

    async def fail_resolver(library, cache_dir, session):
        raise RuntimeError("boom")

    monkeypatch.setattr(crawl_libraries, "resolve_library", fail_resolver)
    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-01T00:00:00Z"
    )
    await crawl_libraries.run(args)

    data = read_json(output_path)
    entry = data["libraries"]["alpha"]
    assert entry["fail_reason"] == "boom"
    assert entry["failing_since"] == "2026-01-01T00:00:00Z"
    assert entry["last_crawl"] == "2026-01-01T00:00:00Z"

    monkeypatch.setattr(crawl_libraries, "resolve_library", make_resolver([]))
    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-02T00:00:00Z"
    )
    await crawl_libraries.run(args)

    data = read_json(output_path)
    entry = data["libraries"]["alpha"]
    assert "fail_reason" not in entry
    assert "failing_since" not in entry
    assert entry["last_crawl"] == "2026-01-02T00:00:00Z"


@pytest.mark.asyncio
async def test_records_failure_for_new_library(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": [{"name": "alpha"}]})
    output_path = tmp_path / "libraries.json"
    args = make_args(tmp_path, repo_path, output_path)

    async def fail_resolver(library, cache_dir, session):
        raise RuntimeError("boom")

    monkeypatch.setattr(crawl_libraries, "resolve_library", fail_resolver)
    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-01T00:00:00Z"
    )

    await crawl_libraries.run(args)

    data = read_json(output_path)
    entry = data["libraries"]["alpha"]
    assert entry["name"] == "alpha"
    assert entry["fail_reason"] == "boom"
    assert entry["failing_since"] == "2026-01-01T00:00:00Z"
    assert entry["last_crawl"] == "2026-01-01T00:00:00Z"


@pytest.mark.asyncio
async def test_handle_name_records_failure_on_write(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": [{"name": "alpha"}]})
    output_path = tmp_path / "libraries.json"
    write_json(
        output_path,
        {
            "libraries": {
                "alpha": make_info("alpha") | {"added": "2025-01-01T00:00:00Z"}
            }
        },
    )
    args = make_args(
        tmp_path,
        repo_path,
        output_path,
        name="alpha",
        write=True
    )

    async def fail_resolver(library, cache_dir, session):
        raise RuntimeError("boom")

    monkeypatch.setattr(crawl_libraries, "resolve_library", fail_resolver)
    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-01T00:00:00Z"
    )

    with pytest.raises(RuntimeError, match="boom"):
        await crawl_libraries.run(args)

    data = read_json(output_path)
    entry = data["libraries"]["alpha"]
    assert entry["fail_reason"] == "boom"
    assert entry["failing_since"] == "2026-01-01T00:00:00Z"
    assert entry["last_crawl"] == "2026-01-01T00:00:00Z"


@pytest.mark.asyncio
async def test_handle_name_records_failure_for_new_library(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": [{"name": "alpha"}]})
    output_path = tmp_path / "libraries.json"
    args = make_args(
        tmp_path,
        repo_path,
        output_path,
        name="alpha",
        write=True
    )

    async def fail_resolver(library, cache_dir, session):
        raise RuntimeError("boom")

    monkeypatch.setattr(crawl_libraries, "resolve_library", fail_resolver)
    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-01T00:00:00Z"
    )

    with pytest.raises(RuntimeError, match="boom"):
        await crawl_libraries.run(args)

    assert output_path.exists()
    data = read_json(output_path)
    entry = data["libraries"]["alpha"]
    assert entry["name"] == "alpha"
    assert entry["fail_reason"] == "boom"
    assert entry["failing_since"] == "2026-01-01T00:00:00Z"
    assert entry["last_crawl"] == "2026-01-01T00:00:00Z"


@pytest.mark.asyncio
async def test_record_removed_and_preserve_all_entry_fields(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": [{"name": "stay"}]})
    output_path = tmp_path / "libraries.json"
    write_json(
        output_path,
        {
            "packages": {"x": 1},
            "libraries": {
                "gone": make_info("gone") | {"custom": "keep"},
            },
        },
    )
    args = make_args(tmp_path, repo_path, output_path)

    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-01T00:00:00Z"
    )
    monkeypatch.setattr(crawl_libraries, "resolve_library", make_resolver([]))

    await crawl_libraries.run(args)

    data = read_json(output_path)
    gone = data["libraries"]["gone"]
    assert gone["removed"] == "2026-01-01T00:00:00Z"
    assert gone["custom"] == "keep"
    assert data["packages"] == {"x": 1}


@pytest.mark.asyncio
async def test_removed_library_is_not_crawled(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": [{"name": "stay"}]})
    output_path = tmp_path / "libraries.json"
    write_json(
        output_path,
        {
            "libraries": {
                "gone": make_info("gone") | {"removed": "2025-01-01T00:00:00Z"}
            }
        },
    )
    args = make_args(tmp_path, repo_path, output_path)
    calls = []

    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-01T00:00:00Z"
    )
    monkeypatch.setattr(crawl_libraries, "resolve_library", make_resolver(calls))

    await crawl_libraries.run(args)

    assert calls == ["stay"]


@pytest.mark.asyncio
async def test_removed_library_can_resurrect(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": [{"name": "phoenix"}]})
    output_path = tmp_path / "libraries.json"
    write_json(
        output_path,
        {
            "libraries": {
                "phoenix": make_info("phoenix")
                | {
                    "removed": "2025-01-01T00:00:00Z",
                    "added": "2024-01-01T00:00:00Z",
                }
            }
        },
    )
    args = make_args(tmp_path, repo_path, output_path)
    calls = []

    monkeypatch.setattr(
        crawl_libraries, "now_timestamp", lambda: "2026-01-01T00:00:00Z"
    )
    monkeypatch.setattr(crawl_libraries, "resolve_library", make_resolver(calls))

    await crawl_libraries.run(args)

    data = read_json(output_path)
    entry = data["libraries"]["phoenix"]
    assert "removed" not in entry
    assert entry["last_crawl"] == "2026-01-01T00:00:00Z"
    assert calls == ["phoenix"]


@pytest.mark.asyncio
async def test_handle_name_reports_release_matrix(
    monkeypatch, tmp_path, capsys
):
    repo_path = tmp_path / "registry.json"
    write_json(
        repo_path,
        {
            "libraries": [
                {
                    "name": "example",
                    "releases": [
                        {
                            "base": "https://pypi.org/project/example",
                            "asset": "example-*-cp33-cp33m-win_amd64.whl",
                            "platforms": ["windows-x64"],
                            "python_versions": ["3.3"],
                        },
                        {
                            "base": "https://pypi.org/project/example",
                            "asset": (
                                "example-*-cp33-cp33m-manylinux*_x86_64.whl"
                            ),
                            "platforms": ["linux-x64"],
                            "python_versions": ["3.3"],
                        },
                    ],
                }
            ]
        },
    )
    output_path = tmp_path / "libraries.json"
    args = make_args(tmp_path, repo_path, output_path, name="example")

    async def resolver(library, cache_dir, session):
        return (
            make_info("example")
            | {
                "releases": [
                    {
                        "url": (
                            "https://example.test/"
                            "example-1.0.0-cp33-cp33m-manylinux1_x86_64.whl"
                        ),
                        "version": "1.0.0",
                        "date": "2026-01-01T00:00:00Z",
                        "platforms": ["linux-x64"],
                        "python_versions": ["3.3"],
                        "sublime_text": "*",
                    }
                ]
            },
            ["stub"],
        )

    monkeypatch.setattr(crawl_libraries, "resolve_library", resolver)

    await crawl_libraries.run(args)

    captured = capsys.readouterr()
    assert "example release matrix; -v to see the raw JSON output" in captured.out
    assert "Sublime (all builds)" not in captured.out
    assert "py33" in captured.out
    assert "windows-x64     X" in captured.out
    assert "linux-x64       A" in captured.out
    assert "A = 1.0.0" in captured.out
    assert "X = no version found, run -v for details" in captured.out
    assert '"asset":' not in captured.out
    assert "Added example." not in captured.out


@pytest.mark.asyncio
async def test_handle_name_does_not_mark_auto_added_variants(
    monkeypatch, tmp_path, capsys
):
    repo_path = tmp_path / "registry.json"
    write_json(
        repo_path,
        {
            "libraries": [
                {
                    "name": "example",
                    "releases": [
                        {
                            "base": "https://pypi.org/project/example",
                            "asset": "example-*-cp33-cp33m-win_amd64.whl",
                        }
                    ],
                }
            ]
        },
    )
    output_path = tmp_path / "libraries.json"
    args = make_args(tmp_path, repo_path, output_path, name="example")

    async def resolver(library, cache_dir, session):
        return (
            make_info("example")
            | {
                "releases": [
                    {
                        "url": (
                            "https://example.test/"
                            "example-1.0.0-cp33-cp33m-win_amd64.whl"
                        ),
                        "version": "1.0.0",
                        "date": "2026-01-01T00:00:00Z",
                        "platforms": ["windows-x64"],
                        "python_versions": ["3.3"],
                        "sublime_text": "*",
                    }
                ]
            },
            ["stub"],
        )

    monkeypatch.setattr(crawl_libraries, "resolve_library", resolver)

    await crawl_libraries.run(args)

    captured = capsys.readouterr()
    assert "windows-x64     A" in captured.out
    assert "windows-x32" not in captured.out
    assert "py38" not in captured.out
    assert "X = no version found" not in captured.out


@pytest.mark.asyncio
async def test_handle_name_verbose_reports_unmatched_definitions(
    monkeypatch, tmp_path, capsys
):
    repo_path = tmp_path / "registry.json"
    write_json(
        repo_path,
        {
            "libraries": [
                {
                    "name": "example",
                    "releases": [
                        {
                            "base": "https://pypi.org/project/example",
                            "asset": "example-*-cp33-cp33m-win_amd64.whl",
                            "platforms": ["windows-x64", "windows-x32"],
                            "python_versions": ["3.3"],
                        }
                    ],
                }
            ]
        },
    )
    output_path = tmp_path / "libraries.json"
    args = make_args(
        tmp_path, repo_path, output_path, name="example", verbose=True
    )

    async def resolver(library, cache_dir, session):
        return (
            make_info("example")
            | {
                "releases": [
                    {
                        "url": (
                            "https://example.test/"
                            "example-1.0.0-cp33-cp33m-win_amd64.whl"
                        ),
                        "version": "1.0.0",
                        "date": "2026-01-01T00:00:00Z",
                        "platforms": ["windows-x64"],
                        "python_versions": ["3.3"],
                        "sublime_text": "*",
                    }
                ]
            },
            ["stub"],
        )

    monkeypatch.setattr(crawl_libraries, "resolve_library", resolver)

    await crawl_libraries.run(args)

    captured = capsys.readouterr()
    assert "Unmatched release definitions:" in captured.out
    assert '"platforms": [' in captured.out
    assert '"windows-x32"' in captured.out
    assert "~~~~~~~~~~~~~" in captured.out
    assert (
        "Missing match: sublime_text=*, platform=windows-x32, python_version=3.3"
        in captured.out
    )


@pytest.mark.asyncio
async def test_parse_args_write_implies_verbose(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": []})
    monkeypatch.setattr(
        crawl_libraries,
        "DEFAULT_REGISTRY",
        str(repo_path),
    )
    monkeypatch.setattr(
        "sys.argv",
        ["crawl_libraries", "--name", "example", "--write"],
    )

    args = crawl_libraries.parse_args()

    assert args.write is True
    assert args.verbose is True


def test_parse_args_try_heredoc_reads_stdin(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": []})
    monkeypatch.setattr(crawl_libraries, "DEFAULT_REGISTRY", str(repo_path))
    monkeypatch.setattr("sys.stdin", io.StringIO("base: pypi:lxml\n"))
    monkeypatch.setattr(
        "sys.argv",
        ["crawl_libraries", "--name", "lxml", "--try"],
    )

    args = crawl_libraries.parse_args()

    assert args.name == "lxml"
    assert args.try_definition == "base: pypi:lxml\n"
    assert args.try_definition_shortcut is False


def test_parse_args_try_accepts_explain(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": []})
    monkeypatch.setattr(crawl_libraries, "DEFAULT_REGISTRY", str(repo_path))
    monkeypatch.setattr(
        "sys.argv",
        ["crawl_libraries", "--explain", "lxml", "--try", "base: pypi:lxml"],
    )

    args = crawl_libraries.parse_args()

    assert args.explain == "lxml"
    assert args.try_definition == "base: pypi:lxml"
    assert args.try_definition_shortcut is True


def test_parse_args_try_accepts_inline_without_name(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": []})
    monkeypatch.setattr(crawl_libraries, "DEFAULT_REGISTRY", str(repo_path))
    monkeypatch.setattr(
        "sys.argv",
        ["crawl_libraries", "--try", "base: pypi:lxml"],
    )

    args = crawl_libraries.parse_args()

    assert args.name is None
    assert args.try_definition == "base: pypi:lxml"
    assert args.try_definition_shortcut is True


def test_parse_args_try_stdin_requires_name(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": []})
    monkeypatch.setattr(crawl_libraries, "DEFAULT_REGISTRY", str(repo_path))
    monkeypatch.setattr("sys.argv", ["crawl_libraries", "--try"])

    with pytest.raises(SystemExit):
        crawl_libraries.parse_args()


@pytest.mark.parametrize(
    ("definition", "split_semicolon", "expected"),
    [
        ("base: pypi:lxml", False, ["base: pypi:lxml"]),
        (
            "base: pypi:lxml\nplatforms: windows-x32",
            False,
            ["base: pypi:lxml", "platforms: windows-x32"],
        ),
        (
            "base: pypi:lxml; platforms: windows-x32",
            True,
            ["base: pypi:lxml", " platforms: windows-x32"],
        ),
        (
            "asset: \"foo;bar\"; platforms: windows-x32",
            True,
            ['asset: "foo;bar"', " platforms: windows-x32"],
        ),
        (
            'asset: ["foo;bar", "*.zip"]; platforms: windows-x32',
            True,
            ['asset: ["foo;bar", "*.zip"]', " platforms: windows-x32"],
        ),
        (
            "- base: pypi:lxml; platforms: windows-x32\n- base: pypi:numpy",
            True,
            ["- base: pypi:lxml", " platforms: windows-x32", "- base: pypi:numpy"],
        ),
    ],
)
def test_split_try_definition_lines(definition, split_semicolon, expected):
    assert (
        crawl_libraries.split_try_definition_lines(
            definition,
            split_semicolon=split_semicolon,
        )
        == expected
    )


@pytest.mark.parametrize(
    ("definition", "expected"),
    [
        (
            "base: pypi:lxml\nplatforms: windows-x32",
            {"base": "pypi:lxml", "platforms": "windows-x32"},
        ),
        (
            "# comment\n\nbase: pypi:lxml\n",
            {"base": "pypi:lxml"},
        ),
        (
            "tags: true\nasset: null",
            {"tags": True, "asset": None},
        ),
        (
            'asset: ["*.whl", "*.zip"]',
            {"asset": ["*.whl", "*.zip"]},
        ),
        (
            "platforms: [windows-x64, windows-x32]",
            {"platforms": ["windows-x64", "windows-x32"]},
        ),
        (
            '- base: pypi:lxml\n  platforms: windows-x64\n- base: pypi:numpy',
            [
                {"base": "pypi:lxml", "platforms": "windows-x64"},
                {"base": "pypi:numpy"},
            ],
        ),
    ],
)
def test_parse_try_key_value_definition_supported(definition, expected):
    assert crawl_libraries.parse_try_key_value_definition(definition) == expected


def test_parse_try_key_value_definition_supports_inline_separator():
    assert crawl_libraries.parse_try_key_value_definition(
        "base: pypi:lxml; platforms: windows-x32",
        split_semicolon=True,
    ) == {"base": "pypi:lxml", "platforms": "windows-x32"}


def test_parse_try_key_value_definition_keeps_stdin_semicolon_literal():
    assert crawl_libraries.parse_try_key_value_definition(
        "base: pypi:lxml; platforms: windows-x32"
    ) == {"base": "pypi:lxml; platforms: windows-x32"}


@pytest.mark.parametrize(
    ("platform_key", "platform_alias", "expected"),
    [
        ("platforms", "windows", ["windows-x64", "windows-x32"]),
        ("platforms", "osx", ["osx-x64", "osx-arm64"]),
        ("platforms", "linux", ["linux-x64", "linux-arm64"]),
        ("platform", "osx", ["osx-x64", "osx-arm64"]),
    ],
)
def test_parse_try_definition_expands_inline_platform_alias(
    platform_key,
    platform_alias,
    expected,
):
    assert crawl_libraries.parse_try_definition(
        f"base: pypi:lxml; {platform_key}: {platform_alias}",
        split_semicolon=True,
        expand_platform_aliases=True,
    ) == [
        {"base": "pypi:lxml", "platforms": expected},
    ]


def test_parse_try_definition_keeps_stdin_osx_platform_literal():
    assert crawl_libraries.parse_try_definition(
        "base: pypi:lxml\nplatforms: osx",
    ) == [{"base": "pypi:lxml", "platforms": "osx"}]


def test_parse_try_definition_accepts_inline_python_alias():
    assert crawl_libraries.parse_try_definition(
        "base: pypi:lxml; python: 3.3",
        split_semicolon=True,
        expand_platform_aliases=True,
    ) == [{"base": "pypi:lxml", "python_versions": "3.3"}]


def test_parse_try_definition_keeps_json_alias_literals():
    assert crawl_libraries.parse_try_definition(
        '{"base": "pypi:lxml", "platform": "osx", "python": "3.3"}',
        split_semicolon=True,
        expand_platform_aliases=True,
    ) == [{"base": "pypi:lxml", "platform": "osx", "python": "3.3"}]


@pytest.mark.parametrize(
    ("definition", "expected"),
    [
        ("base: pypi:lxml", "lxml"),
        ("base: github:owner/repo", "repo"),
    ],
)
def test_infer_try_library_name(definition, expected):
    assert crawl_libraries.infer_try_library_name(
        definition,
        split_semicolon=True,
    ) == expected


@pytest.mark.parametrize(
    "definition",
    [
        "base pypi:lxml",
        "- base: pypi:lxml\n  - platforms: windows-x64",
        "releases:\n  - base: pypi:lxml",
    ],
)
def test_parse_try_key_value_definition_rejects_unsupported(definition):
    with pytest.raises(ValueError):
        crawl_libraries.parse_try_key_value_definition(definition)


@pytest.mark.asyncio
async def test_handle_try_crawls_inline_release_definition(monkeypatch, tmp_path, capsys):
    repo_path = tmp_path / "registry.json"
    write_json(
        repo_path,
        {
            "libraries": [
                {
                    "name": "example",
                    "description": "registry description",
                    "author": "registry author",
                    "issues": "https://example.com/issues",
                    "releases": [{"base": "pypi:old"}],
                }
            ]
        },
    )
    output_path = tmp_path / "libraries.json"
    args = make_args(
        tmp_path,
        repo_path,
        output_path,
        name="example",
        try_definition="base: pypi:example; platforms: windows-x32",
        try_definition_shortcut=True,
    )
    calls = []

    async def resolver(library, cache_dir, session):
        calls.append(library)
        return (
            {
                "name": library["name"],
                "description": library["description"],
                "author": library["author"],
                "issues": library["issues"],
                "releases": [
                    {
                        "url": "https://example.com/example-1.0.0.whl",
                        "version": "1.0.0",
                        "date": "2026-01-01T00:00:00Z",
                        "platforms": ["windows-x32"],
                        "python_versions": ["3.3"],
                        "sublime_text": "*",
                    }
                ],
            },
            ["stub"],
        )

    monkeypatch.setattr(crawl_libraries, "resolve_library", resolver)

    result = await crawl_libraries.run(args)

    captured = capsys.readouterr()
    assert result == 0
    assert calls == [
        {
            "name": "example",
            "description": "registry description",
            "author": "registry author",
            "issues": "https://example.com/issues",
            "releases": [{"base": "pypi:example", "platforms": "windows-x32"}],
        }
    ]
    assert "release matrix" in captured.out
    assert not output_path.exists()


@pytest.mark.asyncio
async def test_handle_try_crawls_without_registry_file(monkeypatch, tmp_path):
    repo_path = tmp_path / "missing-registry.json"
    output_path = tmp_path / "libraries.json"
    args = make_args(
        tmp_path,
        repo_path,
        output_path,
        name="example",
        try_definition='{"base": "pypi:example"}',
    )
    calls = []

    async def resolver(library, cache_dir, session):
        calls.append(library)
        return (
            make_info(library["name"])
            | {
                "releases": [
                    {
                        "url": "https://example.com/example-1.0.0.whl",
                        "version": "1.0.0",
                        "date": "2026-01-01T00:00:00Z",
                        "platforms": ["windows-x32"],
                        "python_versions": ["3.3"],
                        "sublime_text": "*",
                    }
                ]
            },
            ["stub"],
        )

    monkeypatch.setattr(crawl_libraries, "resolve_library", resolver)

    result = await crawl_libraries.run(args)

    assert result == 0
    assert calls == [{"name": "example", "releases": [{"base": "pypi:example"}]}]


@pytest.mark.asyncio
async def test_handle_try_infers_name_from_inline_base(monkeypatch, tmp_path):
    repo_path = tmp_path / "missing-registry.json"
    output_path = tmp_path / "libraries.json"
    args = make_args(
        tmp_path,
        repo_path,
        output_path,
        try_definition=(
            "base: pypi:pyobjc-framework-Cocoa; platforms: osx; "
            "python_versions:3.8"
        ),
        try_definition_shortcut=True,
    )
    calls = []

    async def resolver(library, cache_dir, session):
        calls.append(library)
        return (
            make_info(library["name"])
            | {
                "releases": [
                    {
                        "url": "https://example.com/example-1.0.0.whl",
                        "version": "1.0.0",
                        "date": "2026-01-01T00:00:00Z",
                        "platforms": ["osx-x64"],
                        "python_versions": ["3.8"],
                        "sublime_text": "*",
                    }
                ]
            },
            ["stub"],
        )

    monkeypatch.setattr(crawl_libraries, "resolve_library", resolver)

    result = await crawl_libraries.run(args)

    assert result == 0
    assert calls == [
        {
            "name": "pyobjc-framework-Cocoa",
            "releases": [
                {
                    "base": "pypi:pyobjc-framework-Cocoa",
                    "platforms": ["osx-x64", "osx-arm64"],
                    "python_versions": "3.8",
                }
            ],
        }
    ]


@pytest.mark.asyncio
async def test_handle_name_verbose_reports_raw_json(monkeypatch, tmp_path, capsys):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": [{"name": "example"}]})
    output_path = tmp_path / "libraries.json"
    args = make_args(
        tmp_path, repo_path, output_path, name="example", verbose=True
    )

    monkeypatch.setattr(crawl_libraries, "resolve_library", make_resolver([]))

    await crawl_libraries.run(args)

    captured = capsys.readouterr()
    assert '"name": "example"' in captured.out
    assert "Resolved example 1.0.0 using stub." in captured.out
    assert "release matrix" not in captured.out
    assert "Added example." not in captured.out


@pytest.mark.asyncio
async def test_name_and_explain_reject_removed_library(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(repo_path, {"libraries": [{"name": "stay"}]})
    output_path = tmp_path / "libraries.json"
    write_json(
        output_path,
        {
            "libraries": {
                "gone": make_info("gone") | {"removed": "2025-01-01T00:00:00Z"}
            }
        },
    )

    args = make_args(tmp_path, repo_path, output_path, name="gone")
    assert await crawl_libraries.run(args) == 1

    args = make_args(tmp_path, repo_path, output_path, explain="gone")
    assert await crawl_libraries.run(args) == 1


@pytest.mark.asyncio
async def test_handle_explain_renders_release_variation_rows(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    release_defs = [{"base": "https://pypi.org/project/example", "version": "*"}]
    write_json(repo_path, {"libraries": [{"name": "alpha", "releases": release_defs}]})
    output_path = tmp_path / "libraries.json"
    args = make_args(tmp_path, repo_path, output_path, explain="alpha")

    explain_rows = [
        (
            release_defs[0],
            [
                {
                    "base": "https://pypi.org/project/example",
                    "asset": ["example-win-py38-${version}.zip"],
                    "platform": "windows",
                    "python_version": "3.8",
                    "sublime_text": "*",
                    "version": "*",
                    "tag_prefix": "v?",
                },
                {
                    "base": "https://pypi.org/project/example",
                    "asset": ["example-win-py33-${version}.zip"],
                    "platform": "windows",
                    "python_version": "3.3",
                    "sublime_text": "*",
                    "version": "*",
                    "tag_prefix": "v?",
                },
            ],
        ),
    ]
    captured = {}

    monkeypatch.setattr(crawl_libraries, "explain_library", lambda _: explain_rows)

    def fake_print_library_explain(name, rows, metadata=None):
        captured["name"] = name
        captured["rows"] = rows
        captured["metadata"] = metadata

    monkeypatch.setattr(
        crawl_libraries,
        "print_library_explain",
        fake_print_library_explain,
    )

    result = await crawl_libraries.run(args)

    assert result == 0
    assert captured["name"] == "alpha"
    assert captured["rows"] == explain_rows
    assert captured["metadata"] == {"name": "alpha"}


@pytest.mark.asyncio
async def test_handle_explain_uses_try_definition(monkeypatch, tmp_path):
    repo_path = tmp_path / "registry.json"
    write_json(
        repo_path,
        {
            "libraries": [
                {
                    "name": "alpha",
                    "description": "registry description",
                    "author": "registry author",
                    "issues": "https://example.com/issues",
                    "releases": [{"base": "pypi:old"}],
                }
            ]
        },
    )
    output_path = tmp_path / "libraries.json"
    args = make_args(
        tmp_path,
        repo_path,
        output_path,
        explain="alpha",
        try_definition="base: pypi:alpha\nplatforms: windows-x32",
    )
    captured = {}

    def fake_explain_library(library):
        captured["library"] = library
        return []

    def fake_print_library_explain(name, rows, metadata=None):
        captured["name"] = name
        captured["rows"] = rows
        captured["metadata"] = metadata

    monkeypatch.setattr(crawl_libraries, "explain_library", fake_explain_library)
    monkeypatch.setattr(
        crawl_libraries,
        "print_library_explain",
        fake_print_library_explain,
    )

    result = await crawl_libraries.run(args)

    assert result == 0
    assert captured["library"] == {
        "name": "alpha",
        "description": "registry description",
        "author": "registry author",
        "issues": "https://example.com/issues",
        "releases": [{"base": "pypi:alpha", "platforms": "windows-x32"}],
    }
    assert captured["name"] == "alpha"
    assert captured["rows"] == []
    assert captured["metadata"] == {
        "name": "alpha",
        "description": "registry description",
        "author": "registry author",
        "issues": "https://example.com/issues",
    }


@pytest.mark.parametrize(
    ("names", "expected"),
    [
        (["alpha"], "Added alpha."),
        (["alpha", "beta"], "Added alpha and beta."),
        (["alpha", "beta", "gamma"], "Added alpha, beta, and gamma."),
        (["a", "b", "c", "d", "e"], "Added a, b, c, d, and e."),
        (["a", "b", "c", "d", "e", "f"], "Added 6 libraries."),
    ],
)
def test_format_added_message(names, expected):
    assert crawl_libraries.format_added_message(names) == expected


@pytest.mark.parametrize(
    ("names", "expected"),
    [
        (["alpha"], "alpha has been updated."),
        (["alpha", "beta"], "alpha and beta have been updated."),
        (["alpha", "beta", "gamma"], "alpha, beta, and gamma have been updated."),
    ],
)
def test_format_updated_message(names, expected):
    assert crawl_libraries.format_updated_message(names) == expected
