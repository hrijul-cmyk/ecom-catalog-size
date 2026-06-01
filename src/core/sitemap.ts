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

/** Discover and read a domain's sitemap. Returns null if none is reachable. */
export async function fetchSitemap(domain: string): Promise<SitemapResult | null> {
  const sitemapUrl = await discoverSitemapUrl(domain);
  if (!sitemapUrl) return null;
  return readSitemap(sitemapUrl);
}

/** Find the sitemap URL via robots.txt, falling back to conventional locations. */
export async function discoverSitemapUrl(domain: string): Promise<string | null> {
  for (const base of baseUrls(domain)) {
    try {
      const res = await fetchText(`${base}/robots.txt`, { timeoutMs: 10_000 });
      if (res.ok) {
        const m = res.text.match(/^\s*sitemap:\s*(\S+)/im);
        if (m) return m[1].trim();
      }
      // robots.txt had no Sitemap line — try the conventional default on this base.
      const fallback = `${base}/sitemap.xml`;
      const head = await httpRequest(fallback, { timeoutMs: 10_000, maxBytes: 5 * 1024 * 1024 });
      if (head.ok || head.oversize) return fallback;
    } catch {
      // try next base
    }
  }
  return null;
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
