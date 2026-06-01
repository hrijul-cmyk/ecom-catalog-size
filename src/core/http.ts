// HTTP layer for the catalog-size engine.
//
// Ported and adapted from email-waterfall/lib/providers/_retry.ts. The waterfall
// version returns parsed JSON and throws on non-2xx; here we instead return a
// normalized response (status, final URL, headers, raw bytes) WITHOUT throwing on
// HTTP status, because the engine needs to inspect 403/blocked responses and read
// headers like `X-WP-Total`. Network errors still retry with exponential backoff.

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_MAX_BYTES = 60 * 1024 * 1024; // 60 MB sitemap safety cap
const NETWORK_ERROR_PATTERN = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|UND_ERR|aborted/i;

// A realistic browser UA matters: many stores (Cloudflare-fronted fashion brands)
// return 429/403 to obviously-bot User-Agents but 200 to a normal browser string.
// Verified: driesvannoten/serax/komono products.json → 429 (bot) vs 200 (browser).
const DEFAULT_UA =
  process.env.CATALOG_USER_AGENT ??
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface HttpOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryableStatuses?: Set<number>;
  headers?: Record<string, string>;
  method?: string;
  /** Skip download (return oversize=true) when content-length exceeds this. */
  maxBytes?: number;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  /** Final URL after redirects. */
  url: string;
  headers: Headers;
  /** Raw response bytes (may be empty on error/oversize). */
  bytes: Uint8Array;
  /** True when the body was skipped because content-length exceeded maxBytes. */
  oversize: boolean;
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  if (err instanceof Error) return NETWORK_ERROR_PATTERN.test(err.message);
  return false;
}

function backoffMs(attempt: number): number {
  // Exponential backoff with ±25% jitter to avoid synchronized retries (thundering
  // herd) when many domains hit the same CDN / rate limiter at once.
  const base = Math.min(1000 * 2 ** attempt, 16_000);
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

/**
 * Fetch a URL with retry on network errors and retryable statuses. Returns a
 * normalized response. Does NOT throw on HTTP status — callers inspect `.status`.
 * Throws only when all retries are exhausted on a network error.
 */
export async function httpRequest(url: string, options: HttpOptions = {}): Promise<HttpResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryable = options.retryableStatuses ?? DEFAULT_RETRYABLE;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const headers = { "user-agent": DEFAULT_UA, ...(options.headers ?? {}) };

  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? "GET",
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (!isNetworkError(err)) throw err;
      lastError = err;
      if (attempt < maxRetries - 1) await sleep(backoffMs(attempt));
      continue;
    }
    clearTimeout(timer);

    // Retry server-side hiccups with backoff.
    if (retryable.has(response.status) && attempt < maxRetries - 1) {
      const retryAfter = response.headers.get("retry-after");
      const waitMs = retryAfter ? Math.max(1000, parseInt(retryAfter, 10) * 1000) : backoffMs(attempt);
      lastError = new Error(`${response.status} on ${response.url}`);
      await sleep(waitMs);
      continue;
    }

    // Guard against pulling a huge body into memory.
    const lenHeader = response.headers.get("content-length");
    if (lenHeader && Number(lenHeader) > maxBytes) {
      return { ok: response.ok, status: response.status, url: response.url, headers: response.headers, bytes: new Uint8Array(), oversize: true };
    }

    const buf = new Uint8Array(await response.arrayBuffer());
    return { ok: response.ok, status: response.status, url: response.url, headers: response.headers, bytes: buf, oversize: false };
  }

  throw lastError ?? new Error(`http: exhausted ${maxRetries} retries for ${url}`);
}

/** Decode a response body as UTF-8 text. */
export function decodeText(res: HttpResponse): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(res.bytes);
}

/** Convenience: GET a URL and return its text body (empty string on non-2xx). */
export async function fetchText(url: string, options?: HttpOptions): Promise<HttpResponse & { text: string }> {
  const res = await httpRequest(url, options);
  return { ...res, text: res.ok ? decodeText(res) : "" };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
