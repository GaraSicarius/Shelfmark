const STRIPPED_PARAMS = [/^utm_/i, /^fbclid$/i, /^gclid$/i];

export interface NormalizedUrl {
  url: string;
  domain: string;
}

// Canonical form for dedupe: lowercase host, no fragment, no tracking params,
// sorted query params, no default port, no trailing slash on non-root paths.
export function normalizeUrl(raw: string): NormalizedUrl | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
    u.port = "";
  }
  for (const key of [...u.searchParams.keys()]) {
    if (STRIPPED_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  return { url: u.toString(), domain: u.hostname };
}
