// Shopify probe — exact product count via the open /products.json endpoint.
//
// /products.json?limit=250&page=N is public on Shopify storefronts. Each entry
// is ONE product (count `handle`, never `id` — id also appears on variants and
// images, inflating the count ~8x). We paginate until a page returns < limit.

import { httpRequest, decodeText } from "../http.js";
import { baseUrls } from "../util.js";

const LIMIT = 250;
const MAX_PAGES = 200; // hard backstop = 50,000 products

export interface ShopifyResult {
  count: number;
  sourceUrl: string;
}

/** Returns the exact product count, or null if the domain is not a usable Shopify store. */
export async function probeShopify(domain: string): Promise<ShopifyResult | null> {
  for (const base of baseUrls(domain)) {
    const result = await countFrom(base);
    if (result) return result;
  }
  return null;
}

async function countFrom(base: string): Promise<ShopifyResult | null> {
  let total = 0;
  let firstUrl = "";
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${base}/products.json?limit=${LIMIT}&page=${page}`;
    if (page === 1) firstUrl = url;

    let res;
    try {
      res = await httpRequest(url, { timeoutMs: 12_000 });
    } catch {
      return null; // network failure — let the ladder fall through
    }
    if (!res.ok) return null; // 404/403/etc → not a usable Shopify JSON endpoint

    let products: unknown;
    try {
      products = JSON.parse(decodeText(res))?.products;
    } catch {
      return null; // HTML or junk — not Shopify JSON
    }
    if (!Array.isArray(products)) return null;

    total += products.length;
    if (products.length < LIMIT) break; // last page
  }
  return { count: total, sourceUrl: firstUrl };
}
