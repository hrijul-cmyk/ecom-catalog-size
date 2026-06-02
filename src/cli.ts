#!/usr/bin/env -S npx tsx
// CLI wrapper — thin layer over the core engine (src/core). Two modes:
//   catalog-size run <input.csv> [--out file] [--concurrency N] [--domain-col c] [--platform-col c]
//   catalog-size check <domain> [<domain> ...]
//
// The engine does all the work; this file only does argv, CSV I/O, concurrency,
// progress, and the run summary. Keeping it thin is locked decision #3 (so a web
// UI or API can reuse src/core unchanged).

import "dotenv/config";
import pLimit from "p-limit";
import { existsSync } from "node:fs";
import { readCsv, writeCsv, pick, type Row } from "./core/csv.js";
import { estimateCatalog } from "./core/estimate.js";
import { normalizeDomain } from "./core/util.js";
import type { CatalogEstimate } from "./core/types.js";

const DOMAIN_COLS = ["domain", "final_domain", "website", "url", "company_domain", "site"];
const PLATFORM_COLS = ["platform", "ecommerce_platform", "cms"];
const OUT_COLS = {
  count: "cat_product_count",
  method: "cat_method",
  confidence: "cat_confidence",
  total: "cat_total_urls",
  source: "cat_source_url",
  error: "cat_error",
} as const;

function defaultConcurrency(): number {
  const n = Number(process.env.CATALOG_CONCURRENCY);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === "--help" || cmd === "-h") return printHelp();
  if (cmd === "check") return runCheck(argv.slice(1));
  if (cmd === "run") return runCsv(argv.slice(1));

  // Bare args: if first looks like a CSV path use run, else treat as domains.
  if (cmd.endsWith(".csv")) return runCsv(argv);
  return runCheck(argv);
}

// --- check: ad-hoc domains → printed table ---
async function runCheck(args: string[]) {
  const domains = args.filter((a) => !a.startsWith("-"));
  if (!domains.length) return fail("check needs at least one domain");
  const limit = pLimit(defaultConcurrency());
  const results = await Promise.all(
    domains.map((d) => limit(async () => ({ domain: normalizeDomain(d), est: await estimateCatalog(d) }))),
  );
  for (const { domain, est } of results) {
    console.log(
      `${domain.padEnd(24)} ${String(est.productCount ?? "—").padStart(7)}  ${est.method.padEnd(13)} ${est.confidence.padEnd(7)} ${est.error}`,
    );
  }
}

