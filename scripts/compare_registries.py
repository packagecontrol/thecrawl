import argparse
import re
import json

from pathlib import Path


def compare_registries(registry_file1: Path, registry_file2: Path):
    pkgs1 = load_compatible_packages(registry_file1)
    pkgs2 = load_compatible_packages(registry_file2)

    if pkgs1 == pkgs2:
        print("Both registries provide same packages!")
        return

    set1 = set(pkgs1)
    set2 = set(pkgs2)

    if extra := set2 - set1:
        print(f"{len(extra)} extra packages in {registry_file2}:")
        for pkg in sorted(extra):
            print(f"  + {pkg}")

    if missing := set1 - set2:
        print(f"{len(missing)} less packages in {registry_file2}:")
        for pkg in sorted(missing):
            print(f"  - {pkg}")


def load_compatible_packages(registry_file: Path) -> list[str]:
    with open(registry_file) as fp:
        content = json.load(fp)

    return sorted(
        package["name"]
        for package in content["packages"]
        if has_compatible_release(package["releases"])
    )


def has_compatible_release(releases):
    for rel in releases:
        if st_spec := rel.get("sublime_text"):
            # filter incompatible releases (PC4 requires ST3143+)
            if match := re.match(r'([<>]=?)(\d{4})$', st_spec):
                op, ver = match.groups()
                if op == '<' and int(ver) < 3143:
                    continue
                if op == '<=' and int(ver) < 3142:
                    continue
            elif (match := re.match(r'(\d{4}) - (\d{4})$', st_spec)) and int(match.group(2)) <= 3142:
                continue
        return True
    return False


def parse_args():
    parser = argparse.ArgumentParser(
        description="Compare two registries to verify both provide"
            " same set of Package Control 4 compatible packages."
    )
    parser.add_argument(
        "--registry1",
        type=str,
        help=f"Path to the first registry JSON file")
    parser.add_argument(
        "--registry2",
        type=str,
        help=f"Path to the second registry JSON file")
    return parser.parse_args()


def main():
    args = parse_args()
    compare_registries(Path(args.registry1), Path(args.registry2))


if __name__ == '__main__':
    main()
