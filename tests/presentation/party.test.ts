import { describe, expect, it } from "vitest";
import { describeMoment, picksFor, topMoment } from "../../lib/presentation/party";
import type { PartyMoment } from "../../lib/supabase/rpc";

const players = [
  { id: "t", displayName: "Theo" },
  { id: "n", displayName: "Nia" },
  { id: "s", displayName: "Sam" },
];

function moment(extra: Partial<PartyMoment>): PartyMoment {
  return { sequence: 1, playerId: "t", kind: "capture", place: null, capturedPlayerIds: [], from: null, to: null, ...extra };
}

describe("moments of the match", () => {
  it("describes captures, finishes, ladders and snakes", () => {
    expect(describeMoment(moment({ capturedPlayerIds: ["n"] }), players)).toBe("Theo captured Nia's piece");
    expect(describeMoment(moment({ capturedPlayerIds: ["n", "s"] }), players)).toBe("Theo captured pieces from Nia and Sam");
    expect(describeMoment(moment({}), players)).toBe("Theo captured a piece");
    expect(describeMoment(moment({ kind: "finished", place: 1 }), players)).toBe("Theo won");
    expect(describeMoment(moment({ kind: "finished", place: 2 }), players)).toBe("Theo finished 2nd");
    expect(describeMoment(moment({ kind: "finished", place: 3 }), players)).toBe("Theo finished 3rd");
    expect(describeMoment(moment({ kind: "ladder", from: 28, to: 54 }), players)).toBe("Theo climbed a ladder from 28 to 54");
    expect(describeMoment(moment({ kind: "snake", from: 98, to: 38 }), players)).toBe("Theo slid down a snake from 98 to 38");
  });
  it("names someone who has left as someone", () => {
    expect(describeMoment(moment({ playerId: "gone", kind: "finished", place: 1 }), players)).toBe("Someone won");
  });
  it("picks the most-voted moment, the later one on a tie", () => {
    const moments = [moment({ sequence: 4 }), moment({ sequence: 9 }), moment({ sequence: 12 })];
    expect(topMoment({ moments, votes: [] })).toBeNull();
    expect(topMoment({ moments, votes: [{ sequence: 4, count: 2 }, { sequence: 9, count: 1 }] })).toEqual({
      moment: moments[0],
      votes: 2,
    });
    expect(topMoment({ moments, votes: [{ sequence: 4, count: 2 }, { sequence: 12, count: 2 }] })?.moment).toBe(moments[2]);
  });
});

describe("the lobby's picks", () => {
  it("counts picks per player", () => {
    const extras = { predictions: [{ playerId: "t", count: 3 }] };
    expect(picksFor(extras, "t")).toBe(3);
    expect(picksFor(extras, "n")).toBe(0);
  });
});
