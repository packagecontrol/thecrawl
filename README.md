# Package Controle R website

## 11ty
https://www.11ty.dev/docs/

## nunjucks
https://mozilla.github.io/nunjucks/templating.html

## database
https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/workspace.json

You can grab a copy using [gh](https://cli.github.com/):

```
gh release -R https://github.com/packagecontrol/thecrawl download crawler-status --pattern="workspace.json"
```

## to run locally
```sh
npm install
npx @11ty/eleventy --serve
open http://localhost:8080/
```
