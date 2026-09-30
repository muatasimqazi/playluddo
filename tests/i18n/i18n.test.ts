import { describe, it, expect } from "vitest";
import {
  LOCALES,
  DEFAULT_LOCALE,
  matchLocale,
  resolveLocale,
  directionFor,
  isSupportedLocale,
  LOCALE_STORAGE_KEY,
} from "../../lib/i18n/locales";
import { getMessages, catalogs } from "../../lib/i18n/dictionaries";
import { detectLocale, persistLocale, applyDocumentLocale } from "../../lib/i18n/preferences";
import { interpolate, createTranslator } from "../../lib/i18n/translate";
import { en } from "../../lib/i18n/messages/en";

/** Collect every dotted string-leaf path in a nested catalog. */
function leafPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj === "string") return [prefix];
  if (obj && typeof obj === "object") {
    return Object.entries(obj).flatMap(([k, v]) =>
      leafPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [];
}

describe("locale matching", () => {
  it("matches exact and case-insensitive tags", () => {
    expect(matchLocale("en")).toBe("en");
    expect(matchLocale("AR")).toBe("ar");
    expect(matchLocale("PT-br")).toBe("pt-BR");
  });

  it("falls back from a region to its base language", () => {
    expect(matchLocale("hi-IN")).toBe("hi");
    expect(matchLocale("es-MX")).toBe("es");
    expect(matchLocale("ar-EG")).toBe("ar");
    // Any Portuguese variant maps to our launch variant, Brazilian.
    expect(matchLocale("pt")).toBe("pt-BR");
    expect(matchLocale("pt-PT")).toBe("pt-BR");
  });

  it("returns null for unsupported and empty tags", () => {
    expect(matchLocale("fr")).toBeNull();
    expect(matchLocale("")).toBeNull();
    expect(matchLocale(null)).toBeNull();
  });

  it("resolves the first supported candidate, else the default", () => {
    expect(resolveLocale(["fr", "de", "hi-IN"])).toBe("hi");
    expect(resolveLocale(["fr", "de"])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale([])).toBe(DEFAULT_LOCALE);
  });

  it("knows the writing direction of each locale", () => {
    expect(directionFor("en")).toBe("ltr");
    expect(directionFor("ar")).toBe("rtl");
    expect(directionFor("ur")).toBe("rtl");
    expect(directionFor("hi")).toBe("ltr");
  });
});

describe("interpolation", () => {
  it("fills named placeholders and leaves unknown ones intact", () => {
    expect(interpolate("You + {count}", { count: 3 })).toBe("You + 3");
    expect(interpolate("{a} and {b}", { a: "x" })).toBe("x and {b}");
    expect(interpolate("no slots")).toBe("no slots");
  });
});

describe("translator", () => {
  it("returns the English string and interpolates", () => {
    const t = createTranslator(getMessages("en"));
    expect(t("common.continue")).toBe("Continue");
    expect(t("entrance.youPlusN", { count: 2 })).toBe("You + 2");
  });

  it("returns a translated string for a supported locale", () => {
    const t = createTranslator(getMessages("es"));
    expect(t("common.continue")).toBe("Continuar");
  });

  it("falls back to English for keys a catalog omits", () => {
    // roomCodePlaceholder is identical across catalogs; pick a key we know
    // English defines and assert every locale resolves *something* non-empty.
    for (const { code } of LOCALES) {
      const t = createTranslator(getMessages(code));
      expect(t("common.continue").length).toBeGreaterThan(0);
      expect(t("entrance.chooseGame").length).toBeGreaterThan(0);
    }
  });

  it("returns the key itself when nothing matches anywhere", () => {
    const t = createTranslator(getMessages("en"));
    // @ts-expect-error — deliberately unknown key to prove the visible-gap behavior.
    expect(t("does.not.exist")).toBe("does.not.exist");
  });
});

describe("catalog integrity", () => {
  it("every merged catalog has exactly the English key set (no gaps, no drift)", () => {
    const expected = leafPaths(en).sort();
    for (const { code } of LOCALES) {
      const actual = leafPaths(getMessages(code)).sort();
      expect(actual, `locale ${code}`).toEqual(expected);
    }
  });

  it("unsupported/supported guards agree with the LOCALES table", () => {
    for (const { code } of LOCALES) expect(isSupportedLocale(code)).toBe(true);
    expect(isSupportedLocale("fr")).toBe(false);
  });
});


describe("complete source catalogs", () => {
  it("each source catalog, before lookup, has every English key", () => {
    const expected = leafPaths(en).sort();
    for (const { code } of LOCALES) {
      expect(leafPaths(catalogs[code]).sort(), code).toEqual(expected);
    }
  });

  it("supported locales never fall back to English for profile copy", () => {
    for (const { code } of LOCALES) {
      if (code === "en") continue;
      expect(catalogs[code].account.guestPrompt, code).not.toBe(en.account.guestPrompt);
      expect(catalogs[code].account.deleteBody, code).not.toBe(en.account.deleteBody);
      expect(catalogs[code].account.shareTeamText, code).not.toBe(en.account.shareTeamText);
    }
  });
});

describe("locale preferences", () => {
  it("prefers a saved choice over browser language and persists changes", () => {
    const values = new Map([[LOCALE_STORAGE_KEY, "ur"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    expect(detectLocale(storage, ["es-MX"])).toBe("ur");
    persistLocale("hi", storage);
    expect(values.get(LOCALE_STORAGE_KEY)).toBe("hi");
    expect(detectLocale(storage, ["es-MX"])).toBe("hi");
  });

  it("uses browser language when storage is unavailable or unsupported", () => {
    expect(detectLocale(undefined, ["fr", "bn-BD"])).toBe("bn");
    expect(detectLocale({ getItem: () => "fr", setItem: () => {} }, ["ar-EG"])).toBe("ar");
    expect(detectLocale({ getItem: () => { throw new Error("blocked"); }, setItem: () => {} }, ["id-ID"])).toBe("id");
  });

  it("applies language and writing direction to the root", () => {
    const root = { lang: "en", dir: "ltr" };
    applyDocumentLocale(root, "ur");
    expect(root).toEqual({ lang: "ur", dir: "rtl" });
    applyDocumentLocale(root, "es");
    expect(root).toEqual({ lang: "es", dir: "ltr" });
  });
});
