import { describe, expect, it } from "vitest";
import { pathIndexToTileId } from "../../lib/board/geometry";
import { buildReplay, type MatchTranscript } from "../../lib/presentation/replay";
import type { MatchEventRow } from "../../lib/realtime/room-channel";

let seq = 0;
function ev(
  event_type: string,
  player_id: string | null,
  payload: Record<string, unknown>,
): MatchEventRow {
  seq += 1;
  return { id: seq, sequence: seq, event_type, player_id, payload, created_at: "" };
}

const seats = [
  { playerId: "p-red", seatIndex: 0, color: "red" as const, isBot: false, displayName: "Ada", avatarId: null },
  { playerId: "p-blue", seatIndex: 1, color: "blue" as const, isBot: false, displayName: "Bo", avatarId: null },
];

function ludoPawns() {
  return [0, 1, 2, 3].flatMap((i) => [
    { pawnId: `red-${i}`, playerId: "p-red", index: i },
    { pawnId: `blue-${i}`, playerId: "p-blue", index: i },
  ]);
}

describe("match replay reconstruction (F4.3)", () => {
  it("replays rolls, a capture and a finish, ending on the winner", () => {
    seq = 0;
    const transcript: MatchTranscript = {
      matchId: "m1",
      gameType: "ludo",
      rules: null,
      seats,
      pawns: ludoPawns(),
      endedAt: "2026-09-29T00:00:00Z",
      endReason: "completed",
      events: [
        ev("dice_rolled", "p-red", { dieValue: 6 }),
        ev("legal_move_selected", "p-red", {
          pawnId: "red-0",
          fromTileId: null,
          toTileId: pathIndexToTileId("red", 0),
          capturesPawnIds: [],
          finishesPawn: false,
        }),
        ev("legal_move_selected", "p-red", {
          pawnId: "red-0",
          fromTileId: pathIndexToTileId("red", 0),
          toTileId: pathIndexToTileId("red", 10),
          capturesPawnIds: ["blue-0"],
          finishesPawn: false,
        }),
        ev("legal_move_selected", "p-red", {
          pawnId: "red-1",
          fromTileId: pathIndexToTileId("red", 50),
          toTileId: pathIndexToTileId("red", 56),
          capturesPawnIds: [],
          finishesPawn: true,
        }),
        ev("match_completed", "p-red", { winnerId: "p-red" }),
      ],
    };

    const { steps, players } = buildReplay(transcript);
    expect(players.map((p) => p.displayName)).toEqual(["Ada", "Bo"]);

    expect(steps[0]).toMatchObject({ kind: "start", dice: null });
    expect(steps[0].pawns.every((p) => p.state === "nest")).toBe(true);

    const roll = steps.find((s) => s.kind === "roll");
    expect(roll?.dice).toBe(6);
    expect(roll?.caption).toBe("Ada rolled a 6");

    const capture = steps.find((s) => s.kind === "capture")!;
    expect(capture.highlight).toBe(true);
    expect(capture.pawns.find((p) => p.id === "blue-0")).toMatchObject({
      state: "nest",
      pathIndex: null,
    });
    expect(capture.pawns.find((p) => p.id === "red-0")?.pathIndex).toBe(10);

    const finish = steps.find((s) => s.kind === "finish")!;
    expect(finish.highlight).toBe(true);
    expect(finish.pawns.find((p) => p.id === "red-1")?.state).toBe("finished");

    const end = steps[steps.length - 1];
    expect(end.kind).toBe("end");
    expect(end.caption).toBe("Ada won the match");

    expect(steps.filter((s) => s.highlight)).toHaveLength(2);
  });

  it("treats a Snakes finish as one step and adds a close when none is logged", () => {
    seq = 0;
    const transcript: MatchTranscript = {
      matchId: "m2",
      gameType: "snakes_and_ladders",
      rules: null,
      seats,
      pawns: [
        { pawnId: "red-0", playerId: "p-red", index: 0 },
        { pawnId: "blue-0", playerId: "p-blue", index: 0 },
      ],
      endedAt: null,
      endReason: "abandoned",
      events: [
        ev("dice_rolled", "p-red", { dieValue: 3 }),
        ev("legal_move_selected", "p-red", {
          pawnId: "red-0",
          fromTileId: null,
          toTileId: "sq:97",
          capturesPawnIds: [],
          finishesPawn: false,
        }),
        ev("legal_move_selected", "p-red", {
          pawnId: "red-0",
          fromTileId: "sq:97",
          toTileId: "sq:100",
          capturesPawnIds: [],
          finishesPawn: true,
        }),
        // Snakes also reports finishing order; it must not double the finish step.
        ev("player_finished", "p-red", { place: 1 }),
      ],
    };

    const { steps } = buildReplay(transcript);
    expect(steps.filter((s) => s.kind === "finish")).toHaveLength(1);
    const finish = steps.find((s) => s.kind === "finish")!;
    expect(finish.caption).toBe("Ada reached 100");
    expect(finish.pawns.find((p) => p.id === "red-0")).toMatchObject({
      state: "finished",
      pathIndex: 100,
    });
    // No match_completed logged, so a closing step is synthesized.
    const end = steps[steps.length - 1];
    expect(end.kind).toBe("end");
    expect(end.caption).toBe("The match was abandoned");
  });

  it("skips a third-six roll's move and captions it", () => {
    seq = 0;
    const transcript: MatchTranscript = {
      matchId: "m3",
      gameType: "ludo",
      rules: null,
      seats,
      pawns: ludoPawns(),
      endedAt: null,
      endReason: "completed",
      events: [ev("dice_rolled", "p-red", { dieValue: 6, cancelledByThirdSix: true })],
    };
    const { steps } = buildReplay(transcript);
    const roll = steps.find((s) => s.kind === "roll")!;
    expect(roll.caption).toBe("Ada rolled a third six — turn skipped");
  });
});
