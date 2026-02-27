import pytest

from scripts.crawl import normalize_release_definition, parse_sublime_text_max


REPO_URL = "https://raw.githubusercontent.com/example/channel/main/repository.json"


def test_adds_synthetic_release_when_missing() -> None:
    releases: list[dict] = []

    normalize_release_definition(
        releases,
        REPO_URL,
        "https://github.com/example/implicit-release",
    )

    assert len(releases) == 1
    assert releases[0]["sublime_text"] == "*"
    assert releases[0]["platforms"] == ["*"]
    assert releases[0]["tags"] is True
    assert releases[0]["base"] == "https://github.com/example/implicit-release"


def test_autofills_tags_when_asset_and_branch_missing() -> None:
    releases = [{"sublime_text": "*"}]

    normalize_release_definition(
        releases,
        REPO_URL,
        "https://github.com/example/auto-tags",
    )

    assert releases[0]["tags"] is True
    assert releases[0]["base"] == "https://github.com/example/auto-tags"


def test_does_not_autofill_tags_for_static_url_release() -> None:
    releases = [{
        "sublime_text": "*",
        "url": "https://example.com/pkg.zip",
        "version": "1.2.3",
        "date": "2024-05-10T12:00:00Z",
    }]

    normalize_release_definition(
        releases,
        REPO_URL,
        "https://github.com/example/static-release",
    )

    assert "tags" not in releases[0]
    assert releases[0]["url"] == "https://example.com/pkg.zip"
    assert releases[0]["version"] == "1.2.3"


def test_normalizes_version_constraint_for_dynamic_release() -> None:
    releases = [{
        "sublime_text": "<4000",
        "version": "2.5.*",
    }]

    normalize_release_definition(
        releases,
        REPO_URL,
        "https://github.com/example/version-spec",
    )

    assert releases[0]["version"] == "==2.5.*"


@pytest.mark.parametrize("field", ["asset", "branch", "tags"])
def test_does_not_overwrite_existing_release_source(field: str) -> None:
    releases = [{field: True}]

    normalize_release_definition(
        releases,
        REPO_URL,
        "https://github.com/example/source-is-already-defined",
    )

    assert "tags" not in releases[0] or field == "tags"


@pytest.mark.parametrize(
    ("selector", "expected"),
    [
        (None, float("inf")),
        ("", float("inf")),
        ("*", float("inf")),
        ("  *  ", float("inf")),
        ("3092", 3092),
        ("3092 - 4000", 4000),
        ("3092-4000", 4000),
        ("<3092", 3091),
        ("<=3092", 3092),
        (">3092", float("inf")),
        (">=3092", float("inf")),
        (" >=  4075 ", float("inf")),
        (">  4075", float("inf")),
        ("n/a", float("inf")),
    ],
)
def test_parse_sublime_text_max(selector, expected: float) -> None:
    assert parse_sublime_text_max(selector) == expected


def test_adds_open_ended_tags_release_for_version_constrained_tags() -> None:
    releases = [{
        "sublime_text": "<4000",
        "version": "<3.0.0",
    }]

    normalize_release_definition(
        releases,
        REPO_URL,
        "https://github.com/example/constrained-tags",
    )

    assert len(releases) == 2
    first, second = releases
    assert first["tags"] is True
    assert first["sublime_text"] == "<4000"
    assert second["tags"] is True
    assert second["sublime_text"] == ">3999"


def test_does_not_add_open_ended_when_unconstrained_tags_exists() -> None:
    releases = [
        {"sublime_text": "3000 - 4000", "version": "<3.0.0"},
        {"sublime_text": ">4000", "tags": True},
    ]

    normalize_release_definition(
        releases,
        REPO_URL,
        "https://github.com/example/constrained-tags",
    )

    assert len(releases) == 2


