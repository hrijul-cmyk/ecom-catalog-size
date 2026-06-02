# History

Append-only build log. Newest at the bottom.

## 2026-06-01 — MVP build (M1–M11)

- **M1 Foundations** — repo scaffolded: `package.json` (Node20/TS/tsx, papaparse, p-limit,
  dotenv), `tsconfig.json`, `.gitignore`, `.env.example`, `src/core` + `src/cli.ts`.
- **M2 Shared utils** — `core/http.ts` (ported `fetchWithRetry` → normalized response with
  headers/final-URL/bytes; retries, backoff), `core/csv.ts` (papaparse read/write, preserves
  + appends columns), `core/util.ts` (domain normalize, base URLs).
- **M3 Shopify probe** — `products.json` pagination counting `handle`. ✅ mylapiel→120,
  lstore→3,800.
- **M4 Sitemap engine** — robots discovery, sitemap-index expansion, gunzip, `<loc>` regex.
  ✅ vrutak→5,162, vulkal→6,754. Caught a silent cap (60) dropping 32 of chipoteka's 92
  child sitemaps → raised to 500 with a `truncated` flag. ✅ chipoteka→44,752.
- **M5 Pattern registry** — per-platform product regex + `platformKey()` mapping. Added
  decision #13: confidence reflects match quality — pattern explaining <25% of URLs falls
  back to digit-proxy at `low`. ✅ chipoteka→34,950 [high], vrutak→4,008 [medium],
  vulkal→6,673 [digit-proxy/low] (the tire-shop edge case, now honest).
- **M6 Woo + Spree probes** — Woo Store API via `X-WP-Total` ✅ verified barefootbuttons→60.
  Spree shipped UNVERIFIED but safe-by-construction (decision #14) — no live Spree store
  reachable to confirm.
- **M7 Ladder** — `estimate.ts`: route→open-API→sitemap→none, never throws. Smart routing
  (decision: API-platform hint → one probe; sitemap-platform hint → skip APIs; unknown → try
  all). ✅ all 6 sample domains correct.
- **M8 CLI + CSV** — `run`/`check` commands, p-limit concurrency, progress, run summary.
  ✅ preserves passthrough columns (merchant_name), appends `cat_*` columns. Validated on a
  real StoreLeads slice (Belgium-SL-Shopify.csv).
- **M9 Robustness** — found 8–14/15 real Shopify brands returning `blocked`. Diagnosed:
  bot UA → 429, browser UA → 200 (decision #15). Switched default to a real browser UA.
  Parallelized child-sitemap fetches (decision #16). Added backoff jitter. Confirmed the
  tool correctly reports `blocked` (not a wrong number) when rate-limited.
  Note: during heavy iterative testing my IP got rate-limited on the reused fixture domains
  — a testing artifact, not a code bug; real lists of distinct domains don't hit it.
- **M10 Calibration** — spot-check table in README; accuracy: open-API exact, sitemap ~±15%.
- **M11 Docs** — README, decisions.md, runbook.md, PRD.md, this log, `.claude/CLAUDE.md`.

## 2026-06-02 — 500-domain test + Phase 2 (harden + productionize)

Ran the tool on a 500-domain mixed-platform list (`test.csv`). ~63% usable; an independent
19-store truth-test confirmed **high-confidence = 100% accurate** and that the "low" estimates were
the right order of magnitude (even badu.hr's 1.6M was real). Surfaced a precise fix list. Branch:
`phase2-harden-api`.

- **A1 Magento sitemap discovery** — probe `/sitemap/sitemap.xml`, `/pub/…`, `/media/…` after
  `/sitemap.xml`. `magiswall.hr` resolves; path-fallback verified.
- **A2 Relative sitemap URLs** — resolve robots.txt `Sitemap:` value against base (`new URL(v, base)`).
- **Bonus: blocked-vs-none** — discovery now flags 403/429 as `blocked`. The truth-test showed the
  Magento "none" misses (fashionandfriends ~120k, ecipele ~48k) are mostly WAF-blocked *real* stores,
  not dead domains — now honestly labeled `blocked` (re-run from clean IP). Did NOT add Googlebot
  spoofing (evasion).
- **A3 Magento over-count** — broadened `STATIC` with category/brand container slugs (EN + Croatian:
  brandovi, kategorija, …) so brand/category pages aren't counted as products.
- **A4 Zero→unknown** — sitemap with URLs but 0 product matches now returns `null`/`none`
  (`unreadable:patterns-matched-0`), not a false `0`. Verified: `proteka.hr`.
- **A5 `--retry-unresolved`** — carries over resolved rows from a prior enriched CSV, re-probes only
  blocked/none/empty. Verified: 2 carried / 2 re-probed on a mini run.
- **B1 HTTP API** (`src/server.ts`, Express) — GET/POST `/estimate` + `/health`, flat snake_case
  payload, optional bearer auth. Verified live: health, GET/POST, 400 on missing domain, 401 gate,
  and the compiled `npm run build && npm run start` path.
- **B2 Railway** — `railway.toml` (nixpacks, healthcheck `/health`), `start` script, `.env.example`.
- **B3 Docs** — `docs/integrations.md` (Clay HTTP column + Deepline generic_http + Railway deploy);
  README API + `--retry-unresolved` sections.
- Regression: `tsc --noEmit` clean; vrutak/chipoteka/vulkal counts unchanged. (Shopify throttle has
  since cooled — mylapiel/istyle resolve again.)
