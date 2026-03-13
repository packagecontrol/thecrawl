import json

from scripts.crawl import (
    classify_tags_mode,
    explain_main,
    keep_newest_release_definitions,
    sorted_release_definitions,
)


def test_classify_tags_mode_when_all_releases_use_tags() -> None:
    releases = [
        {"sublime_text": "<4000", "tags": "st3-"},
        {"sublime_text": "*", "tags": True},
    ]

    assert classify_tags_mode(sorted_release_definitions(releases)) is True


def test_classify_tags_mode_when_only_newest_release_uses_tags() -> None:
    releases = [
        {"sublime_text": "*", "tags": True},
        {"sublime_text": "<4000", "branch": True},
    ]

    assert classify_tags_mode(sorted_release_definitions(releases)) == "effective"


def test_classify_tags_mode_when_newest_release_does_not_use_tags() -> None:
    releases = [
        {"sublime_text": "<4000", "tags": True},
        {"sublime_text": "*", "branch": True},
    ]

    assert classify_tags_mode(sorted_release_definitions(releases)) is False


def test_keep_newest_release_definitions_keeps_highest_build_only() -> None:
    releases = [
        {"sublime_text": "<4000", "tags": "st3-"},
        {"sublime_text": "*", "tags": "st4-linux-"},
        {"sublime_text": "*", "platforms": ["windows"], "tags": "st4-win-"},
    ]

    newest = keep_newest_release_definitions(sorted_release_definitions(releases))

    assert len(newest) == 2
    assert all(release.get("sublime_text") == "*" for release in newest)


def test_explain_main_effective_mode_emits_plain_text(monkeypatch, capsys, tmp_path) -> None:
    registry = {
        "packages": [
            {
                "name": "ExamplePkg",
                "details": "https://github.com/example/pkg",
                "source": "https://raw.githubusercontent.com/example/channel/main/repository.json",
                "schema_version": "3.0.0",
                "releases": [
                    {"sublime_text": "<4000", "branch": True},
                    {"sublime_text": "*", "tags": "st4-linux-"},
                    {
                        "sublime_text": "*",
                        "platforms": ["windows"],
                        "tags": "st4-win-",
                    },
                ],
            }
        ]
    }
    registry_path = tmp_path / "registry.json"
    registry_path.write_text(json.dumps(registry), encoding="utf-8")

    monkeypatch.setenv("EFFECTIVE", "1")

    assert explain_main(str(registry_path), "ExamplePkg") == 0

    out = capsys.readouterr().out
    first_line, json_payload = out.split("\n", 1)
    assert first_line == "ExamplePkg uses (effectively) the tags-mode."

    explained = json.loads(json_payload)
    assert explained["name"] == "ExamplePkg"
    assert len(explained["releases"]) == 2
    assert all("tags" in release for release in explained["releases"])


def test_explain_main_effective_mode_omits_status_line_when_not_tags_mode(
    monkeypatch,
    capsys,
    tmp_path,
) -> None:
    registry = {
        "packages": [
            {
                "name": "NoTagsPkg",
                "details": "https://github.com/example/no-tags",
                "source": "https://raw.githubusercontent.com/example/channel/main/repository.json",
                "schema_version": "3.0.0",
                "releases": [
                    {"sublime_text": "*", "branch": True},
                ],
            }
        ]
    }
    registry_path = tmp_path / "registry.json"
    registry_path.write_text(json.dumps(registry), encoding="utf-8")

    monkeypatch.setenv("EFFECTIVE", "1")

    assert explain_main(str(registry_path), "NoTagsPkg") == 0

    out = capsys.readouterr().out
    assert out.startswith("{")
    explained = json.loads(out)
    assert explained["name"] == "NoTagsPkg"
