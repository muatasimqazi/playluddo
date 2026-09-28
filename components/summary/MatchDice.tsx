"use client";

import { useState } from "react";
import { COLORS } from "@/lib/presentation/board";
import type { MatchResult, Player } from "@/lib/board/types";

/**
 * How each player's die landed this match (docs/COMPETITIVE_ROADMAP.md
 * F1.1): one small bar chart per player, faces 1-6, with a line at what a
 * fair die gives on average for that many rolls. Every chart shares one
 * scale so they compare honestly. A table view carries the same numbers.
 */

const PLOT_WIDTH = 156;
const BAND = PLOT_WIDTH / 6;
const BAR = 16;
const TOP = 6;
const BASE = 52;
const HEIGHT = 66;

function barPath(x: number, height: number) {
  // 4px rounded data-end, square at the baseline.
  const r = Math.min(4, height, BAR / 2);
  const top = BASE - height;
  return `M${x},${BASE} V${top + r} Q${x},${top} ${x + r},${top} H${x + BAR - r} Q${x + BAR},${top} ${x + BAR},${top + r} V${BASE} Z`;
}

function timesLabel(count: number) {
  return count === 1 ? "once" : count === 2 ? "twice" : `${count} times`;
}

export function MatchDice({
  results,
  players,
}: {
  results: MatchResult[];
  players: Player[];
}) {
  const [asTable, setAsTable] = useState(false);
  const rows = results
    .map((result) => ({
      result,
      player: players.find((p) => p.id === result.playerId),
    }))
    .filter((row) => row.player)
    .sort((a, b) => a.result.seatIndex - b.result.seatIndex);
  if (!rows.some((row) => row.result.stats.rolls > 0)) return null;

  const scale = Math.max(
    1,
    ...rows.flatMap(({ result }) => [...result.stats.faces, result.stats.rolls / 6]),
  );
  const heightOf = (count: number) => (count / scale) * (BASE - TOP);

  return (
    <section className="match-dice" aria-labelledby="match-dice-heading">
      <div className="match-dice-header">
        <span id="match-dice-heading" className="eyebrow">
          HOW THE DICE FELL
        </span>
        <button type="button" onClick={() => setAsTable((value) => !value)}>
          {asTable ? "View as charts" : "View as table"}
        </button>
      </div>
      {asTable ? (
        <table className="match-dice-table">
          <caption className="sr-only">Times each player rolled each face</caption>
          <thead>
            <tr>
              <th scope="col">Player</th>
              {[1, 2, 3, 4, 5, 6].map((face) => (
                <th key={face} scope="col">
                  {face}
                </th>
              ))}
              <th scope="col">Rolls</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ result, player }) => (
              <tr key={result.playerId}>
                <th scope="row">{player!.displayName}</th>
                {result.stats.faces.map((count, i) => (
                  <td key={i}>{count}</td>
                ))}
                <td>{result.stats.rolls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="match-dice-grid">
          {rows.map(({ result, player }) => {
            const { faces, rolls } = result.stats;
            const expected = rolls / 6;
            const expectedY = BASE - heightOf(expected);
            return (
              <figure key={result.playerId} className="match-dice-chart">
                <figcaption>
                  <strong>{player!.displayName}</strong>
                  <small>
                    {rolls} {rolls === 1 ? "roll" : "rolls"}
                  </small>
                </figcaption>
                <svg
                  viewBox={`0 0 ${PLOT_WIDTH} ${HEIGHT}`}
                  role="img"
                  aria-label={`${player!.displayName}'s rolls: ${faces
                    .map((count, i) => `${i + 1} came up ${timesLabel(count)}`)
                    .join(", ")}. A fair die averages ${expected.toFixed(1)} of each.`}
                >
                  <line className="match-dice-baseline" x1={0} x2={PLOT_WIDTH} y1={BASE} y2={BASE} />
                  {faces.map((count, i) => {
                    const x = i * BAND + (BAND - BAR) / 2;
                    return (
                      <g key={i}>
                        {count > 0 && (
                          <path d={barPath(x, heightOf(count))} fill={COLORS[result.color]} />
                        )}
                        <text className="match-dice-face" x={i * BAND + BAND / 2} y={HEIGHT - 2}>
                          {i + 1}
                        </text>
                        {/* Hit target bigger than the bar: the whole band. */}
                        <rect x={i * BAND} y={0} width={BAND} height={BASE} fill="transparent">
                          <title>{`${i + 1}: rolled ${timesLabel(count)} (a fair die averages ${expected.toFixed(1)})`}</title>
                        </rect>
                      </g>
                    );
                  })}
                  {rolls > 0 && (
                    <line className="match-dice-expected" x1={0} x2={PLOT_WIDTH} y1={expectedY} y2={expectedY} />
                  )}
                </svg>
              </figure>
            );
          })}
        </div>
      )}
      <p className="match-dice-note">The line marks what a fair die gives on average for that many rolls.</p>
    </section>
  );
}
