// CSV read/write helpers (papaparse), following the email-waterfall convention
// of preserving original columns and appending enrichment columns.

import Papa from "papaparse";
import { readFileSync, writeFileSync } from "node:fs";

export type Row = Record<string, string>;

export interface ParsedCsv {
  headers: string[];
  rows: Row[];
}

/** Parse a CSV file into headers + row objects (all values coerced to strings). */
export function readCsv(path: string): ParsedCsv {
  const text = readFileSync(path, "utf-8");
  const result = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: true,
    transform: (v) => (v == null ? "" : String(v)),
  });
  if (result.errors.length) {
    const first = result.errors[0];
    throw new Error(`CSV parse error at row ${first.row}: ${first.message}`);
  }
  const headers = result.meta.fields ?? [];
  return { headers, rows: result.data };
}

/**
 * Write rows to a CSV, preserving the original header order and appending any
 * new keys (the enrichment columns) at the end in first-seen order.
 */
export function writeCsv(path: string, originalHeaders: string[], rows: Row[]): void {
  const seen = new Set(originalHeaders);
  const extra: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        extra.push(key);
      }
    }
  }
  const columns = [...originalHeaders, ...extra];
  const csv = Papa.unparse({ fields: columns, data: rows.map((r) => columns.map((c) => r[c] ?? "")) });
  writeFileSync(path, csv, "utf-8");
}

/** Case-insensitive lookup of a column value (e.g. find "Domain" / "domain" / "DOMAIN"). */
export function pick(row: Row, ...names: string[]): string {
  const lower = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]));
  for (const name of names) {
    const key = lower.get(name.toLowerCase());
    if (key && row[key]?.trim()) return row[key].trim();
  }
  return "";
}
