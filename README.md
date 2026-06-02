# ecom-catalog-size

Estimate an ecommerce store's **catalog size** (product count) from a list of domains.
No AI in the counting loop — it uses open product APIs where they exist and sitemap
counting otherwise, and labels every number with a **confidence** level.

Built for qualifying ecommerce prospects in bulk: drop in a CSV of domains (e.g. a
StoreLeads export), get back the same CSV with a product-count column added.

## How it works — the ladder

For each domain, it tries the cheapest exact method first and falls through on failure:

1. **Route by platform** — if the CSV has a `platform` column (StoreLeads gives you one),
   it goes straight to that platform's method.
2. **Open product API** (exact counts, `confidence: high`)
   - **Shopify** → `/products.json` (paginated, counts by `handle`)
   - **WooCommerce** → `/wp-json/wc/store/v1/products` (reads the `X-WP-Total` header)
   - **Spree** → `/api/v2/storefront/products` (`meta.total_count`) — *unverified, see decisions.md*
3. **Sitemap** — discover via `robots.txt`, expand a sitemap-index, count `<loc>` entries,
   then filter to product URLs by a per-platform pattern (`confidence: medium`/`low`).
4. **None** — nothing reachable, or the site blocked us (`confidence: blocked`/`none`).

## Install

```bash
npm install
```

Requires Node 20+. No API keys or secrets are needed.

## Usage

**Ad-hoc check** (prints to the terminal):
```bash
npm run catalog-size check mylapiel.com chipoteka.hr barefootbuttons.com
```

**Batch a CSV** (the main use case):
```bash
npm run catalog-size run leads.csv --out enriched.csv
```

Options for `run`:

| Flag | Default | Meaning |
|---|---|---|
| `--out <path>` | `<input>.enriched.csv` | Output file |
| `--concurrency <n>` | `10` (or `$CATALOG_CONCURRENCY`) | Domains probed in parallel |
| `--domain-col <name>` | auto: `domain, website, url, company_domain, site` | Domain column |
| `--platform-col <name>` | auto: `platform, ecommerce_platform, cms` | Platform column |

The tool **preserves all original columns** and appends:

| Column | Example | Meaning |
|---|---|---|
| `cat_product_count` | `3800` | Exact count (API) or estimate (sitemap) |
| `cat_method` | `shopify_api` | How it was counted |
| `cat_confidence` | `high` | `high` / `medium` / `low` / `blocked` / `none` |
| `cat_total_urls` | `44752` | Total sitemap URLs (upper bound; blank for API) |
| `cat_source_url` | `https://…/products.json` | Where the number came from |
| `cat_error` | `digit-proxy;partial:blocked` | Pattern used + any diagnostics |

### Reading the output

- **`high`** — exact, trust it (open API, or a clean sitemap-id pattern).
- **`medium`** — sitemap estimate with a solid product pattern; good to ~±15%.
- **`low`** — fuzzy (digit-proxy fallback, or pattern explained little of the sitemap). Treat as a rough order of magnitude.
- **`blocked`** — the store rate-limited/blocked us; re-run later or check by hand.
- **`none`** — no sitemap or API reachable.

The intended workflow is to **review only the `low` / `blocked` / `none` rows** — the
`high`/`medium` rows are reliable.

### Re-running blocked/throttled rows
Some stores rate-limit your IP (especially after a big run). Re-run only the unresolved rows from a
clean connection, carrying the good rows over unchanged:
```bash
npm run catalog-size run leads.csv --retry-unresolved leads.enriched.csv --out leads.v2.csv
```

## HTTP API (Clay / Deepline)

The same engine is exposed as a one-domain-in → JSON-out endpoint, for use as a Clay HTTP column or
a Deepline `generic_http` action:
```bash
npm run serve         # local: GET/POST /estimate, GET /health  (PORT, default 8080)
```
```bash
curl 'http://localhost:8080/estimate?domain=wineandmore.com&platform=WooCommerce'
# → {"domain":"wineandmore.com","product_count":1407,"method":"woo_store_api","confidence":"high",...}
```
Optional auth: set `CATALOG_API_KEY` to require `Authorization: Bearer <key>`. Deploy + full Clay /
Deepline wiring: see [docs/integrations.md](docs/integrations.md). Railway-ready (`railway.toml`).

## Accuracy (spot-check)

| Domain | Platform | Method | Count | Notes |
|---|---|---|---|---|
| mylapiel.com | Shopify | `shopify_api` | 120 | exact |
| lstore.hr | Shopify | `shopify_api` | 3,800 | exact |
| barefootbuttons.com | WooCommerce | `woo_store_api` | 60 | exact |
| chipoteka.hr | OpenCart | `sitemap_index` | 34,950 | 92-child index |
| vrutak.hr | nopCommerce | `sitemap` | 4,008 | id pattern |
| vulkal.hr | nopCommerce | `sitemap` | 6,673 | digit-proxy (tire slugs lack a clean id → flagged `low`) |

## Adding a new platform

Edit one file — [`src/core/patterns.ts`](src/core/patterns.ts). Add the platform's
product-URL regex to `REGISTRY` and map its StoreLeads name in `platformKey()`. No
engine changes needed.

## Project layout

```
src/core/      the engine (reusable by a future API/web wrapper)
  http.ts      fetch with retries, backoff+jitter, browser UA, size cap
  csv.ts       papaparse read/write, preserves + appends columns
  sitemap.ts   robots discovery, index expansion, gunzip, <loc> extraction
  patterns.ts  per-platform product-URL registry  ← edit to add platforms
  probes/      shopify.ts, woocommerce.ts, spree.ts
  estimate.ts  the ladder
src/cli.ts     thin CSV-in → CSV-out wrapper
```

See [PRD.md](PRD.md) for the full spec, [decisions.md](decisions.md) for locked
decisions, and [runbook.md](runbook.md) for the manual fallback if the tool is down.

## A note on rate limits

Many stores (especially Cloudflare-fronted brands) block obvious bots. The tool sends a
real browser User-Agent, retries with exponential backoff + jitter, and honors
`Retry-After`. If you hammer the **same** domain repeatedly (e.g. re-running a tiny test
list), that domain may temporarily 429 your IP and show as `blocked`. Real lists of
**distinct** domains don't hit this. Override the UA with `CATALOG_USER_AGENT` if needed.
