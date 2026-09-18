# Product Requirement Document (PRD): Ludo Rivals

**Document Version:** 1.2.0
**Author:** Product & Design Core Team
**Status:** MVP Scope Approved, Engineering Spec Ready for Implementation
**Target MVP Platform:** Responsive Web App for desktop and mobile browsers
**Primary MVP Game:** Ludo Rivals

**Changelog (1.1.0 → 1.2.0):** Precision pass on game rules (board geometry, blockades, stacked captures, overshoot, match-end timing), server-authoritative state machine detail, reconnect/duplicate-session mechanics, bot takeover semantics, mobile/accessibility specifics, expanded analytics and test coverage, and a new Open Questions section. See inline **[DECISION NEEDED]** flags for items requiring product sign-off before implementation.

---

## 1. Executive Summary & Vision

### 1.1 Product Vision
**Ludo Rivals** is a premium, online casual board game built around fast, competitive Ludo matches with friends and rivals. It combines familiar physical board-game nostalgia with a clean, modern interface designed for synchronous 2-to-4 player play.

The MVP proves the core online Ludo experience: reliable rooms, server-authoritative turns, readable board play, bot fill/replacement, and a complete match loop from lobby to victory summary.

### 1.2 MVP Objectives
- **Prove the Core Loop:** Players can create or join a room, start a Ludo match, take turns, finish the game, and rematch without manual support.
- **Keep Matches Moving:** 15-second decision timers, auto-roll/auto-move behavior, and bot support reduce idle time while preserving fairness.
- **Build Trust:** Dice rolls and move validation are server-authoritative. Clients render state and request actions; they never decide outcomes.
- **Work Across Screens:** The same game rules run on desktop and mobile web, with layouts adapted for each form factor.
- **Defer Risky Systems:** Real-money-like monetization, public matchmaking, tournaments, and the second game are intentionally outside the MVP.

### 1.3 Non-Goals for MVP
- No cash-out, real-money wagering, or purchasable coin packs.
- No ranked matchmaking, tournament brackets, or public leaderboards.
- No full account/social graph system beyond lightweight player identity.
- No native iOS/Android app or Electron shell. *(Capacitor is present in the codebase per 6.1 as prep for a future phase — no app-store build, native-only plugin, or native QA pass is in scope for MVP; the product ships as responsive web only.)*
- No Snakes & Ladders implementation in MVP.

---

## 2. Target Personas & User Scenarios

| Persona | Motivation | Primary Device | Key Friction to Solve |
|---|---|---|---|
| **Casual Gamer (Alex, 24)** | Quick competitive matches during short breaks. | Mobile browser | Long waits and unclear turn ownership. |
| **Social / Family Group** | Playing private matches with friends or family using a room link. | Mobile & desktop web | Difficult room setup and unreliable reconnects. |
| **Desktop Multitasker** | Keeping a casual match open while doing other tasks. | Desktop browser | Needs clear alerts, compact controls, and low visual clutter. |

---

## 3. MVP Product Scope

### 3.1 Included in MVP
- Ludo Rivals game mode only.
- Private rooms with shareable room links.
- 2-to-4 players per room.
- Bot fill when the host starts a room with empty seats.
- Bot takeover for abandoned players.
- Server-authoritative dice rolls, legal moves, captures, turn timers, and win state.
- Responsive match arena for desktop and mobile web.
- Basic post-match summary and rematch flow.
- Test soft-currency stake **display** for future economy validation, with no purchase or cash-out path (see 3.3).

### 3.2 Deferred Until After MVP
- Snakes & Ladders companion mode.
- Public matchmaking queues.
- Team Battle.
- Full cosmetics store.
- Coin refill packs.
- Regional leaderboards.
- Scheduled tournaments.
- Native app builds.
- Free-form chat.

### 3.3 Test Stake Feature — Scope Guardrail (Resolved — PRD is authoritative)
Section 1.3 states monetization is a non-goal, yet 3.1 includes a stake selector and wallet balance in the core data model. **Decision (confirmed with product): the PRD's stricter non-goal wins over any design exploration that implies real stakes.** Concretely:
- Test stakes ship **behind a feature flag, default off**, so it can be pulled from the release without touching core game logic.
- No UI copy may imply real value, redemption, transferability, or a pot/prize/payout economy. Specifically **banned** from any MVP surface: "Entry Fee," "Winner Prize," "Pot," any rake/percentage-cut framing, and "Payout" / "Instant Payout." Approved framing instead: a passive **"Test Coins"** balance and a post-match **"Test Coin Result: +/-N"** delta — display only, no promise of value.
- Legal/compliance should still confirm that a skill-game stake mechanic — even with a valueless currency and this stricter framing — doesn't require jurisdictional gating before this flag is turned on for any user segment.
- If this review isn't complete by MVP code-freeze, ship with the flag off and cut Section 5.1's stake UI and Section 5.3's "test coin result" from the build.
- **Design rework required:** the current `designs/mobile_multiplayer_room_lobby_desktop_matched` and `designs/mobile_victory_match_summary_desktop_matched` mockups use pot/rake/payout language ("Entry Fee," "Winner Prize," "Standard Pot (10% Rake)," "Rewards Credited... Instant Payout") that violates this guardrail and must be revised before implementation. See Section 10 for the full design-alignment punch list.

