from scripts.github import grab_tags


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
