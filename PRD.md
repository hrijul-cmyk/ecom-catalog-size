# PRD / Build Plan — Ecommerce Catalog-Size Estimator

> This document is the kickoff PRD for a **new, separate GitHub repo**. It follows the user's
> "Custom Tool Build — Project Starter" template. Drop it into the new repo as `PRD.md`.

---

## Context (why this exists)

When qualifying ecommerce prospects for outbound (Cold Labs), **catalog size** is a strong
signal — it separates a 50-SKU boutique from a 35,000-SKU megastore, which changes messaging,
fit, and tier. Today this is gauged ad-hoc: pulling a sitemap by hand, eyeballing it, sometimes
pasting a 747 KB XML into a model (~200k tokens) just to get one number. That is slow, expensive,
and not repeatable.

The insight from the prototype work ([email-waterfall/scripts/catalog-size.mjs](../../Antigravity/email-waterfall/scripts/catalog-size.mjs))
is that **catalog size is deterministic to compute — no AI needed in the loop**:
- Shopify / WooCommerce / Spree expose **open product APIs** → exact counts.
- Everyone else exposes a **sitemap** → count `<loc>` and filter to product URLs by a per-platform pattern.

This tool turns that into a reusable batch enricher: **CSV of domains in → CSV with a
`product_count` + `confidence` column out.** AI is reserved for an optional one-time
"figure out the product-URL pattern for an unknown platform" helper, never the counting itself.

**Intended outcome:** any operator can enrich a StoreLeads export of hundreds–thousands of
domains with a trustworthy catalog-size estimate in minutes, at ~$0 marginal cost.

---

## Part 1 — Inputs

### 1.1 Problem statement
We qualify ecommerce prospects but have no fast, repeatable way to know how big each store's
catalog is. We do it by hand — fetching sitemaps, eyeballing them, occasionally pasting huge XML
into an AI model just to get one number. It is slow, costs tokens, and gives inconsistent results.
We need a tool that takes a list of domains and returns an approximate product count per domain.

### 1.2 Current manual process
1. Open the prospect's domain, guess the platform.
2. Fetch `robots.txt` → find `sitemap.xml`; or try `/products.json` if it looks like Shopify.
3. Download the sitemap (often hundreds of KB to several MB), sometimes a sitemap *index*.
4. Eyeball or grep `<loc>` entries, try to separate product URLs from category/brand pages.
5. Paste into a model or count manually; record a rough number. Repeat per domain.

