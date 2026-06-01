// Spree probe — product count via the Storefront API v2.
//
// /api/v2/storefront/products?per_page=1 returns JSON:API with meta.total_count.
//
// ⚠ UNVERIFIED (see decisions.md): no public live Spree store was available to
// confirm this at build time — Spree's demo is now a decoupled Next.js frontend
// whose API backend isn't exposed, and v2 may require a Bearer token. This probe
// is therefore written to be SAFE BY CONSTRUCTION: it only returns a number on a
// clean 200 + numeric meta.total_count; on anything else it returns null and the
// ladder falls through to the sitemap. Re-verify when a real Spree domain appears.

import { httpRequest, decodeText } from "../http.js";
import { baseUrls } from "../util.js";

export interface SpreeResult {
  count: number;
  sourceUrl: string;
}

/** Returns the exact product count, or null if not a usable Spree Storefront API. */
export async function probeSpree(domain: string): Promise<SpreeResult | null> {
  for (const base of baseUrls(domain)) {
    const url = `${base}/api/v2/storefront/products?per_page=1`;
    let res;
    try {
      res = await httpRequest(url, { timeoutMs: 12_000 });
    } catch {
      continue;
    }
    if (res.status !== 200) continue;

    let total: unknown;
    try {
      total = JSON.parse(decodeText(res))?.meta?.total_count;
    } catch {
      continue; // HTML or junk — not Spree JSON
    }
    if (typeof total === "number" && Number.isFinite(total)) {
      return { count: total, sourceUrl: url };
    }
  }
  return null;
}
