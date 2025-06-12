# Package Controle R website

## 11ty
https://www.11ty.dev/docs/

## nunjucks
https://mozilla.github.io/nunjucks/templating.html

## database
https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/workspace.json

## to run locally
```sh
curl -o workspace.json -L "https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/workspace.json"
npm install
npx @11ty/eleventy --serve
open http://localhost:8080/
```
