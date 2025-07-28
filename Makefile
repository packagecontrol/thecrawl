build:
	npm install
	# workspace from https://github.com/packagecontrol/thecrawl
	curl -o workspace.json -L "https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/workspace.json"
	# libraries repository from https://github.com/packagecontrol/channel
	curl -o libraries.json -L "https://raw.githubusercontent.com/packagecontrol/channel/refs/heads/main/repository.json"
	npx @11ty/eleventy
	curl -o _site/channel.json -L "https://github.com/packagecontrol/thecrawl/releases/download/the-channel/channel.json"
	curl -o _site/channel_st3.json -L "https://github.com/packagecontrol/thecrawl/releases/download/the-st3-channel/channel_st3.json"

lint:
	npx eslint

clean:
	rm -rf _site/*

serve:
	open http://localhost:8080/
	npx @11ty/eleventy --serve --quiet
