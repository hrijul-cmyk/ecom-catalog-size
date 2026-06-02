// Sitemap engine — discover, fetch, expand, and extract URLs.
//
// Flow:
//   1. Discover the sitemap URL from robots.txt (fallback: /sitemap.xml).
//   2. Fetch it; gunzip if it's a .gz.
//   3. If it's a <sitemapindex>, fetch each child sitemap (one level) and merge.
//   4. Return every <loc> URL found.
//
// We use regex extraction rather than a DOM XML parser: sitemaps are flat and
// often huge (tens of MB), and the prototype proved regex is fast and low-memory.

import { gunzipSync } from "node:zlib";
import pLimit from "p-limit";
import { httpRequest, decodeText, fetchText } from "./http.js";
import { baseUrls } from "./util.js";

const MAX_CHILD_SITEMAPS = 500; // backstop for pathological indexes; flagged if hit
const CHILD_CONCURRENCY = 8;    // parallel child-sitemap fetches within one domain

export interface SitemapResult {
  /** Every <loc> URL across the sitemap (and its children if it was an index). */
  urls: string[];
  /** The sitemap URL we read from. */
  sourceUrl: string;
  /** True when the source was a <sitemapindex> expanded into children. */
  wasIndex: boolean;
  /** True if any fetch hit a block (403/Cloudflare) — caller may mark blocked. */
  blocked: boolean;
  /** True if the index had more children than MAX_CHILD_SITEMAPS (count is a floor). */
  truncated: boolean;
}

/** Discover and read a domain's sitemap. Returns null only if genuinely none is reachable. */
export async function fetchSitemap(domain: string): Promise<SitemapResult | null> {
  const { url, blocked } = await discoverSitemapUrl(domain);
  if (url) return readSitemap(url);
  // No sitemap URL found. If discovery was blocked (403/429), say so — these are usually
  // real stores behind a WAF, not dead domains; the caller marks them `blocked`, not `none`.
  if (blocked) return { urls: [], sourceUrl: "", wasIndex: false, blocked: true, truncated: false };
  return null;
}

// Conventional sitemap locations, tried in order when robots.txt has no Sitemap line.
// Magento commonly serves at /sitemap/sitemap.xml, /pub/sitemap.xml, or /media/sitemap.xml,
// so plain /sitemap.xml alone silently misses large Magento catalogs.
const FALLBACK_PATHS = ["/sitemap.xml", "/sitemap/sitemap.xml", "/pub/sitemap.xml", "/media/sitemap.xml"];

const BLOCK_STATUSES = new Set([401, 403, 429, 503]);

export interface SitemapDiscovery {
  url: string | null;
  /** True if robots.txt or a fallback probe was blocked (403/429/…) rather than simply 404. */
  blocked: boolean;
}

/** Find the sitemap URL via robots.txt, falling back to conventional locations. */
export async function discoverSitemapUrl(domain: string): Promise<SitemapDiscovery> {
  let blocked = false;
  for (const base of baseUrls(domain)) {
    try {
      const res = await fetchText(`${base}/robots.txt`, { timeoutMs: 10_000 });
      if (BLOCK_STATUSES.has(res.status)) blocked = true;
      if (res.ok) {
        const m = res.text.match(/^\s*sitemap:\s*(\S+)/im);
        // Resolve against the base so a relative "Sitemap: /feeds/sitemap.xml" works.
        if (m) return { url: new URL(m[1].trim(), `${base}/`).toString(), blocked };
      }
      // robots.txt had no Sitemap line — probe conventional locations on this base.
      for (const path of FALLBACK_PATHS) {
        const head = await httpRequest(`${base}${path}`, { timeoutMs: 10_000, maxBytes: 5 * 1024 * 1024 });
        if (BLOCK_STATUSES.has(head.status)) blocked = true;
        if (head.ok || head.oversize) return { url: `${base}${path}`, blocked };
      }
    } catch {
      // try next base
    }
  }
  return { url: null, blocked };
}

/** Read a sitemap URL, expanding a sitemap index one level deep. */
export async function readSitemap(sitemapUrl: string): Promise<SitemapResult> {
  let blocked = false;
  const root = await getXml(sitemapUrl);
  if (root.blocked) blocked = true;
  const xml = root.xml;

  if (/<sitemapindex/i.test(xml)) {
    const allChildren = extractLocs(xml);
    const truncated = allChildren.length > MAX_CHILD_SITEMAPS;
    const children = allChildren.slice(0, MAX_CHILD_SITEMAPS);
    const limit = pLimit(CHILD_CONCURRENCY);
    const chunks = await Promise.all(
      children.map((child) =>
        limit(async () => {
          try {
            const c = await getXml(child);
            return c;
          } catch {
            return { xml: "", blocked: false }; // skip an unreadable child sitemap
          }
        }),
      ),
    );
    const urls: string[] = [];
    for (const c of chunks) {
      if (c.blocked) blocked = true;
      for (const u of extractLocs(c.xml)) urls.push(u);
    }
    return { urls, sourceUrl: sitemapUrl, wasIndex: true, blocked, truncated };
  }

  return { urls: extractLocs(xml), sourceUrl: sitemapUrl, wasIndex: false, blocked, truncated: false };
}

/** Fetch one sitemap URL and return decoded XML (gunzipping .gz payloads). */
async function getXml(url: string): Promise<{ xml: string; blocked: boolean }> {
  const res = await httpRequest(url, { timeoutMs: 20_000 });
  if (res.status === 403 || res.status === 429 || res.status === 503) {
    return { xml: "", blocked: true };
  }
  if (!res.ok || res.oversize) return { xml: "", blocked: false };

  const isGzip =
    url.endsWith(".gz") ||
    (res.bytes.length > 2 && res.bytes[0] === 0x1f && res.bytes[1] === 0x8b);
  if (isGzip) {
    try {
      return { xml: gunzipSync(res.bytes).toString("utf-8"), blocked: false };
    } catch {
      return { xml: "", blocked: false };
    }
  }
  return { xml: decodeText(res), blocked: false };
}

/** Extract all <loc>…</loc> URLs from sitemap XML. */
export function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(decodeEntities(m[1]));
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
