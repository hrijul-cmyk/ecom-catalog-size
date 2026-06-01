# Runbook — manual fallback

If the tool is down, here's how to get a catalog-size estimate for a single domain by
hand. This is exactly what the tool automates.

## 1. Is it Shopify?

```bash
curl -s -A "Mozilla/5.0" "https://DOMAIN/products.json?limit=1" | head -c 200
```
If you get JSON starting with `{"products":[…]}`, it's Shopify. Count exactly:
```bash
# paginate 250 at a time; count "handle" (NOT "id" — id is on variants/images too)
for p in $(seq 1 100); do
  n=$(curl -s -A "Mozilla/5.0" "https://DOMAIN/products.json?limit=250&page=$p" | grep -o '"handle":' | wc -l)
  [ "$n" -eq 0 ] && break
  echo "page $p: $n"
done
```

## 2. Is it WooCommerce?

```bash
curl -sI -A "Mozilla/5.0" "https://DOMAIN/wp-json/wc/store/v1/products?per_page=1" | grep -i x-wp-total
```
The `X-WP-Total` header is the exact product count.

## 3. Otherwise — sitemap

```bash
# find the sitemap
curl -s -A "Mozilla/5.0" "https://DOMAIN/robots.txt" | grep -i sitemap
# count all URLs (upper bound). Use grep -o (these files are one giant line)
curl -s -A "Mozilla/5.0" "https://DOMAIN/sitemap.xml" | grep -o '<loc>' | wc -l
```
If it's a `<sitemapindex>`, repeat the `<loc>` count for each child sitemap and sum.

To estimate **products** (vs. category/brand pages), look at a few product URLs and find
the pattern — usually a trailing numeric id (`-9150062568`) or `.html`, or a bottle-size
token — then `grep -cE 'PATTERN'`.

## 4. Blocked?

A `403`/`429` means the store blocks bots. Use a real browser User-Agent
(`-A "Mozilla/5.0 (Macintosh; …) Chrome/124 …"`), wait a few minutes, and retry. Don't
hammer the same domain repeatedly — that gets your IP rate-limited.
