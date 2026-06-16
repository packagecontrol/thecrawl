from scripts.github import find_prefetched_readme_content, grab_tags


def test_grab_tags_prefers_tagger_date_when_available():
    entries = {
        "nodes": [
            {
                "name": "4.28.2",
                "target": {
                    "tagger": {
                        "date": "2025-10-31T09:04:04+01:00",
                        "email": "herr.kaste@gmail.com",
                        "name": "herr kaste",
                    },
                    "target": {
                        "committedDate": "2025-10-31T08:01:55Z",
                        "authoredDate": "2025-10-31T08:01:55Z",
                    },
                },
            }
        ]
    }

    assert grab_tags("owner/repo", entries) == [
        {
            "name": "4.28.2",
            "date": "2025-10-31T08:04:04Z",
            "url": "https://codeload.github.com/owner/repo/zip/4.28.2",
        }
    ]


def test_grab_tags_falls_back_to_commit_date_without_tagger():
    entries = {
        "nodes": [
            {
                "name": "4.28.2",
                "target": {
                    "target": {
                        "committedDate": "2025-10-31T08:01:55Z",
                    }
                },
            }
        ]
    }

    assert grab_tags("owner/repo", entries) == [
        {
            "name": "4.28.2",
            "date": "2025-10-31T08:01:55Z",
            "url": "https://codeload.github.com/owner/repo/zip/4.28.2",
        }
    ]


def test_find_prefetched_readme_content_matches_selected_readme():
    repo_data = {
        "readmeUpper": {
            "isBinary": False,
            "isTruncated": False,
            "text": "# Upper\n",
        },
        "readmeLower": {
            "isBinary": False,
            "isTruncated": False,
            "text": "# Lower\n",
        },
    }

    assert find_prefetched_readme_content(
        repo_data,
        "https://raw.githubusercontent.com/owner/repo/main/readme.md",
        "owner",
        "repo",
        "main",
    ) == "# Lower\n"


def test_find_prefetched_readme_content_skips_truncated_blob():
    repo_data = {
        "readmeUpper": {
            "isBinary": False,
            "isTruncated": True,
            "text": "# Truncated\n",
        },
    }

    assert find_prefetched_readme_content(
        repo_data,
        "https://raw.githubusercontent.com/owner/repo/main/README.md",
        "owner",
        "repo",
        "main",
    ) is None