// --- run: CSV in → enriched CSV out ---
async function runCsv(args: string[]) {
  const input = args.find((a) => !a.startsWith("-"));
  if (!input) return fail("run needs an input CSV path");
  if (!existsSync(input)) return fail(`input not found: ${input}`);

  const out = optValue(args, "--out") ?? input.replace(/\.csv$/i, "") + ".enriched.csv";
  const concurrency = Number(optValue(args, "--concurrency")) || defaultConcurrency();
  const domainCol = optValue(args, "--domain-col");
  const platformCol = optValue(args, "--platform-col");
  const retryPrev = optValue(args, "--retry-unresolved");

  const { headers, rows } = readCsv(input);
  if (!rows.length) return fail("input CSV has no rows");

  const dCol = domainCol ?? findCol(headers, DOMAIN_COLS);
  if (!dCol) return fail(`no domain column found (looked for: ${DOMAIN_COLS.join(", ")}). Use --domain-col.`);
  const pCol = platformCol ?? findCol(headers, PLATFORM_COLS);

  // Retry mode: carry over already-resolved rows from a prior enriched CSV, and
  // only re-probe the ones that came back blocked/none/empty.
  let resolved: Map<string, Row> | null = null;
  if (retryPrev) {
    if (!existsSync(retryPrev)) return fail(`--retry-unresolved file not found: ${retryPrev}`);
    resolved = loadResolved(retryPrev);
  }

  console.log(`Reading ${rows.length} rows from ${input}`);
  console.log(`  domain column: ${dCol}${pCol ? ` | platform column: ${pCol}` : " | no platform column (will route by probe)"}`);
  console.log(`  concurrency: ${concurrency}`);
  if (resolved) console.log(`  retry mode: carrying over ${resolved.size} resolved rows from ${retryPrev}; re-probing the rest`);

  const start = Date.now();
  const limit = pLimit(concurrency);
  let done = 0;
  let carried = 0;
  const tick = Math.max(1, Math.floor(rows.length / 20));

  await Promise.all(
    rows.map((row) =>
      limit(async () => {
        const domain = pick(row, dCol);
        const key = domain ? normalizeDomain(domain) : "";

        // Carry over a previously-resolved row without re-probing.
        if (resolved && key && resolved.has(key)) {
          Object.assign(row, resolved.get(key));
          carried++;
          done++;
          if (done % tick === 0 || done === rows.length) process.stdout.write(`  ...${done}/${rows.length}\n`);
          return;
        }

        const platform = pCol ? pick(row, pCol) : "";
        const est: CatalogEstimate = domain
          ? await estimateCatalog(domain, platform || null)
          : { productCount: null, method: "none", confidence: "none", totalUrls: null, sourceUrl: null, error: "empty domain" };
        applyResult(row, est);
        done++;
        if (done % tick === 0 || done === rows.length) {
          process.stdout.write(`  ...${done}/${rows.length}\n`);
        }
      }),
    ),
  );

  writeCsv(out, headers, rows);
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nWrote ${rows.length} rows → ${out} (${secs}s)`);
  if (resolved) console.log(`  carried over: ${carried} | re-probed: ${rows.length - carried}`);
  printSummary(rows);
}

/**
 * Load already-resolved rows from a prior enriched CSV, keyed by normalized domain.
 * "Resolved" = has a product count AND confidence high/medium/low. Rows that were
 * blocked/none/empty are omitted so they get re-probed.
 */
function loadResolved(prevPath: string): Map<string, Row> {
  const { headers, rows } = readCsv(prevPath);
  const dCol = findCol(headers, DOMAIN_COLS);
  const map = new Map<string, Row>();
  if (!dCol) return map;
  const GOOD = new Set(["high", "medium", "low"]);
  for (const r of rows) {
    const dom = pick(r, dCol);
    if (!dom) continue;
    if (r[OUT_COLS.count] === "" || !GOOD.has(r[OUT_COLS.confidence])) continue;
    const catCols: Row = {};
    for (const c of Object.values(OUT_COLS)) catCols[c] = r[c] ?? "";
    map.set(normalizeDomain(dom), catCols);
  }
  return map;
}

function applyResult(row: Row, est: CatalogEstimate) {
  row[OUT_COLS.count] = est.productCount == null ? "" : String(est.productCount);
  row[OUT_COLS.method] = est.method;
  row[OUT_COLS.confidence] = est.confidence;
  row[OUT_COLS.total] = est.totalUrls == null ? "" : String(est.totalUrls);
  row[OUT_COLS.source] = est.sourceUrl ?? "";
  row[OUT_COLS.error] = est.error;
}

function printSummary(rows: Row[]) {
  const by = (col: string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r[col], (m.get(r[col]) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k || "—"}:${v}`).join("  ");
  };
  console.log("Methods:    ", by(OUT_COLS.method));
  console.log("Confidence: ", by(OUT_COLS.confidence));
}

// --- arg helpers ---
function optValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
function findCol(headers: string[], candidates: string[]): string | null {
  const lower = new Map(headers.map((h) => [h.toLowerCase(), h]));
  for (const c of candidates) if (lower.has(c)) return lower.get(c)!;
  return null;
}
function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}
function printHelp() {
  console.log(`catalog-size — estimate ecommerce catalog size from a list of domains

Usage:
  catalog-size run <input.csv> [options]     Enrich a CSV of domains
  catalog-size check <domain> [domain...]    Ad-hoc check, printed to stdout

Options (run):
  --out <path>              Output CSV (default: <input>.enriched.csv)
  --concurrency <n>         Parallel domains (default: 10, or $CATALOG_CONCURRENCY)
  --domain-col <name>       Domain column override (auto: ${DOMAIN_COLS.join(", ")})
  --platform-col <name>     Platform column override (auto: ${PLATFORM_COLS.join(", ")})
  --retry-unresolved <csv>  Carry over resolved rows from a prior enriched CSV and
                            only re-probe the blocked/none/empty ones (e.g. re-run
                            throttled rows from a clean IP)

Appended columns: ${Object.values(OUT_COLS).join(", ")}

Examples:
  catalog-size check mylapiel.com chipoteka.hr
  catalog-size run leads.csv --out enriched.csv --concurrency 12
  catalog-size run leads.csv --retry-unresolved leads.enriched.csv --out leads.v2.csv`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
