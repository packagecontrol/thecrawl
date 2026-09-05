ARTIFACTS := registry.json channel.json logs.json

ifeq ($(CI),true)
NPM_INSTALL := npm ci --prefer-offline --no-audit --no-fund
else
NPM_INSTALL := npm install
endif

.PHONY: build dev test artifacts history dependencies clean

build: history
	npm run build

dev: history
	npm run dev

test: dependencies
	npm test

artifacts:
	gh -R packagecontrol/thecrawl release download crawler-status \
		--pattern registry.json \
		--pattern logs.json \
		--clobber
	gh -R packagecontrol/thecrawl release download the-channel \
		--pattern channel.json \
		--clobber

history: dependencies artifacts
	npm run collect-history

dependencies: node_modules/.package-lock.json

node_modules/.package-lock.json: package.json package-lock.json
	$(NPM_INSTALL)

clean:
	rm -rf _site
