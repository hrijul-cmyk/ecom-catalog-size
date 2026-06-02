# Locked Decisions

Every architectural decision, dated. Do not re-litigate without new evidence.
(Mirror of PRD §3.4 plus decisions made during the build.)

| # | Decision | Reason | Date |
|---|---|---|---|
| 1 | Separate repo; **copy** the small utils (retry, csv) rather than import from email-waterfall | Standalone tool, no monorepo coupling | 2026-06-01 |
| 2 | Node 20+ + TypeScript + tsx, npm | Match workspace; native `fetch` | 2026-06-01 |
| 3 | Core engine (`src/core/`) separated from CLI (`src/cli.ts`) | API/web can wrap the same engine later, no rewrite | 2026-06-01 |
| 4 | Use the StoreLeads `platform` column to route; defer auto-detection to v2 | Input data already carries it | 2026-06-01 |
| 5 | Output = counts + confidence + method + source_url; no URL dump in MVP | Smallest useful output | 2026-06-01 |
| 6 | No proxies in MVP; throttle + backoff + flag `blocked` | $0 cost; proxies only if block-rate forces it | 2026-06-01 |
| 7 | Exact via open API where available, else sitemap estimate | Determinism + honest confidence labeling | 2026-06-01 |
| 8 | Product patterns live in one registry file (`patterns.ts`) | Add platforms without touching the engine | 2026-06-01 |
| 9 | No AI in the counting loop | Cost + reproducibility | 2026-06-01 |
| 10 | File-based I/O (CSV), no DB in MVP | Avoid two systems of record | 2026-06-01 |
| 11 | Count Shopify by `handle`, not `id` | `id` appears on variants/images too, inflating ~8x | 2026-06-01 |
| 12 | Sitemap parsed by regex, not a DOM XML parser | Sitemaps are flat and often tens of MB; regex is fast and low-memory | 2026-06-01 |
| 13 | **Confidence is a function of match quality, not just platform identity**: if a pattern explains < 25% of non-static sitemap URLs, fall back to the digit-proxy and mark `low` | A confident-but-wrong number is the worst outcome (e.g. nopCommerce tire shop: id-pattern matched 430 of ~6,700; digit-proxy ~6,673 is closer and honestly `low`) | 2026-06-01 |
| 14 | **Spree probe shipped but UNVERIFIED** — safe by construction (only emits on `200` + numeric `meta.total_count`, else falls through to sitemap) | No public live Spree store available at build time (demo is decoupled Next.js, API not exposed). Re-verify when a real Spree domain appears | 2026-06-01 |
| 15 | **Realistic browser User-Agent by default** | Verified: bot-ish UA → 429, browser UA → 200 on Cloudflare-fronted Shopify brands (driesvannoten, serax, komono) | 2026-06-01 |
| 16 | Child sitemaps fetched in parallel (concurrency 8) within a domain; `MAX_CHILD_SITEMAPS=500` with a `truncated` flag (never a silent cap) | Speed (chipoteka has 92 children) without hiding truncation | 2026-06-01 |
| 17 | Strip a leading 2-letter locale path segment before counting | Multi-language stores duplicate every product per locale, inflating counts | 2026-06-01 |
| 18 | Sitemap discovery probes Magento fallbacks (`/sitemap/sitemap.xml`, `/pub/…`, `/media/…`) after `/sitemap.xml` | Magento often serves the sitemap off-root; plain `/sitemap.xml` silently misses large catalogs | 2026-06-02 |
| 19 | Resolve the robots.txt `Sitemap:` value against the base URL | A relative `Sitemap: /feeds/sitemap.xml` otherwise threw "Failed to parse URL" | 2026-06-02 |
| 20 | Discovery blocked by 403/429 → report `confidence: blocked`, not `none` | The 500-run truth-test showed Magento "none" misses were mostly WAF-blocked *real* stores, not dead domains; honest labeling tells the operator to re-run from a clean IP. **Do NOT spoof Googlebot to bypass WAFs** (detection-evasion). | 2026-06-02 |
| 21 | Sitemap matched 0 products but had URLs → `productCount: null` + `confidence: none` (`unreadable:patterns-matched-0`), not `0` | A `0` reads as an empty store; "unknown" is the honest answer (e.g. proteka.hr 938 URLs, word-only slugs) | 2026-06-02 |
| 22 | `--retry-unresolved <prev.csv>` carries over rows with a count + confidence high/medium/low and only re-probes blocked/none/empty | Re-run throttled rows from a clean IP without redoing the whole list | 2026-06-02 |
| 23 | HTTP API (`src/server.ts`, Express) wraps the same `estimateCatalog` engine; GET+POST `/estimate`, `/health`; flat **snake_case** payload | Reuse engine for Clay/Deepline (decision #3); snake_case matches CSV columns + Clay field extraction | 2026-06-02 |
| 24 | API auth is an **optional** env-gated bearer token (`CATALOG_API_KEY`); open if unset | Public URL doing outbound fetches warrants a gate, but zero-friction default matches other internal services | 2026-06-02 |
