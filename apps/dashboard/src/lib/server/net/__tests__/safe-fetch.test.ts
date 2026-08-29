import { describe, it, expect } from "vitest";
import { isBlockedAddress, safeFetch, SsrfBlockedError } from "../safe-fetch";

// No-network tests: every case here is rejected before fetch() is ever
// reached (bad scheme, blocked port, or literal private/loopback/IMDS IP).
// isBlockedAddress is pure and covers the IP-range matrix directly.

describe("isBlockedAddress", () => {
  it("blocks IPv4 loopback, RFC1918, link-local/IMDS, CGNAT, 0.0.0.0, multicast", () => {
    for (const ip of [
      "127.0.0.1",
      "127.255.255.255",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud IMDS
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1", // multicast
      "255.255.255.255",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("allows ordinary public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "192.169.0.1", "100.63.0.1", "100.128.0.1"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("blocks IPv6 loopback, unspecified, link-local, unique-local, IPv4-mapped private", () => {
    for (const ip of [
      "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1",
      "::ffff:10.0.0.1", "::ffff:169.254.169.254",
      "[::1]", // bracketed literal (URL.hostname shape) must still be gated
      "::ffff:a9fe:a9fe", // hex-compressed IPv4-mapped IMDS (== ::ffff:169.254.169.254)
      "::ffff:7f00:1", // hex-compressed IPv4-mapped loopback (== ::ffff:127.0.0.1)
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("allows public IPv6 and public IPv4-mapped (dotted and hex)", () => {
    for (const ip of ["2606:4700:4700::1111", "::ffff:8.8.8.8", "::ffff:0808:0808" /* hex 8.8.8.8 */]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });
});

describe("safeFetch", () => {
  it("rejects non-http(s) schemes", async () => {
    for (const url of ["file:///etc/passwd", "gopher://x", "data:text/plain,hi", "ftp://host/x"]) {
      await expect(safeFetch(url)).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  it("rejects malformed URLs", async () => {
    await expect(safeFetch("not a url")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("rejects internal-service ports regardless of host", async () => {
    for (const url of [
      "http://example.com:8123/", // ClickHouse HTTP
      "http://example.com:9000/", // ClickHouse native
      "http://example.com:5432/", // PostgreSQL
      "http://example.com:6379/", // Redis
    ]) {
      await expect(safeFetch(url)).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  it("rejects literal private / loopback / IMDS hosts", async () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[::ffff:a9fe:a9fe]/latest/meta-data/", // hex-mapped IMDS, bracketed
    ]) {
      await expect(safeFetch(url)).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });
});

// Launch hardening G3 (2026-08-24): assertSafeUrl is the create-time
// validation surface. Known-bad fixtures first, per the guard discipline.
import { assertSafeUrl } from "../safe-fetch";

describe("assertSafeUrl (create-time webhook validation)", () => {
  it("rejects the classics without fetching", async () => {
    for (const bad of [
      "not a url",
      "file:///etc/passwd",
      "gopher://x/",
      "http://127.0.0.1/hook",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/hook",
      "http://10.1.2.3/hook",
      "http://192.168.1.1/hook",
      "http://example.com:6379/hook",
      "http://example.com:5432/hook",
    ]) {
      await expect(assertSafeUrl(bad), bad).rejects.toThrow(SsrfBlockedError);
    }
  });
  it("accepts a public https URL", async () => {
    const url = await assertSafeUrl("https://example.com/webhook");
    expect(url.hostname).toBe("example.com");
  });
});
