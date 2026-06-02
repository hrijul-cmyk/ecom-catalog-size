// The ladder — estimate one domain's catalog size.
//
// Order (stop at first success):
//   1. Route by platform hint → try that platform's open API first (fast path).
//   2. Open product APIs (Shopify / Woo / Spree) — exact counts, confidence: high.
//   3. Sitemap → count <loc>, filter to products by pattern — estimate.
//   4. None → record why (blocked / no sitemap), confidence: none.
//
// Every path returns a CatalogEstimate; this function never throws.

import type { CatalogEstimate, PlatformHint } from "./types.js";
import { platformKey } from "./patterns.js";
import { probeShopify } from "./probes/shopify.js";
import { probeWoocommerce } from "./probes/woocommerce.js";
import { probeSpree } from "./probes/spree.js";
import { fetchSitemap } from "./sitemap.js";
import { countProducts } from "./patterns.js";

type OpenApiProbe = (domain: string) => Promise<{ count: number; sourceUrl: string } | null>;

const OPEN_API: Record<string, { method: CatalogEstimate["method"]; probe: OpenApiProbe }> = {
  shopify: { method: "shopify_api", probe: probeShopify },
  woocommerce: { method: "woo_store_api", probe: probeWoocommerce },
  spree: { method: "spree_api", probe: probeSpree },
};

export async function estimateCatalog(domain: string, platform?: PlatformHint): Promise<CatalogEstimate> {
  try {
    return await runLadder(domain, platform);
  } catch (err) {
    return {
      productCount: null,
      method: "none",
      confidence: "none",
      totalUrls: null,
      sourceUrl: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runLadder(domain: string, platform?: PlatformHint): Promise<CatalogEstimate> {
  const key = platformKey(platform);

  // 1+2. Open APIs. Routing by the platform hint avoids wasted requests:
  //   - hint is an API platform (shopify/woo/spree) → probe just that one
  //   - hint is a known sitemap platform (opencart/magento/…) → skip APIs
  //   - no/unknown hint → try all three open APIs, then sitemap
  const order = apiKeysToTry(key);
  for (const k of order) {
    const entry = OPEN_API[k];
    const hit = await entry.probe(domain);
    if (hit) {
      return {
        productCount: hit.count,
        method: entry.method,
        confidence: "high",
        totalUrls: null,
        sourceUrl: hit.sourceUrl,
        error: "",
      };
    }
  }

  // 3. Sitemap.
  const sm = await fetchSitemap(domain);
  if (sm && sm.urls.length > 0) {
    const filtered = countProducts(sm.urls, platform);
    const note = [
      sm.wasIndex ? "sitemap-index" : null,
      sm.truncated ? "truncated:floor" : null,
      sm.blocked ? "partial:blocked" : null,
    ]
      .filter(Boolean)
      .join(";");

    // Sitemap had URLs but none matched a product pattern → we can't read the
    // catalog, which is "unknown", NOT "0 products" (a false-empty store).
    if (filtered.count === 0) {
      return {
        productCount: null,
        method: sm.wasIndex ? "sitemap_index" : "sitemap",
        confidence: "none",
        totalUrls: sm.urls.length,
        sourceUrl: sm.sourceUrl,
        error: `unreadable:patterns-matched-0${note ? ";" + note : ""}`,
      };
    }

    return {
      productCount: filtered.count,
      method: sm.wasIndex ? "sitemap_index" : "sitemap",
      confidence: sm.blocked && filtered.confidence !== "low" ? "low" : filtered.confidence,
      totalUrls: sm.urls.length,
      sourceUrl: sm.sourceUrl,
      error: note ? `${filtered.patternKey};${note}` : filtered.patternKey,
    };
  }

  // 4. Nothing worked.
  if (sm === null) {
    return blank("none", "no sitemap or open API reachable");
  }
  // sitemap existed but empty (likely blocked children)
  return {
    productCount: null,
    method: "none",
    confidence: sm.blocked ? "blocked" : "none",
    totalUrls: 0,
    sourceUrl: sm.sourceUrl,
    error: sm.blocked ? "sitemap blocked" : "sitemap empty",
  };
}

/**
 * Decide which open-API probes to run given the platform hint:
 *   - hint maps to an open-API platform → just that one (trust the hint)
 *   - hint maps to a known sitemap-only platform → none (go straight to sitemap)
 *   - no/unknown hint → all open APIs (then sitemap)
 */
function apiKeysToTry(key: string | null): string[] {
  if (key && OPEN_API[key]) return [key];
  if (key) return []; // known platform, but sitemap-only → skip API probes
  return Object.keys(OPEN_API);
}

function blank(method: CatalogEstimate["method"], error: string): CatalogEstimate {
  return { productCount: null, method, confidence: "none", totalUrls: null, sourceUrl: null, error };
}
