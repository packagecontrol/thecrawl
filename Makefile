build:
	npm install
	curl -o workspace.json -L "https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/workspace.json"

serve:
	open http://localhost:8080/
	npx @11ty/eleventy --serve --quiet
