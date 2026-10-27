import http from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fetchWithPolicy,
  isBlockedAddress,
  safeFetch,
  SafeFetchError,
} from "@/lib/safe-fetch";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "172.16.5.5",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "8.8.8.8", // control: public address is allowed
  ])("checks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(address !== "8.8.8.8");
  });

  it.each([
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1", // WHATWG-normalized form of ::ffff:127.0.0.1
    "::ffff:a9fe:a9fe", // 169.254.169.254
    "2001::1", // Teredo
    "2002::1", // 6to4
    "fc00::1",
    "fe80::1",
    "ff02::1",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });
});

describe("URL validation (no network)", () => {
  it.each([
    "ftp://example.com/file",
    "file:///etc/passwd",
    "http://user:pass@example.com/",
    "http://example.com:8080/",
    "https://example.com:8080/",
  ])("rejects %s as bad_protocol", async (url) => {
    await expect(safeFetch(url)).rejects.toMatchObject({ code: "bad_protocol" });
  });

  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[2001::1]/",
    "http://[2002::1]/",
    "http://[fc00::1]/",
  ])("rejects %s as blocked", async (url) => {
    await expect(safeFetch(url)).rejects.toMatchObject({ code: "blocked" });
  });
});

describe("fetchWithPolicy against a local server", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
        res.end();
        return;
      }
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("x".repeat(3 * 1024 * 1024 + 10));
        return;
      }
      if (req.url === "/pdf") {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end("%PDF-1.4 fake");
        return;
      }
      if (req.url === "/latin") {
        res.writeHead(200, { "content-type": "text/html; charset=windows-1252" });
        // 0x93/0x94 are curly double quotes in windows-1252
        res.end(Buffer.from("<html><body>\x93hello\x94", "latin1"));
        return;
      }
      if (req.url === "/meta-charset") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          Buffer.from(
            '<html><head><meta charset="windows-1252"></head><body>\x93hello\x94',
            "latin1",
          ),
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><title>t</title><body>hello</body></html>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const policy = () => ({
    allowAddress: (address: string) => address === "127.0.0.1" || !isBlockedAddress(address),
    allowedPorts: new Set([80, 443, port]),
  });

  it("fetches a normal page", async () => {
    const res = await fetchWithPolicy(`http://127.0.0.1:${port}/`, policy());
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("text/html");
    expect(res.body).toContain("hello");
  });

  it("rejects a redirect hop to a blocked address", async () => {
    await expect(
      fetchWithPolicy(`http://127.0.0.1:${port}/redirect`, policy()),
    ).rejects.toMatchObject({ code: "blocked" });
  });

  it("rejects bodies over the 3 MB cap", async () => {
    await expect(
      fetchWithPolicy(`http://127.0.0.1:${port}/big`, policy()),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("rejects non-text content types", async () => {
    await expect(
      fetchWithPolicy(`http://127.0.0.1:${port}/pdf`, policy()),
    ).rejects.toMatchObject({ code: "bad_content_type" });
  });

  it("decodes the body with the header charset", async () => {
    const res = await fetchWithPolicy(`http://127.0.0.1:${port}/latin`, policy());
    expect(res.body).toContain("\u201chello\u201d");
  });

  it("honors a meta charset when the header omits one", async () => {
    const res = await fetchWithPolicy(`http://127.0.0.1:${port}/meta-charset`, policy());
    expect(res.body).toContain("\u201chello\u201d");
  });

  it("SafeFetchError carries the permanent flag", () => {
    expect(new SafeFetchError("blocked", "x").permanent).toBe(true);
    expect(new SafeFetchError("network", "x").permanent).toBe(false);
  });
});
