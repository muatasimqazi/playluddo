import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { webglAvailable } from "../../lib/analytics/webgl";

function fakeDocument(contexts: Record<string, unknown>) {
  const getContext = vi.fn((kind: string) => contexts[kind] ?? null);
  return { doc: { createElement: () => ({ getContext }) } as unknown as Document, getContext };
}

describe("webglAvailable", () => {
  it("is true with WebGL 2, and hands the probe's context back", () => {
    const loseContext = vi.fn();
    const { doc } = fakeDocument({ webgl2: { getExtension: () => ({ loseContext }) } });
    expect(webglAvailable(doc)).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("falls back to WebGL 1", () => {
    const { doc, getContext } = fakeDocument({ webgl: { getExtension: () => null } });
    expect(webglAvailable(doc)).toBe(true);
    expect(getContext.mock.calls.map(([kind]) => kind)).toEqual(["webgl2", "webgl"]);
  });

  it("is false with no context, or when the browser throws", () => {
    expect(webglAvailable(fakeDocument({}).doc)).toBe(false);
    const throwing = {
      createElement: () => {
        throw new Error("blocked");
      },
    } as unknown as Document;
    expect(webglAvailable(throwing)).toBe(false);
  });
});

describe("the 3D table's error reports", () => {
  const scene = readFileSync(new URL("../../components/simulator/SimulatorScene.tsx", import.meta.url), "utf8");

  it("keeps analytics out of the Canvas fallback, which mounts on every browser", () => {
    const fallback = scene.match(/fallback=\{\s*<div className="sim-fallback">([\s\S]*?)<\/div>/)?.[1];
    expect(fallback).toBeDefined();
    expect(fallback).not.toMatch(/track|Report/);
  });

  it("listens for a lost context from inside the Canvas, not from onCreated", () => {
    expect(scene).toMatch(/<Canvas[\s\S]*?>\s*<ReportContextLoss \/>/);
    expect(scene).not.toMatch(/webglcontextlost/);
  });
});
