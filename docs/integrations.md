# Integrations — Clay & Deepline

The HTTP API (`src/server.ts`) lets you call the catalog-size engine one domain at a time
and get a flat JSON object back — ideal as an enrichment column in Clay or a step in Deepline.

## The endpoint

```
GET  /estimate?domain=<domain>&platform=<platform>
POST /estimate     { "domain": "...", "platform": "..." }
GET  /health       → { "status": "ok" }
```

`platform` is optional (StoreLeads value); when omitted the engine probes to detect it.

**Response** (flat, snake_case):
```json
{
  "domain": "wineandmore.com",
  "platform": "WooCommerce",
  "product_count": 1407,
  "method": "woo_store_api",
  "confidence": "high",
  "total_urls": null,
  "source_url": "https://www.wineandmore.com/wp-json/wc/store/v1/products?per_page=1",
  "error": ""
}
```
`product_count` is `null` when unknown — check `confidence` (`high` / `medium` / `low` /
`blocked` / `none`) to decide how much to trust it.

**Auth:** if the server has `CATALOG_API_KEY` set, send `Authorization: Bearer <key>`. If not, the
endpoint is open.

## Deploy (Railway)

1. Push this repo to a Railway service (it auto-detects `railway.toml`: nixpacks build,
   `npm run start`, healthcheck `/health`).
2. (Recommended) set `CATALOG_API_KEY` in the Railway variables to a random string.
3. Railway gives you a URL like `https://ecom-catalog-size-production.up.railway.app`.

Smoke test:
```bash
curl https://<your-railway-url>/health
curl -H "Authorization: Bearer <key>" \
  "https://<your-railway-url>/estimate?domain=chipoteka.hr&platform=OpenCart"
```

## Clay — HTTP API column

Add an **HTTP API** enrichment column:

- **Method:** `POST`
- **URL:** `https://<your-railway-url>/estimate`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <key>`   *(only if CATALOG_API_KEY is set)*
- **Body:**
  ```json
  { "domain": "/Domain", "platform": "/Platform" }
  ```
  (`/Domain`, `/Platform` are Clay column references.)
- **Only run if:** gate on `/Domain` being present to avoid wasted calls.

Then read fields off the response with formula columns: `product_count`, `confidence`, `method`.
Tip: act only on `confidence = high` (exact) or `medium`; treat `low` as a rough bucket and
re-check `blocked` rows.

## Deepline — generic_http action

```bash
--with '{"alias":"catalog","tool":"generic_http","payload":{
  "url":"https://<your-railway-url>/estimate",
  "method":"POST",
  "headers":{"Content-Type":"application/json","Authorization":"Bearer <key>"},
  "body_json":"{\"domain\":\"{{domain}}\",\"platform\":\"{{platform}}\"}"
}}'
```

Deepline expects JSON back (it does); map `product_count` / `confidence` into your table.

## Notes

- One request = one domain. For large batches that you control end-to-end, the **CLI**
  (`catalog-size run leads.csv`) is faster and cheaper than per-row HTTP calls.
- The API has no internal rate limiting — Clay/Deepline run-settings (concurrency, "only run if",
  retry on 429/5xx) control call volume.