def test_does_not_add_open_ended_without_any_version_key() -> None:
    releases = [{"sublime_text": "3000 - 4000"}]

    normalize_release_definition(
        releases,
        REPO_URL,
        "https://github.com/example/constrained-tags",
    )

    assert len(releases) == 1
    assert releases[0]["sublime_text"] == "3000 - 4000"
    assert releases[0]["tags"] is True


def test_does_not_add_open_ended_for_empty_version() -> None:
    releases = [{"sublime_text": "3000 - 4000", "version": ""}]

    normalize_release_definition(
        releases,
        REPO_URL,
        "https://github.com/example/constrained-tags",
    )

    assert len(releases) == 1
    assert releases[0]["sublime_text"] == "3000 - 4000"


def test_does_not_add_open_ended_when_any_release_lacks_version() -> None:
    releases = [
        {"sublime_text": "3000 - 4000", "version": "<3.0.0"},
        {"sublime_text": "4001 - 4200"},
    ]

    normalize_release_definition(
        releases,
        REPO_URL,
        "https://github.com/example/constrained-tags",
    )

    assert len(releases) == 2


def test_does_not_add_open_ended_when_branch_or_asset_exists() -> None:
    releases = [
        {"sublime_text": "3000 - 4000", "version": "<3.0.0"},
        {"sublime_text": "*", "branch": True},
    ]

    normalize_release_definition(releases, REPO_URL, "https://github.com/example/pkg")

    assert len(releases) == 2


def test_does_not_add_open_ended_for_static_releases() -> None:
    releases = [{
        "sublime_text": "*",
        "version": "1.2.3",
        "url": "https://example.com/pkg.zip",
        "date": "2024-05-10T12:00:00Z",
    }]

    normalize_release_definition(releases, REPO_URL, "https://github.com/example/pkg")

    assert len(releases) == 1


def test_normalizes_platforms_string_to_list() -> None:
    releases = [{"platforms": "linux", "tags": True}]

    normalize_release_definition(releases, REPO_URL, "https://github.com/example/pkg")

    assert releases[0]["platforms"] == ["linux"]
    assert releases[0]["sublime_text"] == "*"


def test_removes_invalid_sublime_text_list_without_asset(capsys) -> None:
    releases = [{"sublime_text": ["*"], "tags": True}]

    normalize_release_definition(releases, REPO_URL, "https://github.com/example/pkg")

    err = capsys.readouterr().err
    assert "sublime_text as a list is only valid in conjunction with 'asset'" in err
    assert releases == []


def test_resolves_relative_base_url() -> None:
    releases = [{"base": "./repo", "tags": True}]

    normalize_release_definition(releases, REPO_URL)

    assert releases[0]["base"] == "https://raw.githubusercontent.com/example/channel/main/repo"


def test_resolves_and_updates_download_url() -> None:
    releases = [{
        "url": "https://nodeload.github.com/example/pkg/zipball/main",
        "version": "1.2.3",
        "date": "2024-05-10T12:00:00Z",
    }]

    normalize_release_definition(releases, REPO_URL)

    assert releases[0]["url"] == "https://codeload.github.com/example/pkg/zip/main"


@pytest.mark.parametrize(
    ("date_input", "date_expected"),
    [
        ("2024-05-10 12:00", "2024-05-10T12:00:00Z"),
        ("2024-05-10", "2024-05-10T00:00:00Z"),
    ],
)
def test_normalizes_stylized_dates(
    date_input: str,
    date_expected: str,
) -> None:
    releases = [{
        "url": "https://example.com/pkg.zip",
        "version": "1.2.3",
        "date": date_input,
    }]

    normalize_release_definition(releases, REPO_URL)

    assert releases[0]["date"] == date_expected


def test_removes_release_with_invalid_date(capsys) -> None:
    releases = [{
        "url": "https://example.com/pkg.zip",
        "version": "1.2.3",
        "date": "May 10, 2024",
    }]

    normalize_release_definition(releases, REPO_URL)

    err = capsys.readouterr().err
    assert "date May 10, 2024 is not formatted correctly" in err
    assert releases == []
