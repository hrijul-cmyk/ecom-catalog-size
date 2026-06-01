# Operating Instructions for Claude Code

This is the **ecom-catalog-size** tool — estimates an ecommerce store's product count from
a list of domains. Internal Cold Labs tool. Owner: Alexander (GTM Engineer).

## Read these FIRST every session

1. `PRD.md` — the full spec and build plan.
2. `history.md` — current build state (what's done / broken / in progress).
3. `decisions.md` — locked decisions. Do not re-litigate without evidence.

## How to behave

- Lead with recommendations, not menus. Defend your pick if challenged.
- Surface trade-offs in 1–2 sentences. Flag real risks; don't drown decisions in caveats.
- No sycophancy. Brutal honesty over politeness.
- Reject over-engineering. Default answer to "should we add X?" is **no** unless proven.
- If a request contradicts a locked decision, flag the contradiction before agreeing.

## How to work

- `npx tsx src/cli.ts check <domain>` for a quick manual probe; `run <csv>` for batches.
- After meaningful changes, append to `history.md`. After an architectural decision, add a
  row to `decisions.md` (1-line statement + 1-line reason).
- **Verify probes against a real live domain before trusting them** (PRD principle). The
  Spree probe is currently unverified (decision #14) — keep it safe-by-construction.
- Don't hammer the same domain when testing — it rate-limits your IP. Use distinct domains.

## Architecture (locked decision #3)

- `src/core/` is the engine. Keep it free of CLI concerns so an API/web wrapper can reuse it.
- `src/cli.ts` is a thin wrapper: argv, CSV I/O, concurrency, progress, summary. Nothing else.
- New platform support = edit **`src/core/patterns.ts` only** (decision #8).

## What NOT to do (MVP scope)

- No proxies, no database, no web UI, no AI in the counting loop (decisions #6, #9, #10).
- No testing frameworks / Prettier / Husky unless explicitly asked.
- No platform auto-detection — route by the StoreLeads `platform` column (decision #4).
