// Product-URL pattern registry.
//
// This is the ONE file to edit when adding a platform (locked decision #8). Each
// platform maps to a set of regexes that identify a *product* URL slug, plus the
// confidence we assign when that pattern is the one used. The sitemap of most
// non-Shopify stores mixes product, category, and brand pages at the same path
// depth, so we separate them by slug shape.
//
// `STATIC` strips obvious non-product pages first (cart, blog, account…). After
// that, a URL counts as a product if any of the platform's patterns match.

import { hostOf } from "./util.js";
import type { Confidence } from "./types.js";

/** Pages that are never products — removed before pattern matching. */
export const STATIC =
  /\/(search|contact(us)?|news|blog|about|account|login|register|cart|checkout|wishlist|compare|faq|terms|privacy|shipping|returns|sitemap|page|pages|category|categories|brand|brands|manufacturer|tag|tags)(\/|$|\?|\.)/i;

export interface PlatformPatterns {
  /** Regexes that match a product-URL slug/path. Any match → product. */
  product: RegExp[];
  /** Confidence to assign when this platform's pattern is used. */
  confidence: Confidence;
}

// Slug shapes seen in the wild:
//   OpenCart       …/igra-za-ps5-...-9150062568   (trailing numeric product id)
//   nopCommerce    …/zilavka-keza-075l-...-61-     (trailing -id- or -id)
//   Magento        …/some-product-name.html       (.html leaf)
//   PrestaShop     …/123-product-name(.html)       (id-prefixed leaf)
//   WooCommerce    …/product/<slug>/               (/product/ segment)
//   Volume token   …-075l-… / …-0-7l-…             (bottle sizes — wine/spirits)
const TRAILING_ID = /-\d{3,}\/?$/i;
const NOPCOMMERCE_ID = /-\d+-?\/?$/i;
const MAGENTO_HTML = /\/[a-z0-9-]+\.html?$/i;
const PRESTASHOP_ID = /\/\d+-[a-z0-9-]+(\.html)?\/?$/i;
const WOO_SEGMENT = /\/product\/[^/]+\/?$/i;
const VOLUME = /[-/]\d{1,3}(-\d{1,2})?\s?l\b/i;

export const REGISTRY: Record<string, PlatformPatterns> = {
  shopify: { product: [/\/products\/[^/]+\/?$/i], confidence: "high" },
  woocommerce: { product: [WOO_SEGMENT], confidence: "medium" },
  opencart: { product: [TRAILING_ID], confidence: "high" },
  nopcommerce: { product: [NOPCOMMERCE_ID, VOLUME], confidence: "medium" },
  magento: { product: [MAGENTO_HTML], confidence: "medium" },
  prestashop: { product: [PRESTASHOP_ID], confidence: "medium" },
  bigcommerce: { product: [TRAILING_ID, MAGENTO_HTML], confidence: "low" },
};

/** Generic fallback when the platform is unknown: any slug containing a digit. */
const GENERIC_DIGIT = /\/[^/]*\d[^/]*\/?$/;

/** Map a free-text StoreLeads platform value to a registry key. */
export function platformKey(platform: string | null | undefined): string | null {
  if (!platform) return null;
  const p = platform.toLowerCase();
  if (p.includes("shopify")) return "shopify";
  if (p.includes("woo")) return "woocommerce";
  if (p.includes("opencart")) return "opencart";
  if (p.includes("nopcommerce")) return "nopcommerce";
  if (p.includes("magento") || p.includes("adobe commerce")) return "magento";
  if (p.includes("prestashop")) return "prestashop";
  if (p.includes("bigcommerce")) return "bigcommerce";
  return null;
}

export interface ProductFilterResult {
  count: number;
  /** Which pattern set was used. */
  patternKey: string;
  confidence: Confidence;
}

/**
 * Count product URLs among sitemap locs. If `platform` resolves to a known
 * registry key we use its patterns; otherwise we pick whichever registry pattern
 * flags the most URLs. Either way we sanity-check the *fraction* of non-static
 * URLs the pattern explains: a pattern that only matches a small slice is failing
 * (e.g. nopCommerce tire-shop slugs without a trailing id), so we fall back to
 * the digit proxy and downgrade confidence. Confidence is thus a function of
 * match quality, not just platform identity.
 *
 * Multi-locale stores duplicate every product per language prefix; we dedupe by
 * stripping a leading 2-letter locale segment before counting.
 */
export function countProducts(locs: string[], platform?: string | null): ProductFilterResult {
  const paths = dedupeLocale(
    locs
      .map((u) => pathOf(u))
      .filter((p) => p && p !== "/" && !STATIC.test(p)),
  );
  const denom = paths.length || 1;
  const digitProxy = paths.filter((p) => GENERIC_DIGIT.test(p)).length;

  // Choose a pattern: declared platform first, else best-matching registry entry.
  const key = platformKey(platform);
  let chosen: { count: number; patternKey: string; baseConfidence: Confidence } | null = null;

  if (key && REGISTRY[key]) {
    const pat = REGISTRY[key];
    const count = paths.filter((p) => pat.product.some((re) => re.test(p))).length;
    if (count > 0) chosen = { count, patternKey: key, baseConfidence: pat.confidence };
  }
  if (!chosen) {
    let best = { count: 0, patternKey: "none", baseConfidence: "low" as Confidence };
    for (const [name, pat] of Object.entries(REGISTRY)) {
      const count = paths.filter((p) => pat.product.some((re) => re.test(p))).length;
      if (count > best.count) best = { count, patternKey: name, baseConfidence: "low" };
    }
    if (best.count > 0) chosen = best;
  }

  // No pattern matched anything → pure digit proxy.
  if (!chosen) {
    return { count: digitProxy, patternKey: "digit-proxy", confidence: digitProxy > 0 ? "low" : "none" };
  }

  const fraction = chosen.count / denom;

  // Pattern explains too little of the sitemap → it's missing this store's slug
  // style. The digit proxy is usually closer; report it, flagged low.
  if (fraction < 0.25 && digitProxy > chosen.count) {
    return { count: digitProxy, patternKey: "digit-proxy", confidence: "low" };
  }

  // Otherwise cap confidence by how much of the sitemap the pattern explains.
  const confidence = capConfidence(chosen.baseConfidence, fraction);
  return { count: chosen.count, patternKey: chosen.patternKey, confidence };
}

/** Downgrade confidence when the pattern explains only part of the sitemap. */
function capConfidence(base: Confidence, fraction: number): Confidence {
  if (fraction >= 0.5) return base;
  if (fraction >= 0.25) return base === "high" ? "medium" : base;
  return "low";
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/** Strip a leading /xx/ or /xx-yy/ locale segment so multi-language stores don't double-count. */
function dedupeLocale(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const stripped = p.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/)/i, "");
    if (seen.has(stripped)) continue;
    seen.add(stripped);
    out.push(p);
  }
  return out;
}

// hostOf re-exported for callers that want the sitemap host (kept for symmetry).
export { hostOf };
