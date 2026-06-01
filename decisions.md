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
