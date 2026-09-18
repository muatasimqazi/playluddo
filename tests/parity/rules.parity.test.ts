import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chooseBotMove } from "../../lib/board/bot";
import { snakeMove } from "../../lib/board/snakes";
import type { EnginePawn } from "../../lib/board/engine-types";
import {
  applyMove,
  earnsBonusRoll,
  evaluateSixRoll,
  getLegalMoves,
  isMatchWon,
  rankPlayers,
  type PlayerProgress,
} from "../../lib/board/rules";
import type { LegalMove, PlayerColor } from "../../lib/board/types";

/**
 * Golden-vector parity suite: the same fixture inputs run through the
 * TypeScript engine (lib/board) and the plpgsql engine
 * (supabase/migrations/20260913215503_rules_engine.sql), asserting
 * identical output. This is the real safeguard against the two
 * implementations drifting — see docs/IMPLEMENTATION_HANDOFF.md Section 2.
 *
 * Requires a live local Supabase Postgres (`supabase start`). Run via
 * `npm run test:parity`, separately from the DB-free `npm test`.
 */

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: DB_URL });
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

it("Snakes & Ladders SQL and practice agree for every square and die", async () => {
  // Includes off-board, finished, and every overshoot, snake and ladder.
  const fixtures = Array.from({ length: 101 }, (_, square) =>
    Array.from({ length: 6 }, (_, i) => ({
      die: i + 1,
      pawns: [
        {
          id: "red-0",
          color: "red" as const,
          index: 0,
          state:
            square === 0
              ? ("nest" as const)
              : square === 100
                ? ("finished" as const)
                : ("track" as const),
          pathIndex: square || null,
        },
      ],
    })),
  ).flat();
  const { rows } = await client.query(
    `select private.snakes_move(f->'pawns', 'red', (f->>'die')::int) as move
     from jsonb_array_elements($1::jsonb) with ordinality t(f, n) order by n`,
    [JSON.stringify(fixtures)],
  );
  expect(rows.map((r) => r.move)).toEqual(
    fixtures.map((f) => snakeMove(f.pawns, "red", f.die)),
  );
});

function pawn(
  id: string,
  color: PlayerColor,
  index: number,
  state: EnginePawn["state"],
  pathIndex: number | null,
): EnginePawn {
  return { id, color, index, state, pathIndex };
}

function fullBoard(overrides: Record<string, EnginePawn> = {}): EnginePawn[] {
  const colors: PlayerColor[] = ["red", "green", "yellow", "blue"];
  const pawns: EnginePawn[] = [];
  for (const color of colors) {
    for (let index = 0; index < 4; index++) {
      const id = `${color}-${index}`;
      pawns.push(overrides[id] ?? pawn(id, color, index, "nest", null));
    }
  }
  return pawns;
}

async function sqlLegalMoves(
  pawns: EnginePawn[],
  color: PlayerColor,
  dieValue: number,
): Promise<LegalMove[]> {
  const { rows } = await client.query(
    "select private.ludo_legal_moves($1::jsonb, $2, $3) as result",
    [JSON.stringify(pawns), color, dieValue],
  );
  return rows[0].result as LegalMove[];
}

async function sqlApplyMove(
  pawns: EnginePawn[],
  move: LegalMove,
): Promise<EnginePawn[]> {
  const { rows } = await client.query(
    "select private.ludo_apply_move($1::jsonb, $2::jsonb) as result",
    [JSON.stringify(pawns), JSON.stringify(move)],
  );
  return rows[0].result as EnginePawn[];
}

async function sqlEvaluateSixRoll(before: number, dieValue: number) {
  const { rows } = await client.query(
    "select private.ludo_evaluate_six_roll($1, $2) as result",
    [before, dieValue],
  );
  return rows[0].result;
}

async function sqlEarnsBonusRoll(
  dieValue: number,
  move: LegalMove,
): Promise<boolean> {
  const { rows } = await client.query(
    "select private.ludo_earns_bonus_roll($1, $2::jsonb) as result",
    [dieValue, JSON.stringify(move)],
  );
  return rows[0].result as boolean;
}