### 1.3 Why this matters
- **Hours/week:** ~3–6 hrs across campaigns when qualifying ecom lists by hand.
- **People affected:** outbound operators + whoever builds campaign lists (2–4).
- **Failure cost:** low-to-medium — bad segmentation → weaker targeting, wasted sends; not catastrophic.
- **Build time guess:** ~1 week for MVP.
- **Payback:** < 1 month (saves several hrs/week vs. a few days' build). Worth building.

### 1.4 Initial scope intent
- Take a CSV of ecom domains → output approximate product count per domain.
- Use the cheapest exact method available per platform (open API), fall back to sitemap.
- Leverage the `platform` column we already get from StoreLeads to route quickly.

### 1.5 Explicitly NOT in scope (MVP)
- Per-category product breakdowns.
- Dumping the full product-URL list per domain (deferred; easy flag in v2).
- Automatic ecommerce-platform *detection* from scratch (we use the StoreLeads `platform` column; detection is v2).
- Proxy pools / anti-bot evasion.
- A web UI or always-on API (engine is structured so these can wrap it later).
- Price/inventory/stock data — only catalog *size*.

### 1.6 Existing infrastructure inventory (reuse map)
Tool is a **separate repo**, so these are **copied/ported**, not imported:

| Asset | Path | Reuse |
|---|---|---|
| `fetchWithRetry()` — retries, backoff, `Retry-After`, AbortController timeout | [email-waterfall/lib/providers/_retry.ts](../../Antigravity/email-waterfall/lib/providers/_retry.ts) | Copy, drop network glue in |
| CSV helpers (papaparse): parse, column-mapping, export-with-appended-cols | [email-waterfall/lib/csv.ts](../../Antigravity/email-waterfall/lib/csv.ts) | Copy core fns |
| `p-limit` concurrency-gate pattern | [email-waterfall/lib/engines/micro_batched.ts](../../Antigravity/email-waterfall/lib/engines/micro_batched.ts) | Copy pattern |
| Working prototype (Shopify probe + sitemap-index expansion + product patterns) | [email-waterfall/scripts/catalog-size.mjs](../../Antigravity/email-waterfall/scripts/catalog-size.mjs) | Port & harden into `src/core/` |
| Reference data: real StoreLeads export with `platform` + `merchant_name` | [Cold Labs/Prim/Belgium-SL-Shopify.csv](../../Cold%20Labs/Prim/Belgium-SL-Shopify.csv) | Test fixture / input format |
| Reference outputs (vrutak sitemap + extracted product URLs) | email-waterfall/docs/ecom-sitemap.txt, ecom-product-urls.txt | Test fixtures |

- **Stack convention across workspace:** Node 20 + TypeScript, npm, `tsx`, papaparse, `p-limit`, native `fetch`, `.env`+`dotenv`, Railway deploy, Supabase (optional).
- **Missing / build new:** product-URL pattern registry (refactor from prototype), platform-detection module (v2), proxy integration (v2).

### 1.7 Users
- **Who:** Cold Labs outbound operators + campaign-list builders.
- **Technical level:** semi-technical (comfortable running a documented `npm` command; not engineers).
- **Adoption risk:** low if the command is one line and reads/writes plain CSVs they already use.
- **Training:** a README quickstart + one Loom; the person who builds it onboards the team.

### 1.8 Constraints
- **Budget:** ~$0 running cost (no paid APIs in MVP). Time: ~1 week.
- **Timeline:** MVP within ~1 week of repo creation.
- **Compliance:** only public store endpoints (robots-respecting, public sitemaps/APIs). No auth-walled data.
- **Stack:** Node 20 + TypeScript (match workspace). No Python. CSV via papaparse.

### 1.9 Goals (outcomes)
1. An operator can enrich a CSV of ~1,000 domains with `product_count` + `confidence` in **< 15 min**, one command.
2. **Exact** counts for Shopify / WooCommerce / Spree domains (open APIs); **±10–15% estimates** for sitemap-based platforms, each tagged with a `confidence` level.
3. Eliminate the "paste a 747 KB sitemap into an AI model to get one number" failure mode entirely.
4. New platform patterns are added by editing **one registry file**, not the engine.

### 1.10 Additional context
Engine must stay cleanly separated from the CLI so a Clay/Deepline **API** wrapper or a web UI
can reuse it later with no rewrite. Output stays **file-based** (CSV in/out) for MVP to avoid a
second system of record.

---

## Part 2 — Design outputs

### 2.1 Refined problem statement
We need a deterministic, repeatable batch tool that, given a CSV of ecommerce domains (often with
a known `platform` from StoreLeads), returns an approximate **product count** per domain plus a
**confidence** and **method**, using open product APIs where they exist and sitemap counting
otherwise — with **no AI in the counting loop**.

### 2.2 Final scope

**In scope (MVP):**
- Core engine: per-domain ladder → `{ product_count, method, confidence, source_url, total_urls, error }`.
- Open-API exact counts: **Shopify** (`/products.json`), **WooCommerce** (`/wp-json/wc/store/v1/products`, read `X-WP-Total`), **Spree** (`/api/v2/storefront/products`, `meta.total_count`).
- Sitemap engine: robots.txt discovery, sitemap-index expansion, gzip handling, `<loc>` count, product-URL filtering.
- Product-pattern registry keyed by platform (Shopify, WooCommerce, OpenCart, nopCommerce, Magento, PrestaShop + generic digit-proxy fallback).
- CLI: CSV in (domain [+ optional platform + passthrough columns]) → enriched CSV out; concurrency-limited, resumable-friendly.
- Confidence taxonomy + one human review checkpoint for low-confidence/blocked rows.

**Out of scope (deferred to v2):**
- API/web wrappers, platform auto-detection, proxy pools, product-URL dumps, per-category breakdown, historical tracking/DB, enterprise platforms (SAP Commerce, Salesforce Commerce Cloud, Wix, Ecwid, BigCommerce, Shopware Store-API, CS-Cart, OXID, Odoo, Drupal Commerce, Smartstore) → sitemap-only/best-effort until patterns added.

### 2.3 Workflow specification
**Trigger:** manual CLI run over a CSV (batch).

Per domain (the **ladder** — stop at first success):
1. **[automated] Route by platform** — if CSV has a `platform` value with a known open API → go to its probe. Else continue.
2. **[external API] Open product API probe** — Shopify/Woo/Spree. Success → `confidence: high`, exact count.
3. **[external] Sitemap** — discover via robots.txt → fetch (expand index, gunzip) → count `<loc>` → filter by platform pattern. → `confidence: medium` (id/`.html` pattern) or `low` (digit-proxy).
4. **[external] Category-count fallback** *(optional, time-permitting)* — fetch broadest listing page, regex the "N results" total. → `confidence: low`.
5. **[automated] None** — record `error`/`blocked`, `confidence: none`.

Then: **[automated]** write all results as appended columns to the output CSV, preserving original columns.

**Decision branches:** Cloudflare/403 → `confidence: blocked`. Multi-language store → dedupe locale-prefixed URLs. `lastmod 1900` → ignored for any freshness logic.
**Error paths:** per-domain failures are isolated (`Promise.allSettled`); one bad domain never aborts the batch; every failure lands in the `error` column.

### 2.4 Human-in-the-loop checkpoint (exactly one)
- **Checkpoint:** after a run, operator reviews rows with `confidence ∈ {low, blocked, none}`.
- **Why here:** exact-API and clean-sitemap rows are trustworthy and need no review; only the fuzzy/blocked tail warrants a human glance (re-run, manual check, or accept).
- **What's reviewed:** the `confidence`, `method`, `source_url`, and count for that tail.
- **Approve/reject mechanism:** operator filters the output CSV by `confidence`; optionally re-runs blocked rows later or hand-verifies. No gating of high/medium rows.

### 2.5 Risk register

| Risk | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|
| WAF/Cloudflare blocks at volume | Med | Med | Throttle (p-limit), backoff, UA header; flag `blocked`; proxies = v2 | Handle now (flag), proxy later |
| Product vs. category/brand mis-split in sitemap | High | Med | Per-platform pattern registry; report `confidence` + `total_urls` as bound | Handle now |
| Pattern drift (platforms rename sitemap modules/lock APIs) | Med | Med | Registry isolated to one file; numbers only trusted when probe returns data | Handle now |
| Multi-language store inflates counts | Med | Med | Dedupe locale-prefixed paths before counting | Handle now |
| `products.json` disabled on some Shopify Plus | Low | Low | Fall through to sitemap automatically | Handle now |
| Giant sitemap (tens of MB) OOM | Low | Med | Stream + size cap; count without full DOM | Handle now |
| StoreLeads `platform` value wrong/stale | Low | Low | Probe validates (e.g. Shopify probe fails → falls through) | Accept (self-correcting) |
| Non-ecom / dead domain in input | Med | Low | Timeout + `error` column, never crash batch | Handle now |
| Draft/unpublished products excluded by API | Med | Low | Document that counts are *published* catalog | Accept + document |

---

## Part 3 — Architecture & decisions

### 3.1 Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Language/runtime | Node 20 + TypeScript, run via `tsx` | Matches entire workspace; native `fetch` |
| CSV | `papaparse` | Same as email-waterfall (`lib/csv.ts`) |
| Concurrency | `p-limit` | Same pattern as `micro_batched.ts` |
| HTTP | native `fetch` + ported `fetchWithRetry` | Reuse `_retry.ts` |
| Sitemap parse | regex `<loc>` extraction (no heavy XML dep) + `zlib` gunzip | Prototype-proven, fast, low-mem |
| Frontend | none (MVP) | CLI only |
| Scheduler | none (MVP) | Batch on demand |
| Notifications | none (MVP) | Console progress + summary |
| Secrets | `.env` + `dotenv` (minimal; none required for MVP) | Workspace convention |
| Error tracking | structured per-row `error` column + run summary | Sufficient for batch CLI |
| Deployment | local / one-off Railway job | No always-on service in MVP |

### 3.2 External integrations

| Service | Auth | Rate limits | Key endpoints | Notes |
|---|---|---|---|---|
| Shopify storefront | none | soft; throttle ~2–4 req/s/host | `/products.json?limit=250&page=N`; `/sitemap_products_1.xml` | Count `"handle"` not `"id"` (ids inflate ~8×) |
| WooCommerce Store API | none | soft | `/wp-json/wc/store/v1/products?per_page=1` → read `X-WP-Total` header | One request gives total; no pagination needed for count |
| Spree Storefront v2 | none (usually) | soft | `/api/v2/storefront/products?per_page=1` → `meta.total_count` | Open by default; verify live |
| Generic sitemap | none | host-dependent | `robots.txt` → `sitemap.xml` / `sitemap-index.xml` | Expand index, gunzip `.gz` |

**⚠ Verify-before-trust:** Woo `X-WP-Total` and Spree `meta.total_count` are from training knowledge — **confirm live on a real domain during M6** before baking in (template principle: "Read APIs before designing").

### 3.3 Data model
**MVP is file-based — no database** (avoids a second system of record). I/O contract:

**Input CSV** (extra columns passed through untouched):
```
domain          (required)
platform        (optional — StoreLeads value; routes the ladder)
merchant_name   (optional — passthrough, useful downstream)
...any other columns... (passthrough)
```
**Output CSV** = input columns + appended:
```
cat_product_count    integer | "" (estimate or exact)
cat_method           shopify_api | woo_store_api | spree_api | sitemap | sitemap_index | category_count | none
cat_confidence       high | medium | low | blocked | none
cat_total_urls       integer | "" (sitemap upper bound)
cat_source_url       the API/sitemap URL used
cat_error            "" | short error string
```
*(v2 only, if recurring tracking is added: a `catalog_estimates` Supabase table keyed by domain+date.)*

### 3.4 Locked decisions log

| # | Decision | Reason | Date |
|---|---|---|---|
| 1 | Separate repo; **copy** the 3 small utils (retry, csv, concurrency) rather than import | Standalone tool, no monorepo coupling | 2026-06-01 |
| 2 | Node 20 + TypeScript + tsx, npm | Match workspace; zero ramp | 2026-06-01 |
| 3 | **Core engine (`src/core/`) separated from CLI (`src/cli.ts`)** | API/web can wrap same engine later, no rewrite | 2026-06-01 |
| 4 | Use StoreLeads `platform` column to route; **defer auto-detection to v2** | Data already carries it | 2026-06-01 |
| 5 | Output = counts + confidence + method + source_url; **no URL dump in MVP** | User decision; smallest useful output | 2026-06-01 |
| 6 | **No proxies in MVP**; throttle + backoff + flag `blocked` | User decision; $0 cost; proxies only if block-rate forces it | 2026-06-01 |
| 7 | Exact via open API where available, else sitemap **estimate** | Determinism; honest confidence labeling | 2026-06-01 |
| 8 | Product patterns live in **one registry file** (`patterns.ts`) | Add platforms without touching engine | 2026-06-01 |
| 9 | **No AI in counting loop**; AI only optional one-time pattern discovery, cached | Cost + reproducibility | 2026-06-01 |
| 10 | File-based I/O (CSV), **no DB in MVP** | Avoid two systems of record | 2026-06-01 |

### 3.5 Open questions

- **Woo/Spree endpoint behavior** (`X-WP-Total` present? Spree API open?) — verify in M6. Default if unconfirmed: fall through to sitemap for those platforms.
- **Category-count fallback (step 4)** — include in MVP or defer? Default: implement only if time remains after M9; otherwise `confidence: none` for sitemap-less sites.
- **Throttle rate per host** — default p-limit(10) global + small per-host delay; tune in M9 against real block rates.

---

## Part 4 — Build plan

### 4.1 Milestones

| # | Milestone | Output | Test step | Status |
|---|---|---|---|---|
| 1 | **Foundations** | New repo: `package.json` (TS, tsx, papaparse, p-limit, dotenv), `.gitignore` (first), `.env.example`, `src/core/` + `src/cli.ts` skeleton, README/PRD/history/decisions | `npx tsx src/cli.ts --help` prints usage | ☐ |
| 2 | **Port shared utils** | `src/core/http.ts` (fetchWithRetry), `src/core/csv.ts` (parse/export) ported from email-waterfall | Unit smoke: retry on a 500; parse+export a 3-row CSV | ☐ |
| 3 | **Shopify probe** | `src/core/probes/shopify.ts` — paginate `products.json`, count `"handle"` | `mylapiel.com`→120, `lstore.hr`→~3800 | ☐ |
| 4 | **Sitemap engine** | `src/core/sitemap.ts` — robots discovery, index expansion, gunzip, `<loc>` count, size cap | `chipoteka.hr`→44,752 total (via index); `vrutak.hr`→5,162 | ☐ |
| 5 | **Pattern registry** | `src/core/patterns.ts` — per-platform product regex + confidence; product filter | `chipoteka`→~34,951; `vrutak`→~3,948 | ☐ |
| 6 | **Woo + Spree probes** | `src/core/probes/woocommerce.ts` (`X-WP-Total`), `spree.ts` (`meta.total_count`) — **verified live first** | Against a real Woo + Spree domain: count matches site | ☐ |
| 7 | **Ladder orchestrator** | `src/core/estimate.ts` — route→openAPI→sitemap→fallback→none; returns result object | 4 sample domains → correct `method`+`confidence`+count | ☐ |
| 8 | **CLI + CSV I/O** | `src/cli.ts` — read CSV, p-limit(10), progress, write enriched CSV with passthrough | Run 50-row slice of `Belgium-SL-Shopify.csv`; appended cols, originals intact | ☐ |
| 9 | **Robustness** | timeouts, backoff, block detection (403/Cloudflare→`blocked`), multi-lang dedupe, `lastmod 1900` ignore, per-row error isolation | Feed dead + blocked + huge-sitemap domains → no crash, errors recorded | ☐ |
| 10 | **Confidence calibration** | spot-check 20 mixed-platform domains vs. manual counts; tune thresholds; accuracy table in README | Documented: exact-API 100%, sitemap within ±15% | ☐ |
| 11 | **Docs + runbook** | README quickstart, `runbook.md` (manual fallback), `decisions.md`, first `history.md` entry | A fresh person runs a batch from README alone | ☐ |

*v2 backlog (not MVP):* API wrapper for Clay/Deepline · platform auto-detection · proxy pool · product-URL dump flag · per-category breakdown · Supabase historical tracking · enterprise-platform patterns · web UI.

### 4.2 Ship date
```
Target ship date:   2026-06-08 (≈1 week)
Feature lock date:  2026-06-05  (anything not in by then → v2)
```

### 4.3 Definition of done
1. `npx tsx src/cli.ts run <input.csv> --out <output.csv>` enriches a 1,000-row StoreLeads CSV in < 15 min with no crash.
2. Shopify/Woo/Spree rows return **exact** counts (`confidence: high`); sitemap rows return estimates within **±15%** on the 20-domain spot-check.
3. Every row has `cat_method` + `cat_confidence`; failures land in `cat_error` without aborting the batch.
4. README lets a fresh operator run a batch unaided; `runbook.md` documents the manual fallback.

---

## Part 5 — Operational readiness

- **5.1 Ownership:** builder owns bug fixes, `patterns.ts` updates, and the (minimal) `.env`. Name a second person to avoid a single point of failure.
- **5.2 Adoption:** builder trains operators via README + one Loom on ship day; old "paste-sitemap-into-AI" method is retired immediately once the tool ships; success metric = catalog-size column produced by the tool on 100% of new ecom campaign lists within 2 weeks.
- **5.3 Manual fallback (`runbook.md`):** for a single domain — `curl /robots.txt` → open `sitemap.xml` → `grep -oE '<loc>' | wc -l` for upper bound, or `/products.json` for Shopify. (This is exactly what the tool automates.)
- **5.4 Observability:** CLI prints a run summary (domains processed, method breakdown, confidence breakdown, blocked count, elapsed). Good enough for a batch CLI; no dashboard in MVP.

---

## Part 6 — Documentation scaffold (create before code)

```
catalog-size-estimator/
├── .gitignore            # FIRST
├── .env.example
├── PRD.md                # this document
├── README.md             # quickstart + accuracy table
├── history.md            # append-only, every session
├── decisions.md          # locked decisions (Part 3.4)
├── runbook.md            # manual fallback (Part 5.3)
├── package.json
├── tsconfig.json
├── src/
│   ├── core/             # engine — reused by any future wrapper
│   │   ├── http.ts       # fetchWithRetry (ported)
│   │   ├── csv.ts        # papaparse helpers (ported)
│   │   ├── sitemap.ts    # discovery, index expansion, count
│   │   ├── patterns.ts   # per-platform product-URL registry
│   │   ├── probes/       # shopify.ts, woocommerce.ts, spree.ts
│   │   └── estimate.ts   # the ladder orchestrator
│   └── cli.ts            # thin CSV-in → CSV-out wrapper
├── test/
│   └── fixtures/         # vrutak sitemap, Belgium-SL-Shopify slice
└── .claude/
    └── CLAUDE.md         # operating instructions for Claude Code
```

---

## Platform coverage (from your 19-option dropdown)

| Tier | Method | Platforms |
|---|---|---|
| **Exact (open API)** | products endpoint | **Shopify, WooCommerce, Spree Commerce** |
| **Estimate (sitemap pattern in MVP)** | sitemap + regex | **OpenCart, nopCommerce, Magento, PrestaShop, BigCommerce** |
| **Best-effort (generic sitemap, pattern added on demand)** | sitemap digit-proxy | Shopware, Wix, Ecwid, CS-Cart, OXID eShop, Odoo, Smartstore, Drupal Commerce, Custom Cart |
| **Deferred (auth/enterprise — v2)** | needs creds/config | SAP Commerce Cloud, Salesforce Commerce Cloud |

---

## Verification (how to test end-to-end)

1. **Unit / per-probe (M2–M6):** run each probe against its known-good domain and assert the count:
   - Shopify: `mylapiel.com` → 120, `lstore.hr` → ~3,800.
   - Sitemap: `chipoteka.hr` → 44,752 total `<loc>` (index expanded); `vrutak.hr` → 5,162.
   - Pattern: `chipoteka.hr` → ~34,951 products; `vrutak.hr` → ~3,948.
   - Woo/Spree: pick one real domain each, compare to the site's own "N results" count.
2. **Ladder (M7):** run the 4 sample domains through `estimate.ts`; assert `method` + `confidence` + count.
3. **CLI batch (M8):** `npx tsx src/cli.ts run test/fixtures/belgium-slice.csv --out /tmp/out.csv`; confirm appended columns, original columns preserved, passthrough intact.
4. **Robustness (M9):** include a dead domain, a Cloudflare-protected domain, and a multi-MB-sitemap domain in the batch; confirm no crash, `cat_error`/`blocked` populated, others unaffected.
5. **Accuracy (M10):** 20-domain spot-check across platforms; manual count vs. tool; record deltas in README. Target: exact-API exact, sitemap ±15%.
6. **Acceptance (DoD):** enrich a full ~1,000-row StoreLeads export in < 15 min, inspect the confidence/method summary.

---

## Part 9 — Kickoff prompt (for the build session in the new repo)

```
I'm building the Ecommerce Catalog-Size Estimator. The full PRD is in PRD.md (this repo).
Start at Milestone 1 and work down the table in Part 4.1, one milestone at a time.

Rules:
- Honor the locked decisions in Part 3.4 / decisions.md — don't re-litigate without new evidence.
- Keep src/core/ (engine) cleanly separate from src/cli.ts (wrapper) — decision #3.
- Port, don't reinvent: copy fetchWithRetry, CSV helpers, and the p-limit pattern from the
  paths listed in Part 1.6.
- Count Shopify by "handle", not "id". Read Woo total from X-WP-Total. VERIFY Woo/Spree
  endpoints live before trusting them (M6).
- After each milestone, run its test step and append a line to history.md before moving on.
- No proxies, no DB, no web UI, no AI in the counting loop (decisions #6, #9, #10).
- Lead with recommendations; flag failure modes; ask before guessing on scope.
```
```
```
```

---

### Summary of decisions reflected here
- **Delivery:** core engine + CLI now; API/web later, same engine (decision #3).
- **Output:** counts + confidence + method + source_url; no URL dump (decision #5).
- **Scale:** hundreds–low thousands, throttle + backoff, **no proxies**; flag blocked (decision #6).
- **Routing:** use StoreLeads `platform` column; auto-detection deferred to v2 (decision #4).
