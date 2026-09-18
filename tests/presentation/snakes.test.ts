import { afterEach, expect, it, vi } from "vitest";
import {
  applySnakeMove,
  LADDERS,
  SNAKES,
  snakeMove,
} from "../../lib/board/snakes";
import {
  createPractice,
  practiceReducer,
} from "../../lib/presentation/practice";
import {
  BOARD_Y,
  moveWaypoints,
  movementDuration,
  snakeSquarePoint,
} from "../../lib/presentation/board";
import { PresentationTimeline } from "../../lib/presentation/timeline";

afterEach(() => vi.useRealTimers());

it("maps all 100 printed squares in alternating rows without overlaps", () => {
  const squares = Array.from({ length: 100 }, (_, i) =>
    snakeSquarePoint(i + 1),
  );
  expect(new Set(squares.map(String)).size).toBe(100);
  for (const [index, point] of [
    [0, [-2.7, BOARD_Y, 2.7]],
    [9, [2.7, BOARD_Y, 2.7]],
    [10, [2.7, BOARD_Y, 2.1]],
    [99, [-2.7, BOARD_Y, -2.7]],
  ] as const)
    point.forEach((value, axis) =>
      expect(squares[index][axis]).toBeCloseTo(value),
    );
});

it.each(Object.entries({ ...LADDERS, ...SNAKES }))(
  "follows the artwork from %s to %s",
  (start, end) => {
    const pawn = {
      ...createPractice("snakes_and_ladders").state.pawns[0],
      pathIndex: Number(start) - 1,
      state: "track" as const,
    };
    const move = snakeMove([pawn], pawn.color, 1)!;
    expect(move).toMatchObject({
      landingSquare: Number(start),
      toTileId: `snakes:${end}`,
      capturesPawnIds: [],
    });
    const next = applySnakeMove([pawn], move)[0];
    const path = moveWaypoints(pawn, next, "snakes_and_ladders", move);
    expect(path[0]).toEqual(snakeSquarePoint(Number(start)));
    expect(path.at(-1)![0]).toBeCloseTo(snakeSquarePoint(end)[0]);
    expect(path.at(-1)![2]).toBeCloseTo(snakeSquarePoint(end)[2]);
  },
);

it("enters on any die, moves automatically and does not grant a bonus six", () => {
  const session = createPractice("snakes_and_ladders");
  const next = practiceReducer(session, { type: "roll", value: 6 });
  expect(next.state.pawns).toHaveLength(4);
  expect(next.state.pawns[0].pathIndex).toBe(6);
  expect(next.state.turnPlayerId).toBe("practice-1");
  expect(next.state.turnPhase).toBe("awaiting_roll");
  expect(next.events.map((e) => e.event_type)).toEqual([
    "dice_rolled",
    "legal_move_selected",
  ]);
  for (const value of [0, 7, 1.5, NaN])
    expect(practiceReducer(session, { type: "roll", value })).toBe(session);
});

it("requires exact 100 and continues until the last player finishes", () => {
  const session = createPractice("snakes_and_ladders");
  session.state.pawns = session.state.pawns.map((p) => ({
    ...p,
    state: "track",
    pathIndex: 99,
  }));
  const overshoot = practiceReducer(session, { type: "roll", value: 2 });
  expect(overshoot.state.pawns[0].pathIndex).toBe(99);
  expect(overshoot.state.turnPlayerId).toBe("practice-1");
  let next = session;
  for (let i = 0; i < 3; i++)
    next = practiceReducer(next, { type: "roll", value: 1 });
  expect(next.state.status).toBe("in_game");
  expect(next.state.winnerIds).toEqual([
    "practice-0",
    "practice-1",
    "practice-2",
  ]);
  next = practiceReducer(next, { type: "roll", value: 6 });
  expect(next.state.turnPlayerId).toBe("practice-3");
  next = practiceReducer(next, { type: "roll", value: 1 });
  expect(next.state.status).toBe("summary");
  expect(next.state.winnerIds).toHaveLength(4);
  expect(practiceReducer(next, { type: "reset" }).state.gameType).toBe(
    "snakes_and_ladders",
  );
});

it("queues automatic movement behind the roll and replays the full action", () => {
  vi.useFakeTimers();
  const initial = createPractice("snakes_and_ladders");
  const timeline = new PresentationTimeline(initial.state);
  const next = practiceReducer(initial, { type: "roll", value: 4 });
  timeline.receive(next.events, next.state);
  expect(timeline.getSnapshot().pawns[0].pathIndex).toBeNull();
  vi.advanceTimersByTime(1180);
  expect(timeline.getSnapshot()).toMatchObject({
    phase: "move",
    move: { landingSquare: 4, toTileId: "snakes:16" },
  });
  vi.runAllTimers();
  timeline.replay();
  vi.runAllTimers();
  expect(timeline.getSnapshot().pawns).toEqual(next.state.pawns);
  expect(timeline.getSnapshot().busy).toBe(false);
  timeline.receive([], createPractice().state);
  expect(timeline.getSnapshot().pawns).toHaveLength(16);
  expect(timeline.getSnapshot().canReplay).toBe(false);
  timeline.dispose();
});

it("animates a snake that returns to the square the player started on", () => {
  const pawn = {
    ...createPractice("snakes_and_ladders").state.pawns[0],
    pathIndex: 88,
    state: "track" as const,
  };
  const move = snakeMove([pawn], pawn.color, 6)!;
  const next = applySnakeMove([pawn], move);
  expect(next[0].pathIndex).toBe(88);
  expect(moveWaypoints(pawn, next[0], "snakes_and_ladders", move)).toHaveLength(
    18,
  );
  expect(movementDuration([pawn], next, "snakes_and_ladders", move)).toBe(3250);
});
