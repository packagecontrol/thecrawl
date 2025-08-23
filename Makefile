build:
	npm install
	# workspace from https://github.com/packagecontrol/thecrawl
	curl -o workspace.json -L "https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/workspace.json"
	# libraries repository from https://github.com/packagecontrol/channel
	curl -o libraries.json -L "https://raw.githubusercontent.com/packagecontrol/channel/refs/heads/main/repository.json"
	# installation stats
	curl -o stats.json -L https://stats.sublimetext.io/all-totals
	# compile eleventy (production)
	ELEVENTY_ENV=production NODE_ENV=production npx @11ty/eleventy
	# add compiled channels for public consumption
	curl -o _site/channel.json -L "https://github.com/packagecontrol/thecrawl/releases/download/the-channel/channel.json"
	curl -o _site/channel_st3.json -L "https://github.com/packagecontrol/thecrawl/releases/download/the-st3-channel/channel_st3.json"

lint:
	npx eslint

clean:
	rm -rf _site/*

serve:
	open http://localhost:8080/
	npx @11ty/eleventy --serve --quiet
	# If you want to speed up the dev cycle, you can limit the packages set, e.g.
	# LIMIT_DATASET=100 npx @11ty/eleventy --serve --quiet
