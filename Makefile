build:
	npm install
	curl -o workspace.json -L "https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/workspace.json"
	curl -o libraries.json -L "https://raw.githubusercontent.com/packagecontrol/channel/refs/heads/main/repository.json"
	npx @11ty/eleventy

fetch:
	curl -o workspace.json -L "https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/workspace.json"
	curl -o libraries.json -L "https://raw.githubusercontent.com/packagecontrol/channel/refs/heads/main/repository.json"

lint:
	npx eslint

clean:
	rm -rf _site/*
	rm -f libraries.json

serve:
	open http://localhost:8080/
	npx @11ty/eleventy --serve --quiet