async function sqlIsMatchWon(
  pawns: EnginePawn[],
  color: PlayerColor,
): Promise<boolean> {
  const { rows } = await client.query(
    "select private.ludo_is_match_won($1::jsonb, $2) as result",
    [JSON.stringify(pawns), color],
  );
  return rows[0].result as boolean;
}

async function sqlRankPlayers(players: PlayerProgress[]): Promise<string[]> {
  const { rows } = await client.query(
    "select private.ludo_rank_players($1::jsonb) as result",
    [JSON.stringify(players)],
  );
  return rows[0].result as string[];
}

async function sqlChooseBotMove(
  legalMoves: LegalMove[],
  pawns: EnginePawn[],
): Promise<LegalMove | null> {
  const { rows } = await client.query(
    "select private.ludo_choose_bot_move($1::jsonb, $2::jsonb) as result",
    [JSON.stringify(legalMoves), JSON.stringify(pawns)],
  );
  return rows[0].result as LegalMove | null;
}

const LEGAL_MOVE_FIXTURES: {
  name: string;
  pawns: EnginePawn[];
  color: PlayerColor;
  dieValue: number;
}[] = [
  {
    name: "no legal moves, everyone in nest, non-six",
    pawns: fullBoard(),
    color: "red",
    dieValue: 4,
  },
  {
    name: "all nest pawns are candidates on a six",
    pawns: fullBoard(),
    color: "red",
    dieValue: 6,
  },
  {
    name: "plain track advance",
    pawns: fullBoard({ "red-0": pawn("red-0", "red", 0, "track", 6) }),
    color: "red",
    dieValue: 4,
  },
  {
    name: "overshoot excluded",
    pawns: fullBoard({ "red-0": pawn("red-0", "red", 0, "home_lane", 53) }),
    color: "red",
    dieValue: 4,
  },
  {
    name: "exact roll finishes",
    pawns: fullBoard({ "red-0": pawn("red-0", "red", 0, "home_lane", 53) }),
    color: "red",
    dieValue: 3,
  },
  {
    name: "single capture",
    pawns: fullBoard({
      "red-0": pawn("red-0", "red", 0, "track", 6),
      "green-0": pawn("green-0", "green", 0, "track", 49),
    }),
    color: "red",
    dieValue: 4,
  },
  {
    name: "stacked capture",
    pawns: fullBoard({
      "red-0": pawn("red-0", "red", 0, "track", 6),
      "green-0": pawn("green-0", "green", 0, "track", 49),
      "green-1": pawn("green-1", "green", 1, "track", 49),
    }),
    color: "red",
    dieValue: 4,
  },
  {
    name: "safe cell immunity",
    pawns: fullBoard({
      "red-0": pawn("red-0", "red", 0, "track", 4),
      "green-0": pawn("green-0", "green", 0, "track", 47),
    }),
    color: "red",
    dieValue: 4,
  },
  {
    name: "no blockade — two own pawns stacked, both movable",
    pawns: fullBoard({
      "red-0": pawn("red-0", "red", 0, "track", 5),
      "red-1": pawn("red-1", "red", 1, "track", 5),
    }),
    color: "red",
    dieValue: 3,
  },
  {
    name: "arbitrary mid-game board with a mix of states",
    pawns: fullBoard({
      "red-0": pawn("red-0", "red", 0, "track", 20),
      "red-1": pawn("red-1", "red", 1, "home_lane", 54),
      "green-0": pawn("green-0", "green", 0, "track", 8), // on a safe cell
      "blue-2": pawn("blue-2", "blue", 2, "track", 44),
    }),
    color: "red",
    dieValue: 6,
  },
];

describe("parity: getLegalMoves (TS) vs private.ludo_legal_moves (SQL)", () => {
  for (const fixture of LEGAL_MOVE_FIXTURES) {
    it(fixture.name, async () => {
      const tsResult = getLegalMoves(
        fixture.pawns,
        fixture.color,
        fixture.dieValue,
      );
      const sqlResult = await sqlLegalMoves(
        fixture.pawns,
        fixture.color,
        fixture.dieValue,
      );
      expect(sqlResult).toEqual(tsResult);
    });
  }
});

