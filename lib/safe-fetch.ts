import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export type SafeFetchErrorCode =
  | "blocked"
  | "bad_protocol"
  | "auth"
  | "too_large"
  | "bad_content_type"
  | "timeout"
  | "network"
  | "too_many_redirects";

const PERMANENT_CODES = new Set<SafeFetchErrorCode>([
  "blocked",
  "bad_protocol",
  "auth",
  "too_large",
  "bad_content_type",
]);

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  constructor(code: SafeFetchErrorCode, message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
  }
  get permanent(): boolean {
    return PERMANENT_CODES.has(this.code);
  }
}

const BLOCKED_MESSAGE = "This address is not reachable from this app.";
const AUTH_MESSAGE =
  "This page requires sign-in or blocks automated access. Paste the text instead.";
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_CONTENT = new Set(["text/html", "application/xhtml+xml", "text/plain"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const blocklist = (() => {
  const bl = new net.BlockList();
  const v4: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];
  for (const [addr, prefix] of v4) bl.addSubnet(addr, prefix, "ipv4");
  const v6: Array<[string, number]> = [
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 32], // Teredo tunnels can carry private IPv4
    ["2001:db8::", 32],
    ["2002::", 16], // 6to4 likewise
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ];
  for (const [addr, prefix] of v6) bl.addSubnet(addr, prefix, "ipv6");
  bl.addAddress("::", "ipv6");
  bl.addAddress("::1", "ipv6");
  return bl;
})();

// ::ffff:0:0/96 cannot go in the BlockList: Node normalizes a checked IPv4 to
// its mapped form internally, so that subnet would block every IPv4 address.
// Extract the embedded IPv4 manually instead — dotted (::ffff:127.0.0.1) and
// the WHATWG-normalized hex form (::ffff:7f00:1) both appear in URLs.
function mappedV4(address: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

export function isBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) return blocklist.check(address, "ipv4");
  if (net.isIPv6(address)) {
    const mapped = mappedV4(address);
    if (mapped) {
      return blocklist.check(mapped, "ipv4") || blocklist.check(address, "ipv6");
    }
    return blocklist.check(address, "ipv6");
  }
  return true;
}

export type AddressPolicy = (address: string, family: number) => boolean;

export interface FetchPolicy {
  allowAddress: AddressPolicy;
  allowedPorts: ReadonlySet<number>;
}

const productionPolicy: FetchPolicy = {
  allowAddress: (address) => !isBlockedAddress(address),
  allowedPorts: new Set([80, 443]),
};

export interface SafeFetchResult {
  status: number;
  contentType: string;
  body: string;
  finalUrl: string;
}

function bareHost(url: URL): string {
  const host = url.hostname;
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "http:" ? 80 : 443;
}

function validateUrl(raw: string, policy: FetchPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("bad_protocol", "Invalid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("bad_protocol", "Only http and https URLs can be saved.");
  }
  if (url.username || url.password) {
    throw new SafeFetchError("bad_protocol", "URLs with embedded credentials are not allowed.");
  }
  if (!policy.allowedPorts.has(effectivePort(url))) {
    throw new SafeFetchError("bad_protocol", "Only standard ports 80 and 443 are allowed.");
  }
  const host = bareHost(url);
  const family = net.isIPv6(host) ? 6 : net.isIPv4(host) ? 4 : 0;
  if (family !== 0 && !policy.allowAddress(host, family)) {
    throw new SafeFetchError("blocked", BLOCKED_MESSAGE);
  }
  return url;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | Error | null,
  address?: string | dns.LookupAddress[],
  family?: number,
) => void;

