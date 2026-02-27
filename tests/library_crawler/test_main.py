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
    limit=10,
    allowed_source=None,
    write=False,
):
    if allowed_source is None:
        allowed_source = []
    return crawl_libraries.Args(
        registry=registry_path,
        allowed_sources=set(allowed_source),
        name=name,
        explain=explain,
        write=write,
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
    with pytest.raises(ValueError, match="not found"):
        await crawl_libraries.run(args)

    args = make_args(tmp_path, repo_path, output_path, explain="gone")
    with pytest.raises(ValueError, match="not found"):
        await crawl_libraries.run(args)


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
