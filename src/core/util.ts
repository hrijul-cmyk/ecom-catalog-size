// Small shared helpers for domains and URLs.

/** Strip scheme, path, and trailing dots from a raw domain/URL string. */
export function normalizeDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/\/.*$/, "");      // drop any path
  d = d.replace(/^www\./, "");      // canonical bare host
  d = d.replace(/\.+$/, "");
  return d;
}

/**
 * Candidate base URLs to try for a domain, in priority order:
 * https www, then https apex. (Most stores redirect between them, and
 * fetch follows redirects, so the first reachable one wins.)
 */
export function baseUrls(domain: string): string[] {
  const d = normalizeDomain(domain);
  return [`https://www.${d}`, `https://${d}`];
}

/** Extract the host from a URL, lowercased, without www. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}
