PACKAGE_CONTROL_CHANNEL_DIR := .package_control_channel
PACKAGE_CONTROL_CHANNEL_REPO := https://github.com/sublimehq/package_control_channel.git

build:
	npm install
	$(MAKE) up
	$(MAKE) render-readmes
	# compile eleventy (production)
	ELEVENTY_ENV=production NODE_ENV=production npx @11ty/eleventy --quiet
	# add compiled channels for public consumption
	curl -L --fail --parallel \
		-o _site/channel.json "https://github.com/packagecontrol/thecrawl/releases/download/the-channel/channel.json" \
		-o _site/channel_st3.json "https://github.com/packagecontrol/thecrawl/releases/download/the-st3-channel/channel_st3.json"

update-data:
	mkdir -p static
	curl -L --fail --parallel \
		-o workspace.json "https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/workspace.json" \
		-o stats.json "https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/stats.json" \
		-o static/logs.json "https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/logs.json"
	curl -L --fail \
		-o readmes.json "https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/readmes.json" \
		|| printf '{}\n' > readmes.json

render-readmes:
	node render_readmes.mjs -i readmes.json -o readmes_rendered.json

up:
	# Package Control Channel is needed to link each package to its exact
	# registry source file and line number.
	rm -rf $(PACKAGE_CONTROL_CHANNEL_DIR)
	git clone --depth 1 $(PACKAGE_CONTROL_CHANNEL_REPO) $(PACKAGE_CONTROL_CHANNEL_DIR)
	$(MAKE) update-data

build-emoji:
	# Build emoji.json from gemoji source
	curl -L https://raw.githubusercontent.com/github/gemoji/master/db/emoji.json -o emoji-source.json
	npm run build:emoji

lint:
	npx eslint

test:
	npm test

clean:
	rm -rf _site/*

serve:
	open http://localhost:8080/
	npx @11ty/eleventy --serve --quiet
	# If you want to speed up the dev cycle, you can limit the packages set, e.g.
	# LIMIT_DATASET=100 npx @11ty/eleventy --serve --quiet
