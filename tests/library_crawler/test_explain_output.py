from rich.console import Console

from scripts._explain_package import print_library_explain


def test_print_library_explain_uses_compact_side_by_side_table() -> None:
    console = Console(width=120, color_system=None, record=True)

    print_library_explain(
        "numpy",
        [
            (
                {
                    "base": "pypi:numpy",
                    "platforms": "linux-x64",
                    "python_versions": "3.14",
                },
                [
                    {
                        "asset": [
                            "*-${version}-cp314-cp314m-manylinux*_x86_64.whl",
                            "*-${version}-cp314-cp314-manylinux*_x86_64.whl",
                            "*-${version}-py3-none-manylinux*_x86_64.whl",
                            "*-${version}-py2.py3-none-manylinux*_x86_64.whl",
                            "*-${version}-py3-none-any.whl",
                            "*-${version}-py2.py3-none-any.whl",
                        ],
                        "base": "https://pypi.org/project/numpy",
                        "platform": "linux-x64",
                        "python_version": "3.14",
                        "sublime_text": "*",
                        "tag_prefix": "v?",
                        "version": "*",
                    }
                ],
            )
        ],
        metadata={
            "author": "Numpy",
            "description": "NumPy is the fundamental package for scientific computing with Python.",
            "issues": "https://github.com/numpy/numpy/issues",
            "name": "numpy",
            "schema_version": "4.0.0",
            "source": "https://raw.githubusercontent.com/packagecontrol/channel/refs/heads/main/repository.json",
        },
        console=console,
    )

    assert strip_trailing_whitespace(console.export_text()) == """{
  "author": "Numpy",
  "description": "NumPy is the fundamental package for scientific computing with Python.",
  "issues": "https://github.com/numpy/numpy/issues",
  "name": "numpy",
  "schema_version": "4.0.0",
  "source": "https://raw.githubusercontent.com/packagecontrol/channel/refs/heads/main/repository.json"
}

#   Input definition                 Normalized variation
───────────────────────────────────────────────────────────────────────────────────────────
1   {                                {
      "base": "pypi:numpy",            "asset": [
      "platforms": "linux-x64",          "*-${version}-cp314-cp314m-manylinux*_x86_64.whl",
      "python_versions": "3.14"          "*-${version}-cp314-cp314-manylinux*_x86_64.whl",
    }                                    "*-${version}-py3-none-manylinux*_x86_64.whl",
                                         "*-${version}-py2.py3-none-manylinux*_x86_64.whl",
                                         "*-${version}-py3-none-any.whl",
                                         "*-${version}-py2.py3-none-any.whl"
                                       ],
                                       "base": "https://pypi.org/project/numpy",
                                       "platform": "linux-x64",
                                       "python_version": "3.14",
                                       "sublime_text": "*",
                                       "tag_prefix": "v?",
                                       "version": "*"
                                     }
"""


def strip_trailing_whitespace(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.splitlines()) + "\n"