---

## 4. Game Rules

### 4.1 Board Geometry (Canonical Default)
This is the concrete ruleset engineering should implement. Flagged items need a product/design confirmation pass but have a working default so implementation isn't blocked.

- **Shared track:** 52 cells, indexed `0–51`, traversed clockwise by all colors.
- **Entry offsets:** each color enters the shared track at a fixed cell, evenly spaced 13 cells apart (e.g., Red = 0, Green = 13, Yellow = 26, Blue = 39 — exact per-color assignment is an implementation detail as long as spacing is even).
- **Home lane:** each color has a private 6-cell lane (5 approach cells + 1 final "home" cell) branching off the shared track one cell before that color completes its own full lap.
- **Path length:** after leaving the nest, a pawn travels 51 cells on the shared track, then up to 6 cells in its home lane — 57 total forward steps to reach `finished`.
- **Safe tiles:** the 4 entry/start cells plus 4 star cells at a fixed offset from each entry (recommended default: 8 cells after each entry) — 8 safe cells total. No capture can occur on a safe tile. *(Confirmed — the `modern_boardroom` design mockups already label this "8 Safe Star Havens," matching this default.)*

### 4.2 Turn Structure
- Each player has 4 pawns assigned to one color: red, green, yellow, or blue. Pawns begin in the `nest`.
- A roll of **6** is required to move a pawn from the nest to that player's entry cell.
- A turn is one or more **rolls**. A roll grants one bonus follow-up roll when either of the following is true: the die shows **6**, or the resulting move **captures** an opponent pawn. **Finishing a pawn (reaching the final home cell) does not grant a bonus roll** — confirmed. Multiple qualifying conditions on the same roll (e.g., a 6 that also captures) still grant only **one** bonus roll, not a stacked total.
- **Three consecutive sixes** ends the turn immediately and cancels the third roll's move. Moves made on the first two sixes remain valid.
- If a player has no legal move after a roll, the turn advances automatically after a **1.5-second** acknowledgement delay so the result is still readable.

### 4.3 Movement, Capture & Blockades
- Landing exactly on a tile occupied by one or more opponent pawns on a **non-safe** tile captures **all** opponent pawns on that tile (a stacked pair is captured together) and returns them to their owners' nests.
- A player's own pawns may share a tile freely — no restriction, no blocking effect on movement.
- **No blockade rule in MVP (confirmed)** — occupying a tile with 2+ pawns of one color does **not** block opponents from passing through or landing on/through it. This is a deliberate simplification vs. some traditional variants; a future toggle could revisit this post-MVP.
- Home-lane movement requires an **exact** roll to advance within the lane or reach the final cell. If a roll would overshoot a pawn's remaining distance, that pawn cannot be selected for that roll — it is excluded from `legalMoves`, not "moved and bounced."
- If **no** pawn has a legal move for a given roll, the turn resolves as a no-move turn (see 4.2).

### 4.4 Win Condition & Ranking
- The first player to finish all 4 pawns is declared the winner. Finished players leave the turn rotation while the remaining players continue playing for placement.
- The match ends after every seated player has finished. `winnerIds` records players in the order they finish.
- This keeps matches bounded and supports the < 15-minute median duration target in Section 8.

### 4.5 Board Definition Requirements (Engineering)
Engineering must maintain a single canonical, versioned board definition module containing:
- Player entry cells, per-color home-lane paths, and safe-tile set (Section 4.1).
- Shared track cell order and total length.
- Coordinate map for rendering pawns at each cell (desktop + mobile scale variants).
- A pure, server-side legal-movement function per pawn state (`nest`, `track`, `home_lane`, `finished`) taking `(pawnState, dieValue) → legalMove | null`, unit-testable independent of transport/networking code.
- **Two implementations, one behavior:** since game logic runs as pure Postgres functions (6.2) and the client renderer runs in the browser, the authoritative legal-movement function (plpgsql) and the client's advisory copy (TypeScript, used only for pawn highlighting) are necessarily separate codebases. Static geometry data (entry offsets, safe tiles, path-index mapping) should be copied byte-for-byte between them; branching legality logic must be covered by a shared golden-vector test suite run against both, so drift is caught in CI rather than in a mismatched highlight. See the implementation handoff doc for the concrete test-suite structure.

### 4.6 Future Game: Snakes & Ladders
Snakes & Ladders is a post-MVP companion mode. Its current intended rules:
- 100-tile serpentine board.
- 1 token per player.
- Single 1-6 die.
- Ladders and snakes trigger automatically on landing.
- Exact roll required for tile 100, with over-roll not moving the token that turn.

This mode should not influence MVP architecture except where shared room, timer, bot, and event-log abstractions are naturally reusable.

---

## 5. Feature Specifications & User Flows

