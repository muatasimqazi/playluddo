import { afterEach, expect, it, vi } from "vitest";
import { randomDie } from "../../lib/presentation/practice";

// Offline rolls mirror the server's private.roll_die(): bytes 252-255 are
// redrawn so the 252 accepted bytes map to exactly 42 per face.

afterEach(() => vi.restoreAllMocks());

function feedBytes(bytes: number[]) {
  const queue = [...bytes];
  return vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    const next = queue.shift();
    if (next === undefined) throw new Error("ran out of test bytes");
    (array as Uint8Array)[0] = next;
    return array;
  });
}

it("maps the 252 accepted bytes to exactly 42 per face", () => {
  const counts = new Map<number, number>();
  for (let byte = 0; byte < 252; byte++) {
    feedBytes([byte]);
    const face = randomDie();
    counts.set(face, (counts.get(face) ?? 0) + 1);
    vi.restoreAllMocks();
  }
  expect([...counts.entries()].sort(([a], [b]) => a - b)).toEqual([
    [1, 42],
    [2, 42],
    [3, 42],
    [4, 42],
    [5, 42],
    [6, 42],
  ]);
});

it("redraws rejected bytes 252-255 instead of mapping them", () => {
  const spy = feedBytes([252, 253, 254, 255, 5]);
  expect(randomDie()).toBe(6);
  expect(spy).toHaveBeenCalledTimes(5);
});
