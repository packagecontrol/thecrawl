SOURCE_REPOSITORIES_DIR := .source_repositories
SOURCE_MODEL := source-model.json
SOURCE_THRESHOLD := 5

ifeq ($(CI),true)
NPM_INSTALL := npm ci --prefer-offline --no-audit --no-fund
else
NPM_INSTALL := npm install
endif

build:
	$(NPM_INSTALL)
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
	node util/render-readmes.mjs -i readmes.json -o readmes_rendered.json

build-source-map:
	node util/build-source-map.mjs workspace.json $(SOURCE_REPOSITORIES_DIR) \
		-o $(SOURCE_MODEL) -t $(SOURCE_THRESHOLD)

up:
	$(MAKE) update-data
	$(MAKE) build-source-map

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