### 5.1 Flow 1: Room Lobby

#### Entry Points
- Create private room.
- Join room by link or room code.
- Rejoin active room after refresh or disconnect.

#### Room Codes & Links
- Room codes are a minimum of 6 alphanumeric characters (≥ 32^6 combinations) or a signed join token embedded in the shareable link.
- Join attempts are rate-limited per IP/session to deter brute-force room guessing.

#### Lobby Features
- Mode: `Classic`.
- Player count: 2, 3, or 4 players.
- Optional test stake display (behind flag, see 3.3): `2,500`, `5,000`, `10,000`, `25,000` coins.
- Player slots show avatar/monogram, display name, level placeholder, color, and ready state.
- Empty slots show `Invite` and `Fill with Bot` affordances.
- Host can start when at least 2 seats are occupied.
- Empty seats are filled with bots when the host starts the match.
- Seats are locked at match start — a human cannot join to replace a mid-match bot seat in MVP.

#### Lobby Abandonment
- If the host disconnects before starting the match, host privileges transfer to the next-joined connected player after a 30-second grace period.
- If a lobby has zero connected players for 5 minutes, the room is closed server-side.

### 5.2 Flow 2: Live Match Arena

#### Board Area
- Square Ludo board preserves 1:1 aspect ratio.
- Board remains the visual priority on both desktop and mobile.
- Legal pawns are highlighted after a dice roll.
- Captures, home entry, and finish events use clear motion and event messages.

#### Player Status
- Each player has a status pod showing monogram, color, bot/human state, turn indicator, timer, and home progress.
- Current player must be obvious without relying only on color.
- Mobile layout may collapse non-active player details to preserve board readability.

#### Turn Control
- Primary action states: `Roll Dice`, `Choose Pawn`, `Waiting`, `No Move`.
- Dice result is displayed only after server confirmation — no client-side prediction of the roll value.
- When only one legal move exists, the client may auto-select it after a short delay (0.8s) so the outcome is still visible.
- `Auto-Roll` lets a player opt the server into choosing legal actions for their turns (their own request, distinct from timeout-driven auto-actions).

#### Decision Timers
- **Each decision point has its own independent 15-second server-controlled countdown** — the roll decision and the subsequent pawn-choice decision are timed separately. A fresh 15s window opens the moment a decision becomes available (e.g., right after the dice result, if a pawn choice is required).
- If a player times out before rolling, the server rolls automatically on their behalf.
- If a player times out before choosing a pawn, the server selects a legal move using the deterministic bot-priority logic in 6.5.

#### Inactivity & Bot Takeover
- `missedDecisionCount` increments by 1 on each timeout and **resets to 0** on any decision made before the timer expires (i.e., it tracks *consecutive* misses, not a lifetime total).
- **2 consecutive misses:** player is marked `inactive`. They remain human-controlled; the server continues to auto-act on further timeouts exactly as before. This is primarily a status/analytics signal, surfaced in the UI so other players understand the delay.
- **3 consecutive misses, OR a continuous disconnect longer than 45 seconds:** the seat's status becomes `bot`. From this point the server's bot logic acts **immediately** on that seat's turns (it does not wait out the 15s timer) so the match keeps pace.
- A disconnected or bot-controlled player may reclaim their seat at any point before match end by reconnecting with a valid session credential for that seat. The reclaim is applied at the **next turn-phase boundary** (not mid-resolution of an in-flight roll or move), so it can't race a bot action already in progress.
- **Duplicate sessions:** if a second session (new tab/device) authenticates for a seat that already has a live connection, the server invalidates the prior connection (sends it a `SESSION_REPLACED` event and closes the socket) and treats the new session as sole controller. Only one live connection per seat at a time.
- **Full-abandonment cutoff:** if every human seat in a match is simultaneously `disconnected`/`inactive`/`bot`-controlled (no human present) for more than 3 minutes, the server ends the match as `abandoned`, freezes the event log, and releases the room. Abandoned matches are excluded from the completion-rate metric's numerator and denominator, and tracked separately (Section 8).

#### Activity Feed & Reactions
- Event feed shows concise game events: rolls, moves, captures, home entries, bot takeovers, reconnects, and win state.
- MVP reactions are limited to preset emoji/text chips.
- Free-form chat is deferred.

### 5.3 Flow 3: Match Summary
- Show final ranking for all players.
- Show each player's finished pawn count and total turns.
- Show basic performance stats: captures made, sixes rolled, pawns finished, missed decisions.
- Show test coin result only if the stake feature flag (3.3) is on for this room.
- Provide `Rematch` and `Return to Lobby` actions.
- Rematch requires all currently-connected human players to accept; bots auto-accept. A player who was bot-controlled for part of the match but is connected at summary time gets a normal vote. A rematch request expires after 60 seconds of no quorum.

---

## 6. Technical Requirements & Architecture

