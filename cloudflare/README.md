# Cloudflare rules

This folder stores Cloudflare ruleset payloads used for
`packages.sublimetext.io`.

## Files

- `cache-ruleset.json` - the zone ruleset payload for the
  `http_request_cache_settings` phase.
- `response-header-ruleset.json` - the zone ruleset payload for the
  `http_response_headers_transform` phase.

## Current behavior

The cache rules are ordered:

1. Bypass Package Control channel files:
   - `/channel.json`
   - `/channel_st3.json`
2. Cache URL-busted static assets (`/static_*`) for one year at the edge and in
   browsers.
3. Cache site HTML for one day at the Cloudflare edge, with a short browser TTL.

The response-header transform rules currently set short browser caching for
HTML-like pages and the RSS feed content type:

- HTML-like pages -> `Cache-Control: public, max-age=60, must-revalidate`
- `/browse/new/rss` -> `Content-Type: application/rss+xml; charset=utf-8`

GitHub Actions purges Cloudflare after successful GitHub Pages deploys, so the
long edge TTLs should not delay deployed updates.

## Requirements

Set these environment variables before applying the rules:

```bash
export CLOUDFLARE_API_TOKEN='...'
export CLOUDFLARE_ZONE_ID='94cf2e48af7bfadbca510dbf212c5847'
```

The token needs these zone-scoped permissions:

| Scope | Permission      | Access |
| ----  | --------------- | ------ |
| Zone  | Cache Rules     | Edit   |
| Zone  | Cache Rules     | Read   |
| Zone  | Transform Rules | Edit   |
| Zone  | Transform Rules | Read   |
| Zone  | Zone            | Read   |
| Zone  | Cache Purge     | Purge  |

Restrict zone resources to:

| Include       | Resource         |
| ------------- | ---------------- |
| Specific zone | `sublimetext.io` |

## Inspect active rulesets

Cache rules:

```bash
curl --fail-with-body -sS \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/rulesets/phases/http_request_cache_settings/entrypoint"
```

Response-header transform rules:

```bash
curl --fail-with-body -sS \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/rulesets/phases/http_response_headers_transform/entrypoint"
```

## Apply stored rulesets

Current ruleset ids:

- Cache settings: `b0a2c262f2194bfa9b30d47c50c7b980`
- Response headers: `04d9f037fa1b4bf19468f85413e41ae7`

Apply cache rules:

```bash
curl --fail-with-body -X PUT \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @cloudflare/cache-ruleset.json \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/rulesets/b0a2c262f2194bfa9b30d47c50c7b980"
```

Apply response-header transform rules:

```bash
curl --fail-with-body -X PUT \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @cloudflare/response-header-ruleset.json \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/rulesets/04d9f037fa1b4bf19468f85413e41ae7"
```

## Verify behavior

```bash
curl -sS -o /dev/null -D - --compressed \
  https://packages.sublimetext.io/packages/Abrase

curl -sS -o /dev/null -D - --compressed \
  https://packages.sublimetext.io/static_<hash>/styles.css

curl -sS -o /dev/null -D - --compressed \
  https://packages.sublimetext.io/channel.json

curl -sS -o /dev/null -D - --compressed \
  https://packages.sublimetext.io/browse/new/rss
```

Expected highlights:

- HTML package pages become `cf-cache-status: HIT` after the first request.
- `/static_*` assets return long browser cache headers.
- Channel files are bypassed (`cf-cache-status: DYNAMIC`).
- HTML-like pages return `Cache-Control: public, max-age=60, must-revalidate`.
- The RSS feed returns `Content-Type: application/rss+xml; charset=utf-8`.