// Custom lookup passed to node:http(s): validates every resolved address
// against the policy at connect time, closing the DNS-rebinding gap.
function makeLookup(policy: FetchPolicy): typeof dns.lookup {
  const lookup = (
    hostname: string,
    options: dns.LookupOptions,
    callback: LookupCallback,
  ) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = addresses ?? [];
      if (list.length === 0) {
        return callback(new SafeFetchError("network", "DNS lookup returned no addresses."));
      }
      for (const entry of list) {
        if (!policy.allowAddress(entry.address, entry.family)) {
          return callback(new SafeFetchError("blocked", BLOCKED_MESSAGE));
        }
      }
      if (options.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
  return lookup as typeof dns.lookup;
}

function classifySocketError(err: Error): SafeFetchError {
  if (err instanceof SafeFetchError) return err;
  return new SafeFetchError("network", `Could not fetch this page (${err.message}).`);
}

interface HopResult {
  status?: number;
  headers?: http.IncomingHttpHeaders;
  body?: Buffer;
  redirectTo?: string;
}

function requestOnce(url: URL, policy: FetchPolicy, deadline: number): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const remaining = Math.max(1, deadline - Date.now());
    const req = transport.request(
      {
        hostname: bareHost(url),
        port: effectivePort(url),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        lookup: makeLookup(policy),
        headers: {
          "user-agent": "Shelfmark/1.0 (bookmark archiver)",
          accept: "text/html, application/xhtml+xml, text/plain",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (REDIRECT_STATUSES.has(status) && res.headers.location) {
          res.resume();
          resolve({ redirectTo: res.headers.location });
          return;
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > MAX_BYTES) {
          res.resume();
          reject(new SafeFetchError("too_large", "This page is too large to save (over 3 MB)."));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy(new SafeFetchError("too_large", "This page is too large to save (over 3 MB)."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          clearTimeout(killer);
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on("error", (err) => {
          clearTimeout(killer);
          reject(classifySocketError(err));
        });
      },
    );
    req.setTimeout(remaining);
    req.on("timeout", () => {
      req.destroy(new SafeFetchError("timeout", "Fetching this page timed out."));
    });
    req.on("error", (err) => {
      clearTimeout(killer);
      reject(classifySocketError(err));
    });
    const killer = setTimeout(() => {
      req.destroy(new SafeFetchError("timeout", "Fetching this page timed out."));
    }, remaining);
    req.end();
  });
}

function charsetFromHeader(header: string): string | null {
  const match = /charset\s*=\s*"?([a-zA-Z0-9._-]+)"?/i.exec(header);
  return match ? match[1] : null;
}

function sniffMetaCharset(buf: Buffer): string | null {
  const head = buf.subarray(0, 2048).toString("latin1");
  const match = /<meta[^>]+charset\s*=\s*["']?\s*([a-zA-Z0-9._-]+)/i.exec(head);
  return match ? match[1] : null;
}

// Honors the declared charset (header first, then a <meta charset> in the
// first 2 KB of HTML); anything unknown falls back to utf-8.
function decodeBody(buf: Buffer, contentTypeHeader: string, mime: string): string {
  const label =
    charsetFromHeader(contentTypeHeader) ??
    (mime === "text/html" || mime === "application/xhtml+xml" ? sniffMetaCharset(buf) : null) ??
    "utf-8";
  try {
    return new TextDecoder(label).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

export async function fetchWithPolicy(rawUrl: string, policy: FetchPolicy): Promise<SafeFetchResult> {
  const deadline = Date.now() + TIMEOUT_MS;
  let url = validateUrl(rawUrl, policy);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (Date.now() >= deadline) {
      throw new SafeFetchError("timeout", "Fetching this page timed out.");
    }
    const res = await requestOnce(url, policy, deadline);
    if (res.redirectTo !== undefined) {
      url = validateUrl(new URL(res.redirectTo, url).toString(), policy);
      continue;
    }
    const status = res.status ?? 0;
    if (status === 401 || status === 402 || status === 403) {
      throw new SafeFetchError("auth", AUTH_MESSAGE);
    }
    if (status === 429 || status >= 500) {
      throw new SafeFetchError("network", `The site returned an error (HTTP ${status}).`);
    }
    if (status < 200 || status >= 300) {
      throw new SafeFetchError("bad_protocol", `The site returned HTTP ${status}.`);
    }
    const contentTypeHeader = res.headers?.["content-type"] ?? "";
    const contentType = contentTypeHeader.split(";")[0].trim().toLowerCase();
    if (!ALLOWED_CONTENT.has(contentType)) {
      throw new SafeFetchError(
        "bad_content_type",
        `Unsupported content type "${contentType || "unknown"}". Only web pages and plain text can be saved.`,
      );
    }
    return {
      status,
      contentType,
      body: decodeBody(res.body ?? Buffer.alloc(0), contentTypeHeader, contentType),
      finalUrl: url.toString(),
    };
  }
  throw new SafeFetchError("too_many_redirects", "This page redirected too many times.");
}

export function safeFetch(url: string): Promise<SafeFetchResult> {
  return fetchWithPolicy(url, productionPolicy);
}
