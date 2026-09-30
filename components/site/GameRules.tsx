import type { RoomRules } from "@/lib/board/types";

/**
 * The rules, in the house's own words (docs/COMPETITIVE_ROADMAP.md F1.6).
 * Shown on /how-to-play and in the table's Controls & shortcuts panel.
 * Keep in step with the engines: lib/board/rules.ts and snakes.ts, and
 * their SQL mirrors. `rules` is a table's resolved house rules; without
 * it, the defaults are described and the house rule is named as one.
 */
export function LudoRules({ rules }: { rules?: RoomRules | null }) {
  const homeRoll = rules ? rules.bonusRollOnFinish : true;
  return (
    <>
      <h3>Getting started</h3>
      <ul>
        <li>Everyone has four pieces waiting in their base.</li>
        <li>
          Roll a <strong>6</strong> to bring a piece out onto your start square.
        </li>
        <li>
          Two to four players share the square board. Five or six play on a hexagonal board with six
          arms &mdash; the rules are the same, the trip round is just longer.
        </li>
      </ul>
      <h3>Moving</h3>
      <ul>
        <li>Move one piece forward, clockwise, by the number you roll.</li>
        <li>Each piece goes once round the board, then up your color&rsquo;s lane to the center.</li>
        <li>
          Reaching the center takes an exact roll. A roll that would go past it can&rsquo;t move that
          piece.
        </li>
        <li>Your own pieces can share a square. No square ever blocks the way.</li>
      </ul>
      <h3>Capturing</h3>
      <ul>
        <li>Land on an opponent&rsquo;s piece to send it back to their base, along with any others there.</li>
        <li>
          The <strong>star squares</strong>, including every start square, are safe: no one can be captured
          on them.
        </li>
      </ul>
      <h3>Rolling again</h3>
      <ul>
        <li>
          Roll a <strong>6</strong>, capture a piece
          {homeRoll ? (
            <>
              , or get a piece <strong>home</strong>
            </>
          ) : null}
          , and you roll again. One extra roll per roll, however many of those happen at once.
        </li>
        <li>Three 6s in a row and the third is cancelled: your turn ends.</li>
        {rules ? (
          !homeRoll && <li>At this table, getting a piece home doesn&rsquo;t earn another roll.</li>
        ) : (
          <li>
            The extra roll for getting a piece home is a house rule. It&rsquo;s on unless the host of a private
            table turns it off.
          </li>
        )}
      </ul>
      <h3>Winning</h3>
      <ul>
        <li>The first to get all four pieces home wins.</li>
        <li>With three or more players, everyone else plays on for the other places.</li>
      </ul>
    </>
  );
}

export function SnakesRules() {
  return (
    <>
      <h3>Getting started</h3>
      <ul>
        <li>Everyone has one piece, waiting off the board.</li>
        <li>
          Roll a <strong>6</strong> to start: your piece goes straight to square 6.
        </li>
      </ul>
      <h3>Moving</h3>
      <ul>
        <li>Your piece moves itself by the number you roll, along the numbered rows.</li>
        <li>Land at the foot of a ladder to climb it. Land on a snake&rsquo;s head to slide down.</li>
        <li>Pieces can share a square. No one gets captured.</li>
        <li>
          Rolling a <strong>6</strong> earns another roll.
        </li>
      </ul>
      <h3>Winning</h3>
      <ul>
        <li>Reaching 100 takes an exact roll. A roll that goes past it leaves your piece where it is.</li>
        <li>The first to 100 wins. With three or four players, everyone else plays on for the other places.</li>
      </ul>
    </>
  );
}

export function OnlineTableRules() {
  return (
    <>
      <h3>At an online table</h3>
      <ul>
        <li>You have 15 seconds for each roll and each move (30 seconds at new Party tables). If time runs out, the game plays for you.</li>
        <li>
          Run out of time three times in a row, or once after being away for 45 seconds, and a computer
          keeps your seat warm. Come back any time to take it back.
        </li>
      </ul>
    </>
  );
}
