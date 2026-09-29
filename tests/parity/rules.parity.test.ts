import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chooseBotMove } from "../../lib/board/bot";
import { snakeMove } from "../../lib/board/snakes";
import type { EnginePawn } from "../../lib/board/engine-types";
import {
  applyMove,
  DEFAULT_ROOM_RULES,
  earnsBonusRoll,
  evaluateSixRoll,
  getLegalMoves,
  isMatchWon,
  isTeamUpWon,
  rankPlayers,
  resolveRoomRules,
  type PlayerProgress,
} from "../../lib/board/rules";
import { RULE_PRESETS, rulesAllowed } from "../../lib/board/presets";
import type { LegalMove, PlayerColor, RoomRules } from "../../lib/board/types";

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

  // The variants (F2.6): any roll to start, and bouncing back off 100.
  for (const rules of [
    { snakesAnyRollToStart: true },
    { snakesBounceBack: true },
    { snakesAnyRollToStart: true, snakesBounceBack: true },
  ]) {
    const variant = await client.query(
      `select private.snakes_move(f->'pawns', 'red', (f->>'die')::int, $2::jsonb) as move
       from jsonb_array_elements($1::jsonb) with ordinality t(f, n) order by n`,
      [JSON.stringify(fixtures), JSON.stringify(rules)],
    );
    expect(variant.rows.map((r) => r.move)).toEqual(
      fixtures.map((f) => snakeMove(f.pawns, "red", f.die, rules)),
    );
  }
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
  context?: { rules?: Partial<RoomRules> | null; hasCaptured?: boolean },
): Promise<LegalMove[]> {
  const { rows } = await client.query(
    context === undefined
      ? "select private.ludo_legal_moves($1::jsonb, $2, $3) as result"
      : "select private.ludo_legal_moves($1::jsonb, $2, $3, $4::jsonb, $5) as result",
    context === undefined
      ? [JSON.stringify(pawns), color, dieValue]
      : [
          JSON.stringify(pawns),
          color,
          dieValue,
          context.rules == null ? null : JSON.stringify(context.rules),
          context.hasCaptured ?? false,
        ],
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
  rules: RoomRules,
): Promise<boolean> {
  const { rows } = await client.query(
    "select private.ludo_earns_bonus_roll($1, $2::jsonb, $3::jsonb) as result",
    [dieValue, JSON.stringify(move), JSON.stringify(rules)],
  );
  return rows[0].result as boolean;
}

async function sqlResolveRules(rules: unknown): Promise<RoomRules> {
  const { rows } = await client.query(
    "select private.ludo_resolve_rules($1::jsonb) as result",
    [rules === undefined ? null : JSON.stringify(rules)],
  );
  return rows[0].result as RoomRules;
}

async function sqlIsMatchWon(
  pawns: EnginePawn[],
  color: PlayerColor,
  rules?: Partial<RoomRules> | null,
): Promise<boolean> {
  const { rows } = await client.query(
    rules === undefined
      ? "select private.ludo_is_match_won($1::jsonb, $2) as result"
      : "select private.ludo_is_match_won($1::jsonb, $2, $3::jsonb) as result",
    rules === undefined
      ? [JSON.stringify(pawns), color]
      : [JSON.stringify(pawns), color, rules === null ? null : JSON.stringify(rules)],
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

  it("agree on bonus-roll eligibility for every die, move kind and rule setting", async () => {
    const plain: LegalMove = {
      pawnId: "x",
      fromTileId: "track:1",
      toTileId: "track:2",
      capturesPawnIds: [],
      finishesPawn: false,
    };
    const moves = [
      plain,
      { ...plain, capturesPawnIds: ["y"] },
      { ...plain, fromTileId: "home:red:4", toTileId: "home:red:5", finishesPawn: true },
    ];
    const ruleSets: RoomRules[] = [
      DEFAULT_ROOM_RULES,
      { ...DEFAULT_ROOM_RULES, bonusRollOnFinish: false },
    ];
    for (const rules of ruleSets)
      for (const move of moves)
        for (let dieValue = 1; dieValue <= 6; dieValue++)
          expect(await sqlEarnsBonusRoll(dieValue, move, rules)).toBe(
            earnsBonusRoll(dieValue, move, rules),
          );
  });

  it("agree on resolving room rules", async () => {
    const inputs = [
      undefined,
      {},
      { bonusRollOnFinish: false },
      { bonusRollOnFinish: true },
      // Quick mode (F2.1), and values the server would reject, so both
      // engines agree on what an old or odd snapshot resolves to.
      { startOnBoard: 1, pawnsToWin: 2 },
      { pawnsToWin: 1 },
      { startOnBoard: 4, pawnsToWin: 4 },
      { unknownKey: true },
    ];
    for (const input of inputs)
      expect(await sqlResolveRules(input)).toEqual(resolveRoomRules(input));
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

  it("agree on how many pieces have to get home", async () => {
    // Red has two home, one in its home lane, one still on the track.
    const pawns = fullBoard({
      "red-0": pawn("red-0", "red", 0, "finished", 56),
      "red-1": pawn("red-1", "red", 1, "finished", 56),
      "red-2": pawn("red-2", "red", 2, "home_lane", 54),
      "red-3": pawn("red-3", "red", 3, "track", 20),
    });
    for (const rules of [
      undefined,
      { pawnsToWin: 1 },
      { pawnsToWin: 2 },
      { pawnsToWin: 3 },
      { pawnsToWin: 4 },
      { startOnBoard: 1, pawnsToWin: 2 },
    ] as (Partial<RoomRules> | undefined)[])
      expect(await sqlIsMatchWon(pawns, "red", rules)).toBe(isMatchWon(pawns, "red", rules));
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

describe("parity: Master mode (F2.2)", () => {
  it("agree on pieces held back until their player has captured", async () => {
    // Red is spread across the track, the home lane's doorstep, and inside it.
    const pawns = fullBoard({
      "red-0": pawn("red-0", "red", 0, "track", 48),
      "red-1": pawn("red-1", "red", 1, "track", 50),
      "red-2": pawn("red-2", "red", 2, "home_lane", 52),
      "red-3": pawn("red-3", "red", 3, "nest", null),
    });
    const rules = { captureToEnterHome: true };
    for (const hasCaptured of [false, true])
      for (let dieValue = 1; dieValue <= 6; dieValue++) {
        const context = { rules, hasCaptured };
        expect(await sqlLegalMoves(pawns, "red", dieValue, context)).toEqual(
          getLegalMoves(pawns, "red", dieValue, context),
        );
      }
  });

  it("agree that the classic game is untouched", async () => {
    const pawns = fullBoard({
      "red-0": pawn("red-0", "red", 0, "track", 48),
      "red-1": pawn("red-1", "red", 1, "track", 50),
      "red-2": pawn("red-2", "red", 2, "home_lane", 52),
      "red-3": pawn("red-3", "red", 3, "nest", null),
    });
    for (let dieValue = 1; dieValue <= 6; dieValue++) {
      const context = { rules: { captureToEnterHome: false }, hasCaptured: false };
      expect(await sqlLegalMoves(pawns, "red", dieValue, context)).toEqual(
        getLegalMoves(pawns, "red", dieValue, context),
      );
      expect(getLegalMoves(pawns, "red", dieValue, context)).toEqual(
        getLegalMoves(pawns, "red", dieValue),
      );
    }
  });
});

describe("parity: blockades (F2.4)", () => {
  it("agree on what a blockade stops", async () => {
    // Green holds cell 8 with two pieces (unsafe for red passing it), and
    // yellow has a lone piece further on. Red runs the gauntlet.
    const pawns = fullBoard({
      "red-0": pawn("red-0", "red", 0, "track", 5),
      "red-1": pawn("red-1", "red", 1, "track", 9),
      "green-0": pawn("green-0", "green", 0, "track", 22),
      "green-1": pawn("green-1", "green", 1, "track", 22),
      "yellow-0": pawn("yellow-0", "yellow", 0, "track", 35),
    });
    for (const blockades of [false, true])
      for (let dieValue = 1; dieValue <= 6; dieValue++) {
        const context = { rules: { blockades } };
        expect(await sqlLegalMoves(pawns, "red", dieValue, context)).toEqual(
          getLegalMoves(pawns, "red", dieValue, context),
        );
      }
  });

  it("agree that a colour is never stopped by its own pieces", async () => {
    const pawns = fullBoard({
      "red-0": pawn("red-0", "red", 0, "track", 5),
      "red-1": pawn("red-1", "red", 1, "track", 9),
      "red-2": pawn("red-2", "red", 2, "track", 9),
    });
    for (let dieValue = 1; dieValue <= 6; dieValue++) {
      const context = { rules: { blockades: true } };
      expect(await sqlLegalMoves(pawns, "red", dieValue, context)).toEqual(
        getLegalMoves(pawns, "red", dieValue, context),
      );
    }
  });
});

describe("parity: house rules presets and allow-list (F2.4)", () => {
  it("agree on the presets", async () => {
    const { rows } = await client.query("select private.ludo_rule_presets() as presets");
    expect(rows[0].presets).toEqual(RULE_PRESETS);
  });

  it("agree on which combinations a host may pick", async () => {
    const candidates: Partial<RoomRules>[] = [
      {},
      { blockades: true },
      { bonusRollOnFinish: false },
      { turnSeconds: 10 },
      { turnSeconds: 30 },
      { startOnBoard: 1, pawnsToWin: 2 },
      { captureToEnterHome: true },
      { blockades: true, captureToEnterHome: true },
      { startOnBoard: 3 },
      { pawnsToWin: 1 },
      { blockades: true, matchMinutes: 10, snakesBounceBack: true },
      { turnSeconds: 30, blockades: true },
    ];
    for (const rules of candidates) {
      const { rows } = await client.query("select private.ludo_rules_allowed($1::jsonb) as allowed", [
        JSON.stringify(rules),
      ]);
      expect([rules, rows[0].allowed]).toEqual([rules, rulesAllowed(rules)]);
    }
  });
});

async function sqlTeamUpWon(pawns: EnginePawn[], color: PlayerColor): Promise<boolean> {
  const { rows } = await client.query(
    "select private.ludo_team_up_won($1::jsonb, $2) as result",
    [JSON.stringify(pawns), color],
  );
  return rows[0].result as boolean;
}

describe("parity: Team Up (F2.5)", () => {
  const teamUp = { rules: { teamUp: true } };

  // A cell that red, yellow and green pawns can all occupy at once, so a red
  // move landing there exercises both partner protection (yellow shares it
  // safely) and a real capture (green is an opponent). Cell 10 is unsafe.
  //   red-0 at pathIndex 6, die 4 -> global cell 10
  //   yellow-0 (partner) at pathIndex 36 -> global cell 10
  //   green-0 (opponent) at pathIndex 49 -> global cell 10
  const contested = fullBoard({
    "red-0": pawn("red-0", "red", 0, "track", 6),
    "yellow-0": pawn("yellow-0", "yellow", 0, "track", 36),
    "green-0": pawn("green-0", "green", 0, "track", 49),
  });

  it("agrees on partner protection: a partner is never captured, an opponent is", async () => {
    for (const die of [1, 2, 3, 4, 5, 6]) {
      expect(await sqlLegalMoves(contested, "red", die, teamUp))
        .toEqual(getLegalMoves(contested, "red", die, teamUp));
    }
    // Semantic check on the shared destination itself (die 4 -> cell 10).
    const move = getLegalMoves(contested, "red", 4, teamUp)
      .find((m) => m.pawnId === "red-0")!;
    expect(move.capturesPawnIds).toContain("green-0"); // opponent captured
    expect(move.capturesPawnIds).not.toContain("yellow-0"); // partner spared
  });

  it("agrees that a nest pawn does not capture a partner sharing its entry", async () => {
    // Red's entry is global cell 0 (a safe cell), so nothing captures there;
    // move it off-safe by putting the partner on red's second step instead.
    const board = fullBoard({
      "red-0": pawn("red-0", "red", 0, "nest", null),
      // yellow on global cell 1 == red pathIndex 1; red can't reach it from
      // the nest (nest only reaches entry on a 6), so this just confirms the
      // two engines agree on the whole nest-entry path under Team Up.
      "yellow-0": pawn("yellow-0", "yellow", 0, "track", 27),
    });
    for (const die of [1, 6]) {
      expect(await sqlLegalMoves(board, "red", die, teamUp))
        .toEqual(getLegalMoves(board, "red", die, teamUp));
    }
  });

  it("agrees on moving a partner's pawns only after all four own pawns finish", async () => {
    const partnerBoard = fullBoard({
      "yellow-0": pawn("yellow-0", "yellow", 0, "track", 5),
      "yellow-1": pawn("yellow-1", "yellow", 1, "nest", null),
      "green-0": pawn("green-0", "green", 0, "track", 20),
    });

    // Three of red's four finished: red still controls only its own pawns.
    const threeFinished = partnerBoard.map((p) =>
      p.color === "red" && p.index < 3
        ? { ...p, state: "finished" as const, pathIndex: 56 }
        : p,
    );
    for (const die of [1, 2, 3, 4, 5, 6]) {
      expect(await sqlLegalMoves(threeFinished, "red", die, teamUp))
        .toEqual(getLegalMoves(threeFinished, "red", die, teamUp));
    }
    // The one remaining own pawn is in the nest, so only a six moves anything.
    expect(getLegalMoves(threeFinished, "red", 3, teamUp)).toEqual([]);

    // All four red finished: red now rolls for yellow, its partner.
    const fourFinished = partnerBoard.map((p) =>
      p.color === "red" ? { ...p, state: "finished" as const, pathIndex: 56 } : p,
    );
    for (const die of [1, 2, 3, 4, 5, 6]) {
      expect(await sqlLegalMoves(fourFinished, "red", die, teamUp))
        .toEqual(getLegalMoves(fourFinished, "red", die, teamUp));
    }
    // Every move offered belongs to the partner (yellow), never an opponent.
    const partnerMoves = getLegalMoves(fourFinished, "red", 3, teamUp);
    expect(partnerMoves.length).toBeGreaterThan(0);
    expect(partnerMoves.every((m) => m.pawnId.startsWith("yellow"))).toBe(true);
  });

  it("agrees on the team win predicate", async () => {
    const almost = fullBoard({
      "red-0": pawn("red-0", "red", 0, "finished", 56),
      "red-1": pawn("red-1", "red", 1, "finished", 56),
      "red-2": pawn("red-2", "red", 2, "finished", 56),
      "red-3": pawn("red-3", "red", 3, "finished", 56),
      "yellow-0": pawn("yellow-0", "yellow", 0, "finished", 56),
      "yellow-1": pawn("yellow-1", "yellow", 1, "finished", 56),
      "yellow-2": pawn("yellow-2", "yellow", 2, "finished", 56),
      "yellow-3": pawn("yellow-3", "yellow", 3, "track", 40),
    });
    const won = almost.map((p) =>
      p.id === "yellow-3" ? { ...p, state: "finished" as const, pathIndex: 56 } : p,
    );
    for (const [board, color] of [
      [almost, "red"], [almost, "yellow"], [almost, "green"],
      [won, "red"], [won, "green"],
    ] as const) {
      expect([color, await sqlTeamUpWon(board, color)])
        .toEqual([color, isTeamUpWon(board, color)]);
    }
  });
});
