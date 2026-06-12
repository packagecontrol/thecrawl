from __future__ import annotations

import aiohttp
import argparse
import asyncio
from collections import defaultdict
import json
import os
import sys

from ._utils import pl, write_json, create_aiohttp_session


NEW_CHANNEL = (
    "https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/channel.json"
)
DEFAULT_OUTPUT_FILE = "./channel.json"

type Release = dict


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collate Package Control channels")
    parser.add_argument(
        "--channel",
        "-i",
        type=str,
        default=NEW_CHANNEL,
        help=f"Input channel URL or path (default: {NEW_CHANNEL})"
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default=DEFAULT_OUTPUT_FILE,
        help=f"Path to the output file (default: {DEFAULT_OUTPUT_FILE})"
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print the output JSON with indent=2"
    )
    parser.add_argument(
        "--legacy",
        action="store_true",
        help="Make a legacy channel, suitable for Sublime Text 3"
    )
    return parser.parse_args()


async def main(
    output_file: str = DEFAULT_OUTPUT_FILE,
    pretty: bool = False,
    legacy: bool = False,
    in_channel: str = NEW_CHANNEL,
) -> None:
    async with create_aiohttp_session() as session:
        new_channel = await load_channel(in_channel, session)

    channel = {
        "schema_version": "4.0.0",
        "repositories": new_channel["repositories"],
        "packages_cache": new_channel["packages_cache"],
        "libraries_cache": new_channel["libraries_cache"],
    }

    for repo_url, packages in channel["libraries_cache"].items():
        packages.sort(key=lambda p: p["name"])
        for p in packages:
            if "releases" in p:
                p["releases"].sort(
                    key=lambda r: (
                        r.get("date") or r.get("version"),
                        r.get("platforms"),
                        r.get("sublime_text")
                    )
                )

    is_outdated = is_outdated_for_st3 if legacy else is_outdated_for_st4
    drop_count: defaultdict[str, int] = defaultdict(int)
    for key in ("packages_cache", "libraries_cache"):
        for repo_url, packages in channel[key].items():
            for p in packages[:]:
                releases = p["releases"]
                for r in releases[:]:
                    if is_outdated(r):
                        releases.remove(r)
                if not releases:
                    drop_count[key] += 1
                    packages.remove(p)
                    continue
                # Must re-compute "last_modified", but libraries don't have that
                if key == "packages_cache":
                    p["last_modified"] = max((r["date"] for r in releases))

    write_json(output_file, channel, pretty=pretty, ensure_ascii=True)

    repository_count = len(channel["repositories"])
    package_count = sum(len(pkgs) for pkgs in channel["packages_cache"].values())
    library_count = sum(len(pkgs) for pkgs in channel["libraries_cache"].values())
    print(f"Wrote {output_file}")
    print(
        f"Collated {pl(repository_count, 'repositories')} with "
        f"{pl(package_count, 'packages')} and "
        f"{pl(library_count, 'libraries')}."
    )
    print(
        f"Dropped {pl(drop_count['packages_cache'], 'outdated packages')} "
        f"and {pl(drop_count['libraries_cache'], 'outdated libraries')}."
    )

    # print the ten most recent packages
    print("\nTen most recent packages:")
    recent_packages = sorted(
        (p for pkgs in channel['packages_cache'].values() for p in pkgs),
        key=lambda p: p["last_modified"],
        reverse=True
    )[:10]
    for p in recent_packages:
        homepage = p['homepage']
        if ' ' in homepage:
            homepage = f"<{homepage}>"
        print(f" - [{p['name']}]({homepage}) - Last modified: {p['last_modified']}")


def is_outdated_for_st4(rel: Release) -> bool:
    req = rel["sublime_text"].replace(" ", "")
    return any(test in req for test in ("<3000", "-3", "<40", "-40", "<410", "-410"))


def is_outdated_for_st3(rel: Release) -> bool:
    req = rel["sublime_text"].replace(" ", "")
    return any(test in req for test in ("<3000", ">4", ">=4")) or req.startswith("4")


def err(*args, **kwargs):
    print(*args, **kwargs, file=sys.stderr)


async def load_channel(location: str, session: aiohttp.ClientSession) -> dict:
    if location.startswith(("http://", "https://")):
        return await http_get_json(location, session)

    path = os.path.abspath(os.path.expanduser(location))
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


async def http_get_json(location: str, session: aiohttp.ClientSession) -> dict:
    headers = {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    }
    async with session.get(location, headers=headers) as resp:
        return await resp.json(content_type=None)


if __name__ == "__main__":
    args = parse_args()
    args.output = os.path.abspath(args.output)
    asyncio.run(
        main(
            args.output,
            pretty=args.pretty,
            legacy=args.legacy,
            in_channel=args.channel
        )
    )
