import { describe, expect, it } from "vitest";
import { MAX_PARAMETERS, MAX_STRING_LENGTH, sanitize } from "../../lib/analytics/sanitize";
import { redactReferrer, redactUrl } from "../../lib/analytics/redact";

describe("sanitize", () => {
  it("keeps flat strings, finite numbers and booleans only", () => {
    expect(
      sanitize({
        game_type: "luddo",
        seat_count: 4,
        won: false,
        empty: "",
        missing: undefined,
        nothing: null,
        nan: Number.NaN,
        infinite: Number.POSITIVE_INFINITY,
        nested: { a: 1 },
        list: [1, 2],
      }),
    ).toEqual({ game_type: "luddo", seat_count: 4, won: false });
  });

  it("caps strings at GA4's 100 characters", () => {
    const clean = sanitize({ page_title: "x".repeat(300) });
    expect((clean.page_title as string).length).toBe(MAX_STRING_LENGTH);
  });

  it("caps the number of parameters", () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, i]));
    expect(Object.keys(sanitize(many))).toHaveLength(MAX_PARAMETERS);
  });

  it("returns an empty object for nothing", () => {
    expect(sanitize(undefined)).toEqual({});
  });
});

describe("redactUrl", () => {
  const base = "https://www.luddohouse.com";

  it("drops room ids, room codes and cast tokens", () => {
    expect(redactUrl(`${base}/room?id=4f1c2d3e-aaaa-bbbb-cccc-123456789abc`)).toBe(`${base}/room`);
    expect(redactUrl(`${base}/watch?room=4f1c2d3e&cast=secret`)).toBe(`${base}/watch`);
    expect(redactUrl(`${base}/screen?id=4f1c&cast=token`)).toBe(`${base}/screen`);
    expect(redactUrl(`${base}/join?code=ABCD12`)).toBe(`${base}/join`);
  });

  it("drops team invites, OAuth codes and errors, and the fragment", () => {
    expect(redactUrl(`${base}/?team=TEAM42`)).toBe(`${base}/`);
    expect(redactUrl(`${base}/?code=oauth&error_description=bad#access_token=t`)).toBe(`${base}/`);
    expect(redactUrl(`${base}/replay?match=abc&sb_flow_id=1`)).toBe(`${base}/replay`);
  });

  it("keeps the entrance step and campaign tags", () => {
    expect(redactUrl(`${base}/?play=friends&utm_source=reddit&utm_medium=social&id=x`)).toBe(
      `${base}/?play=friends&utm_source=reddit&utm_medium=social`,
    );
    expect(redactUrl(`${base}/?ref=producthunt`)).toBe(`${base}/?ref=producthunt`);
  });

  it("resolves a path against a base", () => {
    expect(redactUrl("/room?id=abc", `${base}/`)).toBe(`${base}/room`);
  });

  it("returns empty for anything that is not a URL", () => {
    expect(redactUrl("not a url")).toBe("");
  });
});

describe("redactReferrer", () => {
  const origin = "https://www.luddohouse.com";

  it("cleans this site's own referrer", () => {
    expect(redactReferrer(`${origin}/room?id=abc`, origin)).toBe(`${origin}/room`);
  });

  it("keeps only another site's origin", () => {
    expect(redactReferrer("https://mail.example.com/inbox/123?q=luddo", origin)).toBe("https://mail.example.com/");
  });

  it("returns empty for no referrer or a bad one", () => {
    expect(redactReferrer("", origin)).toBe("");
    expect(redactReferrer("::", origin)).toBe("");
    expect(redactReferrer("android-app://com.example/", origin)).toBe("");
  });
});