describe("parity: applyMove (TS) vs private.ludo_apply_move (SQL)", () => {
  it("agree on the resulting board after a capturing move", async () => {
    const pawns = fullBoard({
      "red-0": pawn("red-0", "red", 0, "track", 6),
      "green-0": pawn("green-0", "green", 0, "track", 49),
    });
    const move = getLegalMoves(pawns, "red", 4).find(
      (m) => m.pawnId === "red-0",
    )!;
    const tsResult = applyMove(pawns, move);
    const sqlResult = await sqlApplyMove(pawns, move);
    expect(sqlResult).toEqual(tsResult);
  });

  it("agree on a move that crosses into the home lane", async () => {
    const pawns = fullBoard({ "red-0": pawn("red-0", "red", 0, "track", 49) });
    const move = getLegalMoves(pawns, "red", 3).find(
      (m) => m.pawnId === "red-0",
    )!;
    const tsResult = applyMove(pawns, move);
    const sqlResult = await sqlApplyMove(pawns, move);
    expect(sqlResult).toEqual(tsResult);
  });
});

describe("parity: evaluateSixRoll / earnsBonusRoll", () => {
  it("agree across the consecutive-six progression", async () => {
    const cases: [number, number][] = [
      [0, 4],
      [0, 6],
      [1, 6],
      [2, 6],
      [2, 3],
    ];
    for (const [before, dieValue] of cases) {
      const tsResult = evaluateSixRoll(before, dieValue);
      const sqlResult = await sqlEvaluateSixRoll(before, dieValue);
      expect(sqlResult).toEqual(tsResult);
    }
  });

  it("agree on bonus-roll eligibility", async () => {
    const move: LegalMove = {
      pawnId: "x",
      fromTileId: "track:1",
      toTileId: "track:2",
      capturesPawnIds: ["y"],
      finishesPawn: false,
    };
    expect(await sqlEarnsBonusRoll(3, move)).toBe(earnsBonusRoll(3, move));
    expect(await sqlEarnsBonusRoll(6, move)).toBe(earnsBonusRoll(6, move));
  });
});

describe("parity: isMatchWon / rankPlayers", () => {
  it("agree on win detection", async () => {
    const pawns = fullBoard({
      "red-0": pawn("red-0", "red", 0, "finished", 56),
      "red-1": pawn("red-1", "red", 1, "finished", 56),
      "red-2": pawn("red-2", "red", 2, "finished", 56),
      "red-3": pawn("red-3", "red", 3, "finished", 56),
    });
    expect(await sqlIsMatchWon(pawns, "red")).toBe(isMatchWon(pawns, "red"));
  });

  it("agree on ranking order", async () => {
    const players: PlayerProgress[] = [
      { id: "a", pawnsFinished: 1, totalProgress: 40, turnOrder: 2 },
      { id: "b", pawnsFinished: 2, totalProgress: 10, turnOrder: 1 },
      { id: "c", pawnsFinished: 1, totalProgress: 50, turnOrder: 0 },
      { id: "d", pawnsFinished: 1, totalProgress: 50, turnOrder: 3 },
    ];
    expect(await sqlRankPlayers(players)).toEqual(rankPlayers(players));
  });
});

describe("parity: chooseBotMove", () => {
  it("agree on the chosen move across the priority tiers", async () => {
    const pawns = fullBoard({
      "red-0": pawn("red-0", "red", 0, "home_lane", 55),
      "red-1": pawn("red-1", "red", 1, "track", 6),
    });
    const legalMoves: LegalMove[] = [
      {
        pawnId: "red-1",
        fromTileId: "track:6",
        toTileId: "track:9",
        capturesPawnIds: ["x", "y"],
        finishesPawn: false,
      },
      {
        pawnId: "red-0",
        fromTileId: "home:red:4",
        toTileId: "home:red:5",
        capturesPawnIds: [],
        finishesPawn: true,
      },
    ];
    const tsResult = chooseBotMove(legalMoves, pawns);
    const sqlResult = await sqlChooseBotMove(legalMoves, pawns);
    expect(sqlResult).toEqual(tsResult);
  });
});
