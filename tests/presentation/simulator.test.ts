import { afterEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { cameraFraming } from "../../lib/presentation/camera";
import {
  BOARD_Y,
  BOARD_SIZE,
  HOME_ROTATION,
  moveWaypoints,
  pawnPoint,
  shortestAngle,
} from "../../lib/presentation/board";
import {
  createPractice,
  practiceReducer,
} from "../../lib/presentation/practice";
import { PresentationTimeline } from "../../lib/presentation/timeline";
import { deriveStateFromPathIndex } from "../../lib/board/geometry";
import type { Pawn, PlayerColor } from "../../lib/board/types";

function pawn(color: PlayerColor, pathIndex: number | null, index = 0): Pawn {
  return {
    id: `${color}-${index}`,
    color,
    index,
    pathIndex,
    state: deriveStateFromPathIndex(pathIndex),
  };
}
afterEach(() => vi.useRealTimers());

describe("responsive camera framing", () => {
  it("keeps the board inside all three main views on phones and desktops", () => {
    for (const aspect of [390 / 844, 393 / 852, 768 / 1024, 1440 / 900]) {
      for (const view of ["play", "overhead", "table"] as const) {
        const { eye, target, fov } = cameraFraming(view, aspect);
        const camera = new PerspectiveCamera(fov, aspect, 0.1, 120);
        camera.position.set(...eye);
        camera.lookAt(...target);
        camera.updateMatrixWorld();
        for (const x of [-3.18, 3.18]) {
          for (const z of [-3.18, 3.18]) {
            const projected = new Vector3(x, BOARD_Y, z).project(camera);
            expect(
              Math.abs(projected.x),
              `${view} at aspect ${aspect}`,
            ).toBeLessThan(1);
            expect(
              Math.abs(projected.y),
              `${view} at aspect ${aspect}`,
            ).toBeLessThan(1);
          }
        }
        const dieEdge = new Vector3(3.9, 0.5, 1.35).project(camera);
        expect(
          Math.abs(dieEdge.x),
          `die in ${view} at aspect ${aspect}`,
        ).toBeLessThan(1);
        expect(eye[1]).toBeLessThan(14.3);
        expect(Math.abs(eye[0])).toBeLessThan(13.3);
        expect(Math.abs(eye[2])).toBeLessThan(13.5);
      }
    }
  });
});

describe("logical positions independent of the view", () => {
  it("traverses every cell across the shared-track and home-lane boundary", () => {
    for (const color of ["red", "green", "yellow", "blue"] as const) {
      const path = moveWaypoints(pawn(color, 48), pawn(color, 54));
      expect(path).toHaveLength(6);
      path.forEach((point, i) =>
        expect(point).toEqual(pawnPoint(pawn(color, 49 + i))),
      );
      expect(path.every((p) => p[1] === BOARD_Y)).toBe(true);
    }
  });
  it("touches the center goal then moves a finisher beside its base", () => {
    const finish = moveWaypoints(pawn("red", 55), pawn("red", 56));
    expect(finish).toHaveLength(2);
    expect(finish[0]).toEqual([-0.34, BOARD_Y, 0]);
    expect(finish[1]).toEqual(pawnPoint(pawn("red", 56)));
    expect(Math.abs(finish[1][0])).toBeGreaterThan(BOARD_SIZE / 2);
    expect(moveWaypoints(pawn("green", 18), pawn("green", null))).toEqual([
      pawnPoint(pawn("green", null)),
    ]);
  });
  it("gives all four finished discs separate tabletop slots", () => {
    for (const color of ["red", "green", "yellow", "blue"] as const) {
      const slots = Array.from({ length: 4 }, (_, index) =>
        pawnPoint(pawn(color, 56, index)),
      );
      expect(new Set(slots.map(([x, , z]) => `${x}:${z}`)).size).toBe(4);
      expect(slots.every(([x, , z]) => Math.abs(x) > 3 || Math.abs(z) > 3)).toBe(
        true,
      );
    }
  });
  it("all four local orientations put that color's home lane at the near edge", () => {
    for (const color of ["red", "green", "yellow", "blue"] as const) {
      const [x, , z] = pawnPoint(pawn(color, 51));
      const angle = HOME_ROTATION[color];
      expect(-x * Math.sin(angle) + z * Math.cos(angle)).toBeGreaterThan(2);
    }
  });
  it("quarter-turn transitions take the shortest route across zero", () => {
    expect(shortestAngle(Math.PI * 1.5, 0)).toBeCloseTo(Math.PI / 2);
    expect(shortestAngle(0, Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
  });
});

describe("event playback and replay isolation", () => {
  it("plays a no-move roll even when the snapshot already advanced the turn", () => {
    vi.useFakeTimers();
    const session = createPractice(),
      timeline = new PresentationTimeline(session.state);
    const next = practiceReducer(session, { type: "roll", value: 3 });
    expect(next.state.activeDiceValue).toBeNull();
    timeline.receive(next.events, next.state);
    expect(timeline.getSnapshot()).toMatchObject({
      dice: 3,
      actorId: "practice-0",
      busy: true,
      phase: "roll",
    });
    vi.runAllTimers();
    expect(timeline.getSnapshot().busy).toBe(false);
    timeline.dispose();
  });
  it("deduplicates events and queues movement behind the dice animation", () => {
    vi.useFakeTimers();
    const initial = createPractice(),
      timeline = new PresentationTimeline(initial.state);
    const roll = practiceReducer(initial, { type: "roll", value: 6 });
    const move = practiceReducer(roll, { type: "move", pawnId: "blue-0" });
    timeline.receive(move.events, move.state);
    timeline.receive(move.events, move.state);
    expect(timeline.getSnapshot().pawns[0].pathIndex).toBeNull();
    expect(timeline.getSnapshot().rollId).toBe(1);
    vi.advanceTimersByTime(1180);
    expect(timeline.getSnapshot().phase).toBe("move");
    expect(timeline.getSnapshot().pawns[0].pathIndex).toBe(0);
    vi.runAllTimers();
    expect(timeline.getSnapshot().busy).toBe(false);
    timeline.dispose();
  });
  it("replays the prior roll and movement without mutating authoritative state", () => {
    vi.useFakeTimers();
    const initial = createPractice(),
      timeline = new PresentationTimeline(initial.state);
    const move = practiceReducer(
      practiceReducer(initial, { type: "roll", value: 6 }),
      { type: "move", pawnId: "blue-0" },
    );
    const serialized = JSON.stringify(move.state);
    timeline.receive(move.events, move.state);
    vi.runAllTimers();
    timeline.replay();
    expect(timeline.getSnapshot().replaying).toBe(true);
    expect(timeline.getSnapshot().pawns[0].pathIndex).toBeNull();
    vi.runAllTimers();
    expect(timeline.getSnapshot().pawns).toEqual(move.state.pawns);
    expect(timeline.getSnapshot().replaying).toBe(false);
    expect(JSON.stringify(move.state)).toBe(serialized);
    timeline.dispose();
  });
  it("keeps live events received during a replay and plays them after returning", () => {
    vi.useFakeTimers();
    const initial = createPractice(),
      timeline = new PresentationTimeline(initial.state);
    const move = practiceReducer(
      practiceReducer(initial, { type: "roll", value: 6 }),
      { type: "move", pawnId: "blue-0" },
    );
    timeline.receive(move.events, move.state);
    vi.runAllTimers();
    timeline.replay();
    const next = practiceReducer(move, { type: "roll", value: 4 });
    timeline.receive(next.events, next.state);
    vi.runAllTimers();
    expect(timeline.getSnapshot()).toMatchObject({
      dice: 4,
      busy: false,
      replaying: false,
    });
    timeline.dispose();
  });
  it("joins a current snapshot without playing historical actions", () => {
    const rolled = practiceReducer(createPractice(), {
      type: "roll",
      value: 6,
    });
    const timeline = new PresentationTimeline(rolled.state);
    timeline.receive(rolled.events, rolled.state);
    expect(timeline.getSnapshot()).toMatchObject({
      rollId: 0,
      busy: false,
      dice: 6,
    });
    timeline.dispose();
  });
  it("rejoining cancels an in-flight animation and ignores old event history", () => {
    vi.useFakeTimers();
    const initial = createPractice();
    const timeline = new PresentationTimeline(initial.state);
    const roll = practiceReducer(initial, { type: "roll", value: 6 });
    timeline.receive(roll.events, roll.state);
    expect(timeline.getSnapshot().busy).toBe(true);
    const move = practiceReducer(roll, { type: "move", pawnId: "blue-0" });
    timeline.reconcileSnapshot(move.state);
    timeline.receive(move.events, move.state);
    vi.runAllTimers();
    expect(timeline.getSnapshot()).toMatchObject({
      pawns: move.state.pawns,
      actorId: null,
      busy: false,
      phase: "idle",
      canReplay: false,
    });
    timeline.dispose();
  });
  it("snaps to the authoritative snapshot if the event history has a gap", () => {
    const initial = createPractice(),
      timeline = new PresentationTimeline(initial.state);
    const move = practiceReducer(
      practiceReducer(initial, { type: "roll", value: 6 }),
      { type: "move", pawnId: "blue-0" },
    );
    timeline.receive(move.events.slice(1), move.state);
    expect(timeline.getSnapshot().pawns).toEqual(move.state.pawns);
    expect(timeline.getSnapshot().revision).toBe(1);
    timeline.dispose();
  });
  it("recovers if event reads fail but authoritative snapshots arrive", () => {
    vi.useFakeTimers();
    const initial = createPractice(),
      timeline = new PresentationTimeline(initial.state);
    const move = practiceReducer(
      practiceReducer(initial, { type: "roll", value: 6 }),
      { type: "move", pawnId: "blue-0" },
    );
    timeline.receive([], move.state);
    vi.advanceTimersByTime(4501);
    expect(timeline.getSnapshot().pawns).toEqual(move.state.pawns);
    timeline.dispose();
  });
});

describe("offline practice uses the established rules", () => {
  it("lets the last unfinished Luddo player keep rolling", () => {
    const initial = createPractice();
    initial.state.winnerIds = ["practice-1", "practice-2", "practice-3"];
    initial.state.pawns = initial.state.pawns.map((piece) =>
      piece.color === "blue"
        ? piece
        : { ...piece, state: "finished", pathIndex: 56 },
    );
    const next = practiceReducer(initial, { type: "roll", value: 3 });
    expect(next.state.turnPlayerId).toBe("practice-0");
    expect(next.state.turnPhase).toBe("awaiting_roll");
    expect(next.state.activeDiceValue).toBeNull();
  });
  it("needs six to leave the nest, grants a bonus roll, and rejects illegal intents", () => {
    const initial = createPractice();
    expect(practiceReducer(initial, { type: "move", pawnId: "blue-0" })).toBe(
      initial,
    );
    const noMove = practiceReducer(initial, { type: "roll", value: 5 });
    expect(noMove.state.turnPlayerId).toBe("practice-1");
    const six = practiceReducer(initial, { type: "roll", value: 6 });
    expect(six.state.legalMoves).toHaveLength(4);
    expect(practiceReducer(six, { type: "move", pawnId: "red-0" })).toBe(six);
    const moved = practiceReducer(six, { type: "move", pawnId: "blue-0" });
    expect(moved.state.turnPlayerId).toBe("practice-0");
    expect(moved.state.pawns[0].pathIndex).toBe(0);
  });
  it("cancels the third six without moving a piece", () => {
    let game = createPractice();
    for (let i = 0; i < 2; i++) {
      game = practiceReducer(game, { type: "roll", value: 6 });
      game = practiceReducer(game, { type: "move", pawnId: "blue-0" });
    }
    const before = game.state.pawns;
    game = practiceReducer(game, { type: "roll", value: 6 });
    expect(game.state.turnPlayerId).toBe("practice-1");
    expect(game.state.pawns).toBe(before);
    expect(game.events.at(-1)?.payload.cancelledByThirdSix).toBe(true);
  });
  it("records the first finisher and continues with the next color", () => {
    const initial = createPractice();
    const ready = {
      ...initial,
      state: {
        ...initial.state,
        turnPhase: "awaiting_move" as const,
        activeDiceValue: 1,
        legalMoves: [
          {
            pawnId: "blue-3",
            fromTileId: "home:blue:4",
            toTileId: "home:blue:5",
            capturesPawnIds: [],
            finishesPawn: true,
          },
        ],
        pawns: initial.state.pawns.map((piece) =>
          piece.color === "blue"
            ? piece.index === 3
              ? { ...piece, state: "home_lane" as const, pathIndex: 55 }
              : { ...piece, state: "finished" as const, pathIndex: 56 }
            : piece,
        ),
      },
    };

    const continued = practiceReducer(ready, { type: "move", pawnId: "blue-3" });
    expect(continued.state.status).toBe("in_game");
    expect(continued.state.winnerIds).toEqual(["practice-0"]);
    expect(continued.state.turnPlayerId).toBe("practice-1");
    expect(continued.state.turnPhase).toBe("awaiting_roll");
  });
});
