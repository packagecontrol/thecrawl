build:
	npm install
	curl -o workspace.json -L "https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/workspace.json"
	npx @11ty/eleventy

serve:
	open http://localhost:8080/the-packages-site/
	npx @11ty/eleventy --serve --quiet
