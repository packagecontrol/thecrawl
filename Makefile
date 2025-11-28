build:
	npm install
	# workspace from https://github.com/packagecontrol/thecrawl
	curl -o workspace.json -L "https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/workspace.json"
	# libraries repository from https://github.com/packagecontrol/channel
	curl -o libraries.json -L "https://raw.githubusercontent.com/packagecontrol/channel/refs/heads/main/repository.json"
	# installation stats
	curl -o stats.json -L "https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/stats.json"
	# compile eleventy (production)
	ELEVENTY_ENV=production NODE_ENV=production npx @11ty/eleventy
	# add compiled channels for public consumption
	curl -o _site/channel.json -L "https://github.com/packagecontrol/thecrawl/releases/download/the-channel/channel.json"
	curl -o _site/channel_st3.json -L "https://github.com/packagecontrol/thecrawl/releases/download/the-st3-channel/channel_st3.json"

build-emoji:
	# Build emoji.json from gemoji source
	curl -L https://raw.githubusercontent.com/github/gemoji/master/db/emoji.json -o emoji-source.json
	npm run build:emoji

build-label-icons:
	[ -d .AFileIcon ] || git clone --depth 1 https://github.com/SublimeText/AFileIcon.git .AFileIcon
	npm run build:label-icons

lint:
	npx eslint

test:
	npm test

clean:
	rm -rf _site/*

clean-a-fileicon:
	rm -rf .AFileIcon

serve:
	open http://localhost:8080/
	npx @11ty/eleventy --serve --quiet
	# If you want to speed up the dev cycle, you can limit the packages set, e.g.
	# LIMIT_DATASET=100 npx @11ty/eleventy --serve --quiet
