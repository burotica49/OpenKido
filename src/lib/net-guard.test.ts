import { beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.fn();
vi.mock("node:dns/promises", () => ({ default: { lookup: (...a: unknown[]) => lookup(...a) }, lookup: (...a: unknown[]) => lookup(...a) }));

import { UnsafeTargetError, isPublicAddress, normalizeHostname, pinnedRequest, resolvePublicTarget } from "./net-guard";

beforeEach(() => lookup.mockReset());

describe("normalizeHostname", () => {
  it("nettoie une URL complète", () => {
    expect(normalizeHostname("  HTTPS://Sub.Example.co.uk/path?x=1 ")).toBe("sub.example.co.uk");
    expect(normalizeHostname("example.com.")).toBe("example.com");
  });
  it.each(["localhost", "127.0.0.1", "10.0.0.1", "1.2.3.4", "foo.local", "svc.internal", "a@b.com", "example.com:8080", "[::1]", "-bad.com", "a..b.com", "exa mple.com", "", "a.b.c_d", `${"x".repeat(300)}.com`])(
    "refuse %j", (bad) => expect(() => normalizeHostname(bad)).toThrow(UnsafeTargetError));
});

describe("isPublicAddress", () => {
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "2a00:1450:4001::1", "::ffff:8.8.8.8"])("%s est publique", (ip) => expect(isPublicAddress(ip)).toBe(true));
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::ffff:10.0.0.1",
    "::127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::1", "not-an-ip",
  ])("%s est refusée", (ip) => expect(isPublicAddress(ip)).toBe(false));
});

describe("resolvePublicTarget", () => {
  it("refuse un nom public qui pointe vers du loopback (rebinding / localtest.me)", async () => {
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(resolvePublicTarget("localtest.me")).rejects.toThrow(UnsafeTargetError);
  });
  it("refuse si UNE SEULE des adresses est privée", async () => {
    lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    await expect(resolvePublicTarget("mixed.example.com")).rejects.toThrow(/non publique/);
  });
  it("accepte et renvoie l'IP validée", async () => {
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(resolvePublicTarget("example.com")).resolves.toEqual({ hostname: "example.com", address: "93.184.216.34", family: 4 });
  });
});

describe("pinnedRequest", () => {
  it.each(["ftp://example.com", "file:///etc/passwd", "http://example.com:8080", "http://user:pw@example.com", "gopher://example.com", "pas une url"])(
    "refuse %s avant toute résolution", async (url) => {
      await expect(pinnedRequest(url)).rejects.toThrow(UnsafeTargetError);
      expect(lookup).not.toHaveBeenCalled();
    });
  it("refuse une adresse IP littérale", async () => {
    await expect(pinnedRequest("http://127.0.0.1")).rejects.toThrow(UnsafeTargetError);
  });
});