### 6.1 Confirmed MVP Stack
- **Frontend:** Next.js (React) responsive web app.
- **Styling:** Tailwind CSS.
- **Local UI State:** Zustand or equivalent lightweight store.
- **Backend / Persistence / Realtime:** Supabase — Postgres as the single source of truth, Supabase Auth for player identity/session, Supabase Realtime for pushing state to clients, **pure Postgres functions (`SECURITY DEFINER` plpgsql, called via PostgREST/`supabase.rpc()`) as the only write path for game logic — no Edge Functions layer.**
- **Native shell:** Capacitor is added to the codebase for future native packaging, but **MVP ships as responsive web only** — no app-store build, no native-only plugin/API, no native QA pass in this phase. This does not reverse the Section 1.3 non-goal; it's groundwork for a later phase. Revisit if that changes.

WebRTC is not required for MVP.

### 6.2 Server Authority (Supabase Model)
Supabase has no long-lived process to hold in-memory room state, so server authority is enforced at the **data-access layer**, not by a stateful game server:
- **Postgres is the only source of truth.** There is no in-memory room state anywhere — every accepted action is a committed row.
- **Clients never write game tables directly.** Row-Level Security (RLS) denies direct `INSERT`/`UPDATE`/`DELETE` on `rooms`, `players`, `pawns`, and `match_events` from the client role entirely. The **only** way to mutate game state is by invoking a `SECURITY DEFINER` Postgres function directly (no intermediate Edge Function), e.g. `request_roll(room_id, player_id)` / `request_move(room_id, player_id, pawn_id)`. These functions re-validate the caller's identity against the seat they're targeting, re-derive legal moves server-side, and reject anything that doesn't match current state — the client-submitted intent is a request, never a fact.
- **Policy authorship & review:** RLS policies and `SECURITY DEFINER` functions are AI-authored as a starting point, but no policy is applied to staging or production until the product owner has explicitly reviewed and signed off on it — this is the entire security boundary for the game, so it does not merge on AI authorship alone.
- Dice rolls are generated **inside** the RPC using Postgres's `pgcrypto` extension, not client-supplied. The roll's **result** (not a seed) is written to `match_events`, so history replays deterministically without re-invoking the RNG.
- Each RPC call is a single transaction: validate → compute → write board state + append to `match_events` → return the new state. No partial writes are visible to other players.
- All state transitions must be reproducible by replaying `match_events` for a room in order.

### 6.3 Realtime Delivery & Turn Timers
No persistent process can hold a live countdown, so timers are enforced by a **scheduled sweep**, not an in-memory timer:
- After every RPC that opens a new decision window, the function writes `turn_deadline_at` (an absolute timestamp) to the room row. Deadlines are a Postgres fact, not something any client can be trusted to report.
- A `pg_cron` job calls the `sweep_expired_turns` Postgres function directly (`select sweep_expired_turns()`) **every 1 second** — no external scheduler or Edge Function invocation involved. It finds rooms where `turn_deadline_at < now()` and `status = 'in_game'`, and applies the same auto-roll / auto-move logic a real timeout would — reusing the bot-priority function (6.8), never a separate code path.
- **1-second sweep interval, not 2:** the MVP success metric in 8.3 targets 95% of turns resolving within timer + 2s. A 1s sweep leaves headroom for delivery latency inside that budget; a 2s sweep would consume the entire budget in scheduling jitter alone. Frequency of sweep executions at 1s is the tradeoff — cheap at MVP's expected concurrent-room volume since it's an in-database function call, not a network hop; revisit if it isn't (Open Question #7).
- **State delivery to clients:** each accepted RPC calls Supabase Realtime's `realtime.send(...)` **from within the same plpgsql function/transaction** to broadcast the new state on that room's channel (lower latency than relying on Postgres change-data-capture replication, and never fires for a write that then rolls back). Clients must subscribe with `private: true` — an unauthenticated/public-mode subscribe skips RLS authorization on the channel entirely, which would defeat the room-membership check in 6.2. On connect/reconnect, the client first calls a `get_room_state(room_id)` RPC to fetch the current authoritative snapshot, then applies subsequent broadcasts on top — so a missed broadcast during a reconnect gap never desyncs the client.
- Backgrounding a client tab has no effect on the deadline — it's enforced by the sweep job against the database, independent of any client.

### 6.4 Reliability Requirements
- Refreshing the browser should allow the player to rejoin the active room by re-authenticating and calling `get_room_state`.
- Duplicate sessions for the same player resolve to one active controller (Section 5.2) — enforced via a `live_connection_token` column on the seat row; a new session's RPC calls overwrite it, and the prior session's next call (or a Realtime presence check) reveals it's been superseded and the client shows `SESSION_REPLACED`.
- Temporary network loss should not immediately forfeit a player — see the `inactive`/`bot` thresholds in 5.2, driven by the same sweep job counting missed deadlines.
- **Durability is inherent:** because game state lives in Postgres rather than process memory — and every write path is a Postgres function, not a separate application server — there is no "process crash recovery" story to design at all. This meaningfully simplifies the reliability story versus a stateful game-server architecture.
- Match state must be recoverable after a client reconnect via `get_room_state` + resubscribe to the room's Realtime channel.

