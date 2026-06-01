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
