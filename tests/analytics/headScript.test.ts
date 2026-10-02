import { parse } from "acorn";
import { describe, expect, it, vi } from "vitest";
import { analyticsHeadScript, gtmLoaderScript } from "../../lib/analytics/headScript";
import { MemoryStorage } from "./fakeBrowser";

const GA = "G-75GZQ69MCG";

interface HeadWindow {
  dataLayer?: unknown[];
  localStorage: MemoryStorage;
  location: { hostname: string; search: string };
  __luddoTagsOn?: boolean;
  __luddoDebug?: boolean;
  __luddoGaId?: string;
  [key: string]: unknown;
}

/** Runs the inline script against a stand-in window, as the browser would. */
function runHead(hostname: string, search = "", flags: Record<string, string> = {}): HeadWindow {
  const storage = new MemoryStorage();
  for (const [key, value] of Object.entries(flags)) storage.setItem(key, value);
  const w: HeadWindow = { localStorage: storage, location: { hostname, search } };
  new Function("window", analyticsHeadScript(GA))(w);
  return w;
}

function consentCommands(w: HeadWindow) {
  return (w.dataLayer ?? [])
    .map((entry) => Array.from(entry as ArrayLike<unknown>))
    .filter((args) => args[0] === "consent");
}

describe("the head script", () => {
  it("is ES5, for Chromium 79 TVs", () => {
    expect(() => parse(analyticsHeadScript(GA), { ecmaVersion: 5 })).not.toThrow();
    expect(() => parse(gtmLoaderScript("GTM-N7X49V9F"), { ecmaVersion: 5 })).not.toThrow();
  });

  it("turns Tag Manager on for luddohouse.com with Consent Mode defaults", () => {
    for (const host of ["luddohouse.com", "www.luddohouse.com"]) {
      const w = runHead(host);
      expect(w.__luddoTagsOn).toBe(true);
      expect(w.__luddoDebug).toBe(false);
      expect(w.__luddoGaId).toBe(GA);
      const [regional, general] = consentCommands(w);
      expect(regional[1]).toBe("default");
      expect(regional[2]).toMatchObject({ analytics_storage: "denied", ad_storage: "denied" });
      expect((regional[2] as { region: string[] }).region).toEqual(expect.arrayContaining(["DE", "FR", "GB", "CH", "NO"]));
      expect(general[2]).toMatchObject({
        analytics_storage: "granted",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
    }
  });

  it("stays off on preview deployments, other subdomains, localhost and look-alike hosts", () => {
    for (const host of ["playluddo-git-x-qcreatives.vercel.app", "localhost", "luddohouse.com.example.net", "staging.luddohouse.com"]) {
      const w = runHead(host);
      expect(w.__luddoTagsOn).toBe(false);
      expect(consentCommands(w)).toHaveLength(0);
    }
  });

  it("turns on for GTM Preview or the debug flag, marked as debug", () => {
    expect(runHead("localhost", "?gtm_debug=123").__luddoDebug).toBe(true);
    const flagged = runHead("localhost", "", { "luddo-analytics-debug": "1" });
    expect(flagged.__luddoTagsOn).toBe(true);
    expect(flagged.__luddoDebug).toBe(true);
  });

  it("disables Google Analytics on a device with an under-13 flag", () => {
    for (const key of ["luddo-under-13-until", "luddo-analytics-off-until"]) {
      const w = runHead("www.luddohouse.com", "?gtm_debug=1", { [key]: "2099-01-01" });
      expect(w[`ga-disable-${GA}`]).toBe(true);
      expect(w.__luddoTagsOn).toBe(false);
      expect(consentCommands(w)).toHaveLength(0);
    }
  });

  it("lets an expired flag lapse", () => {
    const w = runHead("www.luddohouse.com", "", { "luddo-under-13-until": "2001-01-01" });
    expect(w.__luddoTagsOn).toBe(true);
  });

  it("survives storage that throws", () => {
    const w: HeadWindow = {
      localStorage: {
        getItem() {
          throw new Error("blocked");
        },
      } as unknown as MemoryStorage,
      location: { hostname: "www.luddohouse.com", search: "" },
    };
    new Function("window", analyticsHeadScript(GA))(w);
    expect(w.__luddoTagsOn).toBe(true);
  });
});

describe("the Tag Manager loader", () => {
  function runLoader(tagsOn: boolean) {
    const insertBefore = vi.fn();
    const document = {
      getElementsByTagName: () => [{ parentNode: { insertBefore } }],
      createElement: () => ({}) as { src?: string },
    };
    const window = { __luddoTagsOn: tagsOn, dataLayer: [] as unknown[] };
    new Function("window", "document", gtmLoaderScript("GTM-N7X49V9F"))(window, document);
    return { insertBefore, window };
  }

  it("loads the container only when the head script allowed it", () => {
    const on = runLoader(true);
    expect(on.insertBefore).toHaveBeenCalledTimes(1);
    expect((on.insertBefore.mock.calls[0][0] as { src: string }).src).toBe(
      "https://www.googletagmanager.com/gtm.js?id=GTM-N7X49V9F",
    );
    const off = runLoader(false);
    expect(off.insertBefore).not.toHaveBeenCalled();
    expect(off.window.dataLayer).toEqual([]);
  });
});