### 6.6 Turn State Machine
`turnPhase` values and transitions, made explicit for implementation. Each transition is driven by exactly one Postgres RPC call — either invoked directly by a player's client (`request_roll`, `request_move`) or by the `sweep_expired_turns` job on timeout (6.3); both call sites share the same underlying transition function so behavior never diverges by trigger source:

```
awaiting_roll
  → request_roll() accepted, OR sweep triggers auto-roll        → resolving
resolving
  → if legal moves exist        → awaiting_move
  → if no legal move exists     → complete (after 1.5s ack delay)
  → if match/turn ends outright → complete
awaiting_move
  → request_move() accepted, OR sweep triggers auto-move (bot priority) → resolving
resolving
  → if bonus roll earned (6 / capture only — not finish) → awaiting_roll (same player, rollsThisTurn++)
  → else                                         → complete
complete → next player's awaiting_roll (or match summary, if this was the winning move)
```

### 6.7 High-Level Data Model
The shapes below describe the row/RPC-response structure used across the RPCs and Realtime payloads in 6.2–6.3 — implemented as Postgres tables (`rooms`, `players`, `pawns`, `match_events`) with RLS as described, not as an in-memory object:

```typescript
type GameType = 'ludo';
type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';
type PlayerStatus = 'connected' | 'disconnected' | 'inactive' | 'bot';
type TurnPhase = 'awaiting_roll' | 'awaiting_move' | 'resolving' | 'complete';
type PawnState = 'nest' | 'track' | 'home_lane' | 'finished';
type MatchEndReason = 'completed' | 'abandoned';

interface Player {
  id: string;
  seatIndex: number;           // stable seat identity, independent of bot/human occupancy
  displayName: string;
  color: PlayerColor;
  status: PlayerStatus;
  isBot: boolean;
  missedDecisionCount: number; // consecutive misses; resets on any timely decision
  level: number;                // MVP: static placeholder, no progression logic
  testWalletBalance: number;    // only meaningful when stake flag (3.3) is on
}

interface Pawn {
  id: string;
  playerId: string;
  state: PawnState;
  pathIndex: number | null;    // 0-56 forward-progress index (Section 4.1)
  boardTileId: string | null;
}

interface LegalMove {
  pawnId: string;
  fromTileId: string | null;
  toTileId: string;
  capturesPawnIds: string[];
  finishesPawn: boolean;
}

interface GameRoomState {
  roomId: string;
  gameType: GameType;
  status: 'lobby' | 'in_game' | 'summary';
  players: Player[];
  pawns: Pawn[];
  turnPlayerId: string | null;
  turnPhase: TurnPhase;
  turnDeadlineAt: string | null;
  rollsThisTurn: number;        // tracks progress toward the 3-consecutive-sixes rule
  activeDiceValue: number | null;
  consecutiveSixes: number;
  legalMoves: LegalMove[];
  winnerIds: string[];
  matchEndReason: MatchEndReason | null;
  eventSequence: number;
}
```

### 6.8 Bot Logic
MVP bots use deterministic priority rules:
1. Finish a pawn if possible.
2. Capture an opponent if possible (prefer the move that captures the most pawns).
3. Move a pawn out of the nest on a 6 if useful.
4. Advance the pawn closest to finishing.
5. Otherwise choose the first legal move by stable pawn order.

Bot logic is a single pure Postgres/Edge function, callable from three places — a live bot seat's turn, a timeout auto-action, and the `sweep_expired_turns` job — so behavior never diverges by how a seat became bot-controlled. A bot-controlled seat acts on the next sweep tick (within ~1s, 6.3) rather than waiting out the full 15s decision timer.

---

## 7. Design System & UI Specifications

The MVP visual direction is **Modern Boardroom / Apple-inspired casual board game**.

### 7.1 Color Palette
- Primary Action / Accent: Apple Royal Blue (`#007AFF`)
- Red Quadrant: Crimson Red (`#EF4444`)
- Green Quadrant: Emerald Green (`#10B981`)
- Blue Quadrant: Cobalt Blue (`#3B82F6`)
- Yellow Quadrant: Golden Ochre (`#F59E0B`)
- Neutrals: Surface White (`#FFFFFF`), Soft Neutral (`#F8F9FA`), High Contrast Dark (`#1D1D1F`)

### 7.2 Accessibility Requirements
- Target **WCAG 2.1 AA**.
- Do not communicate player identity by color alone — pawns carry distinct symbols, initials, or shapes in addition to color. Verify the red/green/yellow/blue quadrant palette against common color-vision deficiencies (deuteranopia especially, given red/green use) using a simulator before final sign-off.
- All text and functional color contrast meets 4.5:1 minimum against its background.
- Hit targets are at least 44px on touch devices.
- Motion-heavy effects respect `prefers-reduced-motion`.
- Timers include a text/numeric indicator, not only radial progress; the countdown is exposed to assistive tech via a polite `aria-live` region that announces at most once per decision (not per second, to avoid spamming screen readers).
- Desktop keyboard support: Tab reaches the roll action and each currently-legal pawn in stable order; Enter/Space activates the focused control; focus-visible states are present throughout.
- Turn changes, dice results, captures, and match end are announced via `aria-live="polite"` region updates, independent of the animated event feed.

