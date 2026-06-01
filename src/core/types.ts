// Shared types for the catalog-size engine.

/** How the count was obtained. Ordered roughly most → least trustworthy. */
export type Method =
  | "shopify_api"
  | "woo_store_api"
  | "spree_api"
  | "sitemap_index"
  | "sitemap"
  | "category_count"
  | "none";

/** Trust level attached to every result. */
export type Confidence = "high" | "medium" | "low" | "blocked" | "none";

/** The result of estimating one domain's catalog size. */
export interface CatalogEstimate {
  /** Exact count (open API) or filtered estimate (sitemap). Null when unknown. */
  productCount: number | null;
  method: Method;
  confidence: Confidence;
  /** Total <loc> entries in the sitemap — an upper bound. Null for API methods. */
  totalUrls: number | null;
  /** The API or sitemap URL the number came from. */
  sourceUrl: string | null;
  /** Short error/diagnostic string; empty when clean. */
  error: string;
}

/** Platform string as it may appear in a StoreLeads `platform` column. */
export type PlatformHint = string | null | undefined;
