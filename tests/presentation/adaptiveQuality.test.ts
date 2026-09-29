import { describe, expect, it } from "vitest";
import { nextQuality } from "../../lib/hooks/useAdaptiveQuality";

describe("party screen quality", () => {
  it("steps up while the display keeps a smooth frame rate", () => {
    expect(nextQuality("low", 60, false)).toBe("medium");
    expect(nextQuality("medium", 58, false)).toBe("high");
  });
  it("stops at high, and stays put in between", () => {
    expect(nextQuality("high", 60, false)).toBeNull();
    expect(nextQuality("medium", 45, false)).toBeNull();
  });
  it("steps down when struggling, and never back up after that", () => {
    expect(nextQuality("high", 24, false)).toBe("medium");
    expect(nextQuality("medium", 60, true)).toBeNull();
  });
  it("has nowhere lower than low", () => {
    expect(nextQuality("low", 12, false)).toBeNull();
  });
});
