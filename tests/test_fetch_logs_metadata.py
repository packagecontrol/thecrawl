import scripts.fetch_logs_metadata as fetch_logs_metadata


def test_fetch_logs_metadata_writes_fetch_outputs(monkeypatch):
    def fake_fetch_runs(_repo, _workflow_id, _since):
        return [{"id": 2}, {"id": 1}]

    artifact_data = [
        {
            "run_id": "1",
            "id": 100,
            "name": "crawl-backup",
            "size": 200,
            "url": "https://github.com/owner/repo/actions/runs/1/artifacts/100",
        },
        {
            "run_id": "2",
            "id": 101,
            "name": "stats-backup",
            "size": 300,
            "url": "https://github.com/owner/repo/actions/runs/2/artifacts/101",
        },
    ]

    def fake_fetch_artifacts(_repo, run_ids, *, max_pages):
        assert run_ids == {"1", "2"}
        assert max_pages == 10
        return artifact_data

    writes = []

    def fake_write_json(path, data, *, pretty, ensure_ascii):
        writes.append((path, data, pretty, ensure_ascii))

    monkeypatch.setattr(fetch_logs_metadata, "fetch_runs", fake_fetch_runs)
    monkeypatch.setattr(fetch_logs_metadata, "fetch_artifacts", fake_fetch_artifacts)
    monkeypatch.setattr(fetch_logs_metadata, "write_json", fake_write_json)

    args = fetch_logs_metadata.Args(
        repo="owner/repo",
        workflow_id="123",
        runs_output="runs.json",
        artifacts_output="artifacts.json",
        since="2026-01-01T00:00:00Z",
        artifacts_max_pages=10,
        pretty=True,
    )

    fetch_logs_metadata.fetch_logs_metadata(args)

    assert writes[0] == ("runs.json", [{"id": 2}, {"id": 1}], True, True)
    assert writes[1] == ("artifacts.json", artifact_data, True, True)


def test_parse_repo_from_remote_supports_https_and_ssh():
    https_url = "https://github.com/packagecontrol/thecrawl.git"
    ssh_url = "git@github.com:packagecontrol/thecrawl.git"

    assert fetch_logs_metadata.parse_repo_from_remote(https_url) == "packagecontrol/thecrawl"
    assert fetch_logs_metadata.parse_repo_from_remote(ssh_url) == "packagecontrol/thecrawl"


def test_resolve_workflow_id_falls_back_to_workflow_filename(monkeypatch):
    monkeypatch.delenv("WORKFLOW_ID", raising=False)

    called_args = []

    def fake_run_gh_json(args):
        called_args.append(args)
        return 123456

    monkeypatch.setattr(fetch_logs_metadata, "run_gh_json", fake_run_gh_json)

    resolved = fetch_logs_metadata.resolve_workflow_id(None, "owner/repo", "crawl.yml")

    assert resolved == "123456"
    assert called_args == [[
        "repos/owner/repo/actions/workflows/crawl.yml",
        "--method",
        "GET",
        "--jq",
        ".id",
    ]]


def test_run_gh_json_raises_on_invalid_json(monkeypatch):
    class Process:
        returncode = 0
        stdout = "{invalid-json}"
        stderr = ""

    def fake_run(*_args, **_kwargs):
        return Process()

    monkeypatch.setattr(fetch_logs_metadata.subprocess, "run", fake_run)

    try:
        fetch_logs_metadata.run_gh_json(["repos/owner/repo/actions/runs"])
        assert False, "Expected SystemExit for invalid JSON"
    except SystemExit as exc:
        message = str(exc)
        assert "invalid JSON" in message
        assert "gh api repos/owner/repo/actions/runs" in message


def test_fetch_runs_pages_until_short_page(monkeypatch):
    calls = []

    def fake_run_gh_json(args):
        calls.append(args)
        page_arg = next(item for item in args if item.startswith("page="))
        page = int(page_arg.split("=", 1)[1])

        if page == 1:
            return {
                "workflow_runs": [
                    {
                        "id": run_id,
                        "conclusion": "success",
                        "run_started_at": f"2026-01-01T00:{run_id:02d}:00Z",
                    }
                    for run_id in range(1, 101)
                ]
            }

        return {
            "workflow_runs": [
                {
                    "id": 101,
                    "conclusion": "failure",
                    "run_started_at": "2026-01-01T01:41:00Z",
                },
            ]
        }

    monkeypatch.setattr(fetch_logs_metadata, "run_gh_json", fake_run_gh_json)

    runs = fetch_logs_metadata.fetch_runs(
        "owner/repo",
        "123",
        "2026-01-01T00:00:00Z",
    )

    assert len(runs) == 101
    assert [
        next(item for item in call if item.startswith("page="))
        for call in calls
    ] == ["page=1", "page=2"]
    assert runs[0] == {
        "id": 1,
        "conclusion": "success",
        "run_started_at": "2026-01-01T00:01:00Z",
    }
    assert runs[-1] == {
        "id": 101,
        "conclusion": "failure",
        "run_started_at": "2026-01-01T01:41:00Z",
    }


def test_fetch_artifacts_keeps_collecting_matching_items_after_remaining_empty(monkeypatch):
    def fake_run_gh_paginated(_key, _cmd, **_kwargs):
        yield {"id": 1, "name": "a", "size_in_bytes": 11, "workflow_run": {"id": 42}}
        yield {"id": 2, "name": "b", "size_in_bytes": 22, "workflow_run": {"id": 42}}
        yield {"id": 3, "name": "c", "size_in_bytes": 33, "workflow_run": {"id": 999}}
        yield {"id": 4, "name": "d", "size_in_bytes": 44, "workflow_run": {"id": 42}}

    monkeypatch.setattr(fetch_logs_metadata, "run_gh_paginated", fake_run_gh_paginated)

    artifacts = fetch_logs_metadata.fetch_artifacts(
        "owner/repo",
        {"42"},
        max_pages=10,
    )

    assert artifacts == [
        {
            "run_id": "42",
            "id": 1,
            "name": "a",
            "size": 11,
            "url": "https://github.com/owner/repo/actions/runs/42/artifacts/1",
        },
        {
            "run_id": "42",
            "id": 2,
            "name": "b",
            "size": 22,
            "url": "https://github.com/owner/repo/actions/runs/42/artifacts/2",
        },
    ]


def test_fetch_artifacts_stops_after_matching_run_ids(monkeypatch):
    calls = []

    def fake_run_gh_json(args):
        calls.append(args)
        return {
            "artifacts": [
                {
                    "id": 1,
                    "name": "crawl-backup",
                    "size_in_bytes": 11,
                    "workflow_run": {"id": 42},
                },
            ]
        }

    monkeypatch.setattr(fetch_logs_metadata, "run_gh_json", fake_run_gh_json)

    artifacts = fetch_logs_metadata.fetch_artifacts(
        "owner/repo",
        {"42"},
        max_pages=10,
    )

    assert len(calls) == 1
    assert artifacts == [{
        "run_id": "42",
        "id": 1,
        "name": "crawl-backup",
        "size": 11,
        "url": "https://github.com/owner/repo/actions/runs/42/artifacts/1",
    }]
