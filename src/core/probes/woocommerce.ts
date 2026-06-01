// WooCommerce probe — exact product count via the public Store API.
//
// The Store API (/wp-json/wc/store/...) is public by design (it powers the
// cart/blocks frontend). A single request with per_page=1 returns the total in
// the `X-WP-Total` response header — no pagination needed just to count.
//
// Verified live: barefootbuttons.com → X-WP-Total: 60.

import { httpRequest } from "../http.js";
import { baseUrls } from "../util.js";

export interface WooResult {
  count: number;
  sourceUrl: string;
}

const PATHS = [
  "/wp-json/wc/store/v1/products?per_page=1", // current
  "/wp-json/wc/store/products?per_page=1",     // older installs
];

/** Returns the exact product count, or null if not a usable WooCommerce Store API. */
export async function probeWoocommerce(domain: string): Promise<WooResult | null> {
  for (const base of baseUrls(domain)) {
    for (const path of PATHS) {
      const url = `${base}${path}`;
      let res;
      try {
        res = await httpRequest(url, { timeoutMs: 12_000 });
      } catch {
        continue;
      }
      if (res.status !== 200) continue;
      const total = res.headers.get("x-wp-total");
      if (total && /^\d+$/.test(total)) {
        return { count: Number(total), sourceUrl: url };
      }
      // 200 but no usable total header → don't guess; let the ladder fall through.
    }
  }
  return null;
}
