


DEFAULT_WORKSPACE = "./workspace.json"
DEFAULT_OUTPUT_FILE = "./channel.json"



async def main(workspace: str, output: str) -> None:
    ...



if __name__ == "__main__":
    args = parse_args()
    output = os.path.abspath(args.output)
    asyncio.run(main(workspace, output))