### 7.3 Board & Controls
- Pawns use matte disk styling with subtle depth.
- Dice uses high-contrast black pips on a white body.
- The primary action button must be reachable near the lower thumb zone on mobile.
- Activity feed must be collapsible on mobile.

### 7.4 Mobile Constraints
- Minimum supported viewport width: 360px (common Android baseline); board and controls must remain usable, not just non-broken, at this width.
- Respect safe-area insets (`env(safe-area-inset-*)`) for notches and home indicators — the primary action button must never sit under a system gesture bar.
- Portrait is the primary supported orientation; landscape must not break layout even if not optimized.
- No hover-dependent affordances (touch has no hover state); all interactive states must be reachable by tap.
- UI remains usable at ~300ms round-trip latency — action buttons show a brief pending state rather than appearing unresponsive while awaiting server confirmation.
- Backgrounding the tab pauses client-side animation but never pauses the player's server-side decision timer (Section 5.2).

---

## 8. Analytics & Success Metrics

### 8.1 Event Schema
Every analytics event carries: `eventType`, `roomId`, `matchId`, `playerId` (pseudonymous, not display name/email), `timestamp`, `eventSequence` (matches the room's `eventSequence` for correlation with the game log), and an event-specific `payload`.

### 8.2 MVP Events
- Room created.
- Room joined.
- Invite link copied/shared.
- Match started.
- Dice rolled.
- Legal move selected.
- Player timed out.
- Player marked inactive.
- Bot takeover triggered.
- Player reconnected.
- Player seat reclaimed (post-bot-takeover).
- Duplicate session replaced.
- Match completed.
- Match abandoned.
- Rematch requested.
- Rematch accepted.

### 8.3 MVP Success Metrics
- At least 90% of started matches reach `completed` status (matches ending `abandoned` are tracked separately, not counted as failures against this target, but reported alongside it — a rising abandonment rate is itself a health signal).
- Median Ludo match duration is under 15 minutes.
- 95% of turns resolve within the server-defined timer plus 2 seconds.
- Reconnect success rate is at least 80% for players returning within 45 seconds.
- At least 30% of completed private-room matches trigger a rematch request.
- Bot takeover rate: fewer than 15% of started matches have any seat reach bot-takeover status (a proxy for timer/UX friction, not just player flakiness).
- P95 server round-trip for `ROLL_REQUESTED`/`MOVE_REQUESTED` under 250ms.

---

## 9. Release Milestones & Roadmap

### Phase 1: MVP - Ludo Online Core
- Core Ludo rules engine.
- Server-authoritative dice and legal moves.
- Private rooms and shareable room links.
- Desktop and mobile responsive match arena.
- Bot fill and bot takeover.
- Match summary and rematch.

### Phase 2: Retention & Social Polish
- Improved onboarding/tutorial.
- Daily test bonus.
- Player levels and lightweight progression.
- Expanded preset reactions.
- Better reconnect and notification polish.

### Phase 3: Economy & Monetization Validation
- Cosmetic token and dice themes.
- Formal coin ledger.
- Compliance review for stake mechanics (see 3.3 — this review should start well before Phase 3 if the stake flag is ever turned on).
- Coin refill packs only if legal/product review approves them.

### Phase 4: Second Game & LiveOps
- Snakes & Ladders companion mode.
- Public matchmaking.
- Regional leaderboards.
- Scheduled tournaments.

---

## 10. Open Questions & Decisions Needed

These are called out inline above; consolidated here so nothing gets implemented on a silent assumption:

1. ~~Safe tile placement~~ — **Resolved.** 8-cell (4 entry + 4 star) default confirmed against the `modern_boardroom` design mockups.
2. ~~Bonus roll on finishing a pawn~~ — **Resolved.** Finishing a pawn does **not** grant a bonus roll; only six and capture do (4.2).
3. ~~Blockade rule~~ — **Resolved.** MVP ships with no blockade effect, as recommended (4.3).
4. ~~Stake feature gating~~ — **Resolved.** PRD's stricter non-goal is authoritative over the pot/rake/payout design exploration (3.3). Legal review owner/timeline still to be assigned.
5. ~~Abandonment window~~ — **Resolved.** 3-minute all-bot cutoff confirmed as the right value (5.2).
6. ~~Stack & architecture~~ — **Resolved.** Confirmed stack: Next.js, Supabase, Tailwind, Capacitor (prep-only, see 1.3/6.1). Realtime/timer model: Postgres as source of truth with a 1s `pg_cron` sweep for turn deadlines, no separate stateful game server (6.2–6.3).
7. **Sweep interval cost at scale** (6.3) — 1s `pg_cron` execution of `sweep_expired_turns` across active rooms is cheap at MVP volume; **deferred — revisit post-MVP once real concurrent-room volume is known**, not a blocker for MVP build.
8. ~~RLS policy authorship owner~~ — **Resolved.** Policies are AI-authored, human-reviewed by the product owner before any policy reaches a real environment (6.2).

### 10.1 Design ↔ PRD Alignment Punch List
Findings from comparing `designs/` against this PRD (2026-09-13). None of these block engineering on the rules engine or server, but all should be resolved before UI implementation starts against these mockups.

**Status (M4):** the shipped MVP UI was built directly against this PRD and the RPC contracts rather than against the mockup HTML, so it doesn't carry any of these issues — but that's a byproduct of starting from scratch, not this list being resolved. The mockup files under `designs/` themselves were not edited and still contain every issue below; don't use them as a source for further UI work until they're actually corrected.

| # | Screen(s) | Issue | Required direction |
|---|---|---|---|
| 1 | Lobby, Match Summary | Pot/rake/payout language ("Entry Fee," "Winner Prize," "Standard Pot (10% Rake)," "Instant Payout") | Replace with passive "Test Coins" balance + "Test Coin Result" delta only, per 3.3. |
| 2 | Lobby | "Team Battle" and "Quick Rush" offered as selectable modes | Remove from MVP lobby; MVP ships `Classic` only (3.1, 3.2). |
| 3 | Lobby (bottom nav) | "Rankings" tab | Remove from MVP nav; leaderboards are deferred (1.3, 3.2). |
| 4 | Match Summary | Full XP/leveling system ("Player Mastery XP," level-up progress bar, player title, "First Win of the Day Bonus") | Remove from MVP summary; progression and daily bonuses are Phase 2 (Section 9). |
| 5 | Live Arena (mobile + desktop) | Open free-text chat input ("iMessage...") alongside preset reaction chips | Remove the free-text input for MVP; preset chips only (3.2, 5.2). |
| 6 | All screens | Product named "Ludo Royale" / room codes `#LUDO-xxxx` | Reconcile with PRD product name "Ludo Rivals" before it's hardcoded further. |
| 7 | `modern_boardroom/DESIGN.md` vs PRD 7.1 | Palette values differ per color (e.g., Red `#E02424` vs `#EF4444`) | Pick one source of truth for color tokens — recommend DESIGN.md as canonical since it's more complete, and update PRD 7.1 to match. |
| 8 | `apple_inspired_ludo_arena_with_translucent_glass_pieces` vs DESIGN.md | Two unreconciled pawn material directions: "translucent glass" mockup vs documented "ceramic disk" tokens | Pick one pawn treatment as canonical before component build. |
| 9 | Live Arena mockups | Pawns are plain colored circles with no per-owner symbol/initial | Needed to satisfy the non-color-identity accessibility requirement in 7.2. |

---

## 11. MVP Acceptance Criteria

The MVP is considered shippable when:
- A player can create a private room and share a join link, with room codes resistant to casual brute-forcing.
- 2-to-4 humans and/or bots can complete a Ludo match under the rules in Section 4, including blockade-free stacking, stacked captures, exact-roll home entry, and continued placement play after the first finisher.
- Dice rolls and legal moves are generated and validated entirely server-side; no client can submit a final outcome.
- Every intent is rejected unless it comes from the session that authenticates for the targeted seat (duplicate-session and spoofing protection verified).
- A player can refresh or briefly disconnect and reclaim their seat without corrupting turn order or in-flight rolls.
- Inactive players are handled through auto-actions, `inactive` marking, and bot takeover exactly per the thresholds in 5.2, and can reclaim their seat afterward.
- A match with no human seats remaining ends as `abandoned` within the defined window rather than running indefinitely.
- The game reaches a deterministic final ranking, replayable from the event log.
- The match summary accurately reflects final state and key stats.
- Desktop and mobile layouts keep the board, current turn, and primary action clear at viewport widths down to 360px, respecting safe-area insets.
- The UI meets the accessibility requirements in 7.2 (contrast, non-color pawn identity, reduced motion, keyboard operability, live-region announcements).
- Automated tests cover the full matrix in Section 12.

---

## 12. Final MVP Engineering Checklist

### Rules Engine (server-side, framework-agnostic, unit-tested)
- [ ] Board definition module: track cells, entry offsets, home lanes, safe tiles (4.1) — single source of truth used by both rules engine and client renderer's coordinate map.
- [ ] Legal-move function per pawn state, pure and deterministic given `(state, dieValue)`.
- [ ] Nest exit on 6.
- [ ] Bonus roll triggers: six and capture only — finishing a pawn does **not** grant a bonus roll — with correct non-stacking when a roll qualifies on both six and capture.
- [ ] Three-consecutive-sixes cancellation.
- [ ] No-legal-move detection and 1.5s auto-advance.
- [ ] Capture on non-safe tile, including stacked-pawn capture-all.
- [ ] Safe-tile capture immunity.
- [ ] Own-pawn co-occupancy with no blockade effect (confirmed, 4.3).
- [ ] Exact-roll-only movement in/through home lane; overshoot excluded from `legalMoves`, not silently discarded after selection.
- [ ] Continue after the first finisher, skip completed colors, and preserve finish order in `winnerIds`.
- [ ] Full event-log replay produces identical final state.

### Realtime / Server Authority (Supabase)
- [ ] RLS policies deny all direct client `INSERT`/`UPDATE`/`DELETE` on `rooms`, `players`, `pawns`, `match_events` — AI-authored, and no policy reaches staging/production without the product owner's explicit review and sign-off (6.2).
- [ ] `request_roll` / `request_move` (and equivalents) implemented as `SECURITY DEFINER` Postgres functions; each re-validates caller-to-seat identity and re-derives legal moves server-side rather than trusting the client's claim.
- [ ] Dice CSPRNG generated inside the RPC (not client-supplied); roll result (not seed) written to `match_events`.
- [ ] Turn state machine (6.6) implemented as the single source of truth for `turnPhase`, reachable only through the shared transition function (both direct-RPC and sweep-triggered paths).
- [ ] `turn_deadline_at` written on every decision-window transition; independent 15s windows for roll-decision and move-decision.
- [ ] `pg_cron` calling the `sweep_expired_turns` Postgres function at a 1s interval, applying auto-roll/auto-move through the same bot-priority function used elsewhere.
- [ ] Auto-roll and auto-move-on-timeout paths reuse the shared bot-priority function (6.8).
- [ ] `missedDecisionCount` consecutive-reset logic; `inactive` at 2, `bot` at 3 or 45s disconnect — computed by the sweep job.
- [ ] Bot-controlled seats act on the next sweep tick, not on the full 15s timer.
- [ ] Seat reclaim applied at next phase boundary, not mid-resolution.
- [ ] Duplicate-session detection via `live_connection_token` and forced prior-session invalidation (`SESSION_REPLACED`).
- [ ] All-human-absent abandonment timeout (3 min) ending match as `abandoned`, driven by the same sweep job.
- [ ] Realtime Broadcast channel scoped per room, authorized so only seated players (and their reconnects) can subscribe.
- [ ] `get_room_state` RPC used on connect/reconnect to establish a base snapshot before applying subsequent broadcasts.
- [ ] Room-code entropy and join-attempt rate limiting.

### Client / UI
- [ ] No client-side prediction of dice value or move legality; pending-state UI only.
- [ ] Legal-pawn highlighting post-roll; single-legal-move auto-select after 0.8s.
- [ ] Status pods: monogram, color, bot/human, turn indicator, timer, home progress; current-turn indication not color-only.
- [ ] Mobile layout functional at 360px width, safe-area-aware, thumb-zone primary action.
- [ ] Collapsible activity feed on mobile.
- [ ] Reduced-motion handling; tab-backgrounding pauses animation, never the server timer.

### Accessibility
- [ ] WCAG 2.1 AA contrast check on full palette, including quadrant-vs-neutral combinations.
- [ ] Color-vision-deficiency simulation pass on red/green/yellow/blue quadrant set.
- [ ] Keyboard operability: roll action, legal-pawn selection, focus-visible states.
- [ ] `aria-live="polite"` announcements for turn change, dice result, capture, match end; timer exposed as text, not only radial.
- [ ] 44px minimum touch targets verified on real devices, not just emulation.

### Analytics
- [ ] Full event schema (8.1) implemented with pseudonymous `playerId`.
- [ ] All events in 8.2 firing at the correct point in the state machine.
- [ ] Dashboards/alerts for the metrics in 8.3, including bot-takeover rate and abandonment rate as distinct signals from completion rate.

### Test Coverage
- [ ] **Unit:** rules engine — movement, capture (single + stacked), safe tiles, exact-roll home entry/overshoot, consecutive sixes, bonus-roll triggers and non-stacking, no-move detection, win detection, ranking tiebreakers.
- [ ] **Integration:** turn state machine transitions via both trigger paths (direct RPC and sweep-triggered); timer expiry → auto-roll/auto-move; inactive → bot-takeover thresholds; reconnect mid-turn; duplicate-session replacement; event-log replay determinism.
- [ ] **RLS / security:** negative tests confirming the client role cannot `INSERT`/`UPDATE`/`DELETE` game tables directly, cannot call an RPC targeting a seat it doesn't control, and cannot subscribe to another room's Realtime channel.
- [ ] **End-to-end:** create room → fill with bots → play to completion → summary → rematch; join-by-link flow; refresh-and-rejoin flow.
- [ ] **Resilience/chaos:** simulated network loss and reconnect at each turn phase; a missed/delayed Realtime broadcast recovered via `get_room_state` re-sync; sweep-job retry/idempotency if `sweep_expired_turns` double-fires on the same room; all-human-disconnect abandonment.
- [ ] **Cross-browser/viewport:** desktop and mobile browsers at 360px–1440px+, including safe-area-inset devices.
- [ ] **Accessibility:** automated checks (e.g., axe) plus manual keyboard-only and reduced-motion passes.
- [ ] **Load:** target concurrent room count for MVP launch, with P95 action latency held under the 250ms target from 8.3.
