# Ludo Rivals — Engineering Implementation Handoff

**Companion to:** `docs/PRD.md` (v1.2.0). This doc doesn't restate product rationale — it translates the PRD's resolved decisions into schema, contracts, and a build order. If something here conflicts with the PRD, the PRD wins; flag it and fix this doc.

**Stack:** Next.js (App Router) · Supabase (Postgres, Auth, Realtime) · Tailwind · Capacitor (prep-only, not built this phase).

**Architecture note:** all game logic runs as **pure Postgres functions** (plpgsql, `SECURITY DEFINER`), called directly from the client via `supabase.rpc(...)` (PostgREST) — there is no Edge Functions layer. This is a deliberate simplification over the Edge Function approach floated earlier: one less runtime to operate, and every mutating call is already a single Postgres transaction for free. The tradeoff, called out where it matters below: the rules engine now has **two implementations** — TypeScript (`lib/board`, client-side, display/highlighting only) and plpgsql (server-side, authoritative) — see Section 2.

---

## 1. Environment Setup

- Supabase project (one per environment: local, staging, prod) with the Supabase CLI for local dev (`supabase start`) and migrations (`supabase migration new <name>`).
- `pg_cron` extension enabled on the project (required for the sweep job, Section 8).
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — that's the whole client footprint. No service-role key is needed anywhere in the app, since all writes go through `SECURITY DEFINER` RPC functions called under the user's own session, not a privileged server key.
- No Capacitor build step in CI for this phase — it's a dependency in the repo, not a build target (PRD 1.3/6.1).

## 2. Repository Structure (suggested)

```
app/                      # Next.js routes: /lobby/[code], /match/[roomId], /summary/[roomId]
lib/
  board/                  # Pure TS board-geometry + rules-engine module — CLIENT-SIDE ONLY (display/highlighting)
  supabase/               # Typed client helpers (browser)
  realtime/               # Channel subscribe/broadcast helpers, typed event payloads
components/
  lobby/ arena/ summary/  # Mapped to designs/mobile_*_desktop_matched mockups (post punch-list fixes)
supabase/
  migrations/             # SQL migrations: schema, RLS policies, AND the plpgsql rules-engine/RPC functions (Section 6)
  tests/                  # pgTAP tests against the plpgsql functions directly — MUST live here, not under tests/:
                          #   this is a hard Supabase CLI convention (`supabase test db` only looks in supabase/tests/)
tests/
  rules-engine-ts/        # Unit tests against lib/board, no DB dependency — `npm test`
  parity/                 # Golden-vector tests: same fixture inputs run through BOTH lib/board and the SQL
                          # functions (via a live local Postgres connection, `pg`) — `npm run test:parity`
  integration/            # Against a local Supabase instance, through supabase.rpc() (M2+)
```

*(Correction from the original version of this doc: SQL rules-engine tests were planned under `tests/rules-engine-sql/`, but `supabase test db` hard-codes `supabase/tests/` as its search path — there's no config to point it elsewhere. Moved there; `tests/parity/` stays under `tests/` since it's a Vitest suite, not pgTAP.)*

**On the two rules-engine implementations:** with Edge Functions off the table, the client (`lib/board`, TypeScript) and the server (plpgsql functions, Section 6) are necessarily two separate codebases doing the same legality math — there's no runtime that can share one module between a Postgres function and a browser bundle. This is a real duplication risk the PRD's "single source of truth" language (4.5) doesn't fully survive under this architecture. Mitigate it, don't ignore it:
1. **Static geometry data** (Section 3's entry offsets, safe cells, path-index mapping) is hand-authored once and copied byte-for-byte into both `lib/board/geometry.ts` and a SQL constants table/function — these rarely change, so the duplication risk there is low.
2. **Branching legal-move logic** (capture, exact-roll overshoot, bonus-roll triggers, win/ranking) is where drift actually bites. The `tests/parity/` suite is the real safeguard: a shared JSON fixture file of `(board state, die roll) → expected legal moves` run against both implementations in CI, failing the build on any mismatch. Write this suite before, or alongside, either implementation — not after.
3. The client's copy is advisory only (pawn highlighting, "you have no legal move" UI) — it never gets to decide an outcome; the plpgsql function's answer is what's written to the database regardless of what the client predicted.

## 3. Canonical Board Geometry (concrete values)

PRD 4.1 specified the *structure*; these are the literal values engineering should hard-code — they resolve Open Question #1 (already confirmed against the design mockups' "8 Safe Star Havens") into implementable numbers.

- **Color order (clockwise, matches the design mockups):** `red → green → yellow → blue`.
- **Shared track:** 52 cells, global index `0–51`.
- **Entry offsets** (global track index where each color's pawns enter): `red = 0, green = 13, yellow = 26, blue = 39`.
- **Safe cells** (global track index, capture-immune): entry cells `{0, 13, 26, 39}` plus star cells at `+8` from each entry → `{8, 21, 34, 47}`. **Full safe set: `{0, 8, 13, 21, 26, 34, 39, 47}` — 8 cells.**
- **Per-pawn `pathIndex` convention** (0–56, matches the `Pawn.pathIndex` field in PRD 6.7):
  - `pathIndex 0` = pawn's own entry cell (just exited nest on a 6).
  - `pathIndex 1–50` = further shared-track cells (50 more steps; 51 track cells total occupied across the pawn's lap).
  - `pathIndex 51–55` = the 5 home-lane approach cells (private to that color, not on the shared track).
  - `pathIndex 56` = final home cell → triggers `state = 'finished'`.
  - Conversion while `pathIndex ≤ 50`: `globalTrackCell = (entryOffset[color] + pathIndex) mod 52`. For `pathIndex ≥ 51`, look up that color's private home-lane coordinate table instead — there is no shared-track cell.
- This table is the single source of truth for both the rules engine's legality checks and the client's pawn-coordinate renderer (PRD 4.5) — do not let a second copy of these numbers exist anywhere.

## 4. Database Schema (migration sketch)

```sql
create table rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                    -- >=6 char join code (5.1)
  status text not null default 'lobby'
    check (status in ('lobby','in_game','summary','abandoned')),
  host_player_id uuid,
  turn_player_id uuid,
  turn_phase text not null default 'awaiting_roll'
    check (turn_phase in ('awaiting_roll','awaiting_move','resolving','complete')),
  turn_deadline_at timestamptz,
  rolls_this_turn int not null default 0,
  active_dice_value int,
  consecutive_sixes int not null default 0,
  winner_ids uuid[] not null default '{}',
  match_end_reason text check (match_end_reason in ('completed','abandoned')),
  event_sequence bigint not null default 0,
  stake_enabled boolean not null default false,  -- 3.3 feature flag, default off
  created_at timestamptz not null default now()
);

create table players (                            -- a seat, not necessarily a signed-in human
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  seat_index int not null,
  user_id uuid references auth.users(id) on delete set null, -- null for a bot-only/unfilled seat, or an orphaned one
  display_name text not null,
  color text not null check (color in ('red','green','yellow','blue')),
  status text not null default 'connected'
    check (status in ('connected','disconnected','inactive','bot')),
  is_bot boolean not null default false,
  missed_decision_count int not null default 0,
  level int not null default 1,                   -- static placeholder, no progression (5.1)
  test_wallet_balance int not null default 0,      -- only meaningful if rooms.stake_enabled
  live_connection_token uuid,                      -- duplicate-session guard (5.2)
  unique (room_id, seat_index)
);

create table pawns (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  pawn_index int not null check (pawn_index between 0 and 3),
  state text not null default 'nest'
    check (state in ('nest','track','home_lane','finished')),
  path_index int,                                  -- 0-56, null while in nest (Section 3)
  unique (player_id, pawn_index)
);

create table match_events (                        -- append-only, drives replay + analytics (8.1)
  id bigint generated always as identity primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  sequence bigint not null,
  event_type text not null,
  player_id uuid references players(id),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (room_id, sequence)
);

alter table rooms enable row level security;
alter table players enable row level security;
alter table pawns enable row level security;
alter table match_events enable row level security;
```

Deliberately **not modeled**: a coin ledger, purchases, or anything implying real value — `test_wallet_balance` is a display integer, nothing else touches it.

## 5. RLS Policy Plan — ✅ Implemented (`supabase/migrations/20260913222114_rls_policies.sql`)

Per PRD 6.2: RLS is the entire security boundary, AI-drafted, **human-reviewed and signed off by the product owner before any policy touches staging or prod** — this is built and passing 66 pgTAP assertions locally, but that review still gates it before staging/production, per Open Question #8.

- **No `INSERT`/`UPDATE`/`DELETE` grants to `authenticated`/`anon` on any of the four tables, ever.** All writes happen inside `SECURITY DEFINER` functions (Section 6). Grant `EXECUTE` on those specific functions to `authenticated` — grant nothing broader.
- **`SELECT` policy:** a row in `rooms`/`players`/`pawns`/`match_events` is readable only to an `authenticated` user who has a `players` row in that `room_id` with `user_id = auth.uid()`. No spectator mode in MVP.
- **Realtime Broadcast authorization:** clients must subscribe with `{ config: { private: true } }` — an unauthenticated/public-mode subscribe **skips RLS entirely**, so this flag is not optional, it's the whole gate. Write an RLS `SELECT` policy on `realtime.messages` that checks the request's `realtime.topic()` (format `room:{room_id}`) against the caller having a seated `players` row in that room — this is what actually stops a client from subscribing to a room it isn't in, not anything client-side.
- **Test case obligation (ties to PRD §12 "RLS / security" row):** for every table, write a failing-write test proving a direct client `INSERT`/`UPDATE` is rejected, a cross-room `SELECT` returns no rows, and a private-channel subscribe to a foreign room's topic is denied.

**Two things that only surfaced by actually running this against Postgres** (both non-obvious, worth knowing before touching this migration again):
1. **RLS restricts rows; it doesn't substitute for the base `GRANT`.** Without `grant select on public.rooms, ... to authenticated;`, every query from that role fails with "permission denied for table rooms" *before RLS is even evaluated* — this local Supabase image doesn't auto-expose new tables to the Data API roles (see the `auto_expose_new_tables` note in `supabase/config.toml`), so this grant has to be explicit.
2. **A policy's `USING` clause runs as the querying role, not as a `SECURITY DEFINER` function's owner.** `private.ludo_is_seated_in_room` and `private.ludo_room_id_from_topic` are invoked directly from policy expressions, so — unlike every other `private.*` helper, which is only ever called from inside another `SECURITY DEFINER` function already running as `postgres` — these two specifically need `grant usage on schema private to authenticated` plus their own `grant execute ... to authenticated`. Everything else in `private` stays unreachable by `authenticated`/`anon`.

## 6. RPC Surface (plpgsql functions, called via `supabase.rpc()`)

Every function below is `language plpgsql security definer`, exposed automatically by PostgREST once granted `EXECUTE`, and called directly from the client as `supabase.rpc('request_move', { room_id, pawn_id })`. Each opens with `select ... for update` on the target `rooms` row to serialize concurrent intents for that room — **this matters**: a real player's `request_move` and the sweep job's timeout can race for the same room, and the lock plus a phase/deadline re-check at the top of the function is what prevents a double-application. All functions validate `auth.uid()` against the seat they target before doing anything else.

**Implementation note (as built, M2):** every error below is `raise exception '<CODE>'` with the default `P0001` SQLSTATE and the code as the message text (not a distinct SQLSTATE per case) — simpler, and sufficient since the client only needs to branch on the message string. `docs/PRD.md`'s Section 12 checklist phrase "distinct SQLSTATE/message" should be read as "distinct message"; this doc had over-specified it.

**M1 delivered the pure building blocks these RPCs compose** (`supabase/migrations/20260913215503_rules_engine.sql`, all pure jsonb-in/jsonb-out, no table access, living in the non-exposed `private` schema): `private.ludo_legal_moves`, `private.ludo_apply_move`, `private.ludo_earns_bonus_roll`, `private.ludo_evaluate_six_roll`, `private.ludo_is_match_won`, `private.ludo_rank_players`, `private.ludo_choose_bot_move`, plus the geometry helpers. The RPCs below read a room's actual rows into the jsonb shape these functions expect, call them, and write the result back — no new rules logic lives in the RPCs themselves.

| Function | Input | Behavior | Key errors | Status |
|---|---|---|---|---|
| `create_room` | `display_name` | Creates room + first seat as host | `UNAUTHENTICATED` | ✅ M2 |
| `join_room` | `code, display_name` | Adds a seat if room is `lobby` and has an open slot; idempotent for a user who's already seated | `ROOM_NOT_FOUND`, `ALREADY_STARTED`, `ROOM_FULL` | ✅ M2 |
| `fill_bot` | `room_id, seat_index` | Host-only: occupies an empty seat with a bot | `NOT_HOST`, `SEAT_TAKEN`, `ALREADY_STARTED` | ✅ M2 |
| `start_match` | `room_id` | Host-only: requires ≥2 seated (3.1); fills remaining empty seats with bots; deals initial pawn/turn state | `NOT_HOST`, `NOT_ENOUGH_PLAYERS`, `ALREADY_STARTED` | ✅ M2 |
| `request_roll` | `room_id, connection_token?` | Valid only in `awaiting_roll` for the calling seat; generates roll using `pgcrypto`'s `gen_random_bytes`, computes legal moves, advances phase per 6.6 | `NOT_YOUR_TURN`, `INVALID_PHASE`, `SESSION_REPLACED` | ✅ M2, token check added M3 |
| `request_move` | `room_id, pawn_id, connection_token?` | Valid only in `awaiting_move`; re-derives legality, applies capture/finish, advances phase or ends the match | `NOT_YOUR_TURN`, `INVALID_PHASE`, `ILLEGAL_MOVE`, `SESSION_REPLACED` | ✅ M2, token check added M3 |
| `get_room_state` | `room_id` | Read-only snapshot; used on load and on reconnect before resubscribing to broadcasts | `SEAT_NOT_CONTROLLED` | ✅ M2 |
| `claim_seat` | `room_id` | Issues a fresh `connection_token` for the caller's seat, invalidating whatever an older tab held | `SEAT_NOT_CONTROLLED` | ✅ M3 |
| `toggle_auto_roll` | `room_id, enabled` | Player opts their own seat into server-chosen actions (5.2); resolves immediately if it's already their turn | `SEAT_NOT_CONTROLLED` | ✅ M3 |
| `reclaim_seat` | `room_id` | Reconnect flow; applied at next phase boundary, not mid-resolution (5.2) | `NOTHING_TO_RECLAIM` | ✅ M3 |
| `sweep_expired_turns` | *(none, cron-only)* | Finds `in_game` rooms with `turn_deadline_at <= now()`, resolves each via the shared `private.ludo_resolve_turn_timeout`, then checks abandonment | — | ✅ M3 |
| `request_rematch` / `accept_rematch` | `room_id` | Summary-screen flow (5.3); 60s expiry | `ROOM_NOT_IN_SUMMARY` | ⏳ M4 |

Every RPC already re-derives legality/authorization from the database on every call — nothing in it trusts a client-supplied claim — so wiring in the M4 rematch functions above doesn't require revisiting what's built.

`sweep_expired_turns` is a normal plpgsql function like the rest — it has **no `EXECUTE` grant to `authenticated`/`anon`**, so it isn't client-callable even though nothing else distinguishes it; only the `postgres`/cron role can invoke it (Section 8).

Every mutating function appends a row to `match_events` in the same transaction. `request_roll`/`request_move` are thin authorization wrappers around `private.ludo_perform_roll`/`private.ludo_perform_move`; the sweep job's auto-actions (via `private.ludo_resolve_turn_timeout`) call those exact same two functions — direct player call and sweep-triggered call cannot diverge in behavior, because they're not two implementations, they're one.

## 7. Realtime Contract (Broadcast from Postgres)

With no Edge Function to push messages from, broadcasts are sent **from inside the plpgsql functions themselves**, using Supabase Realtime's `realtime.send(payload jsonb, event text, topic text, private boolean default true)` — confirmed against current Supabase Realtime source (`realtime.send` inserts directly into `realtime.messages`, which is what fans out over the client WebSocket connections). Call this as the last step of every mutating function, in the same transaction as the state write, so a broadcast is never sent for a write that then rolls back.

- Topic per room: `room:{room_id}`. Always call `realtime.send(..., private := true)` — this is what makes the RLS policy on `realtime.messages` (Section 5) actually apply; the default matches this, but don't rely on the default silently, set it explicitly.
- Two events per accepted action, both via `realtime.send`:
  - `state_updated` — the **full `GameRoomState` snapshot** (small — 4 players × 4 pawns), not a diff. Avoids an entire class of client-side reducer bugs for a payload this size.
  - `flavor_event` — the human-readable string for the activity feed (5.2), e.g. `"David captured Marcus's blue pawn!"`, so the feed doesn't have to reverse-engineer flavor text from a state diff.
- **Client subscribe requirement:** `supabase.channel('room:' + roomId, { config: { private: true } })` — omitting `private: true` skips RLS authorization on the channel entirely (confirmed against Realtime's channel-join behavior), which would defeat the Section 5 policy. This is a one-line mistake that silently opens every room to every authenticated user — call it out in code review, not just here.
- On connect/reconnect: call `get_room_state` first to get an authoritative base, **then** subscribe — never subscribe first, to avoid a broadcast racing the initial fetch.

## 8. Scheduled Sweep Job — ✅ Implemented (`supabase/migrations/20260913225951_m3_timers_bots_reconnect.sql`, `..._m3_pg_cron_schedule.sql`)

- `pg_cron` schedule: `select cron.schedule('sweep-expired-turns', '1 second', $$select public.sweep_expired_turns()$$);` — every **1 second** (PRD 6.3 — chosen against the "95% within timer + 2s" metric budget). No Edge Function or external scheduler involved; `pg_cron` calls the plpgsql function directly. **Confirmed live** against wall-clock time (not just by calling the function directly): an expired room with zero manual intervention had its die rolled by the scheduler within ~3 seconds.
- `sweep_expired_turns` locks each expired room with `for update skip locked` — safe against a concurrent real player's RPC (whichever gets the lock first completes before the other proceeds) and safe to run overlapping invocations (a room already locked by a prior tick is simply skipped this tick).
- **Same code path as a real player, not a parallel implementation:** `request_roll`/`request_move` are now thin authorization wrappers around `private.ludo_perform_roll`/`private.ludo_perform_move`; the sweep's auto-actions call those same two functions. This is what makes "must not diverge by trigger source" (PRD 5.2/6.8) actually true rather than aspirational.
- **Bot pacing isn't just "the sweep acts for bots" — every `turn_deadline_at` assignment is bot-aware.** `private.ludo_next_turn_deadline(player_id)` returns `now()` (picked up next tick) if the player `is_bot`, has `status = 'bot'`, or has opted into `auto_roll_enabled`; otherwise the normal 15s window. This is used everywhere a deadline gets set — `start_match`, `ludo_advance_to_next_player`, and both bonus-roll transitions inside `perform_roll`/`perform_move` — not only in the sweep job itself.
- `missedDecisionCount`: increments on a genuine miss (the current turn player is not already bot-controlled); resets to 0 on `request_roll`/`request_move`/`reclaim_seat` success. Escalates to `inactive` at 2, `bot` at 3, **or immediately to `bot` on the very first miss if `last_seen_at` is stale by more than 45s** — the "OR a continuous disconnect longer than 45 seconds" clause in PRD 5.2.
- **Disconnect-detection scope boundary (deliberate, not an oversight):** `last_seen_at` is updated only by calls tied to a player being present for their own turn (`request_roll`, `request_move`, `claim_seat`, `reclaim_seat`) — there's no ambient heartbeat. This means staleness is only ever evaluated once a player has *already* missed their own decision window, not continuously while it isn't yet their turn. True out-of-turn presence detection needs Realtime Presence, which is client-side wiring — deferred to M4.
- **Duplicate sessions:** `claim_seat(room_id)` issues a fresh `live_connection_token`, overwriting whatever a prior tab held. `request_roll`/`request_move` accept an optional `p_connection_token` — when provided and it no longer matches the stored token, the call fails with `SESSION_REPLACED`. The parameter is optional (not required) so existing/simpler callers aren't forced to claim a seat first.
- **Reconnect:** `reclaim_seat(room_id)` — only the original human (`user_id` match) on a `disconnected`/`inactive`/`bot` seat can call it; resets `status` to `connected` and the miss counter to 0. Locking the room first is what makes "applied at the next turn-phase boundary, not mid-resolution" (PRD 5.2) true: it can't land in the middle of an in-flight sweep resolution for the same room.
- **Abandonment:** `private.ludo_check_abandonment` piggybacks on the same per-room sweep pass rather than a separate query — a room with zero connected humans always has an imminently-expiring `turn_deadline_at` (every bot turn gets an immediate one), so it's swept every tick regardless. Tracks `rooms.all_absent_since`; ends the match as `abandoned` past 3 minutes.
- **Auto-Roll** (`toggle_auto_roll`, PRD 5.2) resolves the current decision immediately if it's already the caller's turn, rather than waiting for the next sweep tick — better UX for an explicit opt-in than a 1s delay.

## 9. Frontend Notes — ✅ Implemented (M4)

- **The shipped UI applies the design punch-list corrections directly** (PRD §10.1) — it was built from scratch against the PRD/RPC contracts, not against the flagged mockup copy, so there was nothing to strip out: no pot/rake/payout language, no Team Battle/Quick Rush modes, no Rankings tab, no XP system, no free-text chat (preset reactions weren't built this pass either — deferred, see below). **The original mockup HTML files under `designs/` were not edited** — they still contain the flagged issues as a historical/reference artifact; don't build further UI from them without applying the punch list first.
- No client-side prediction of dice value or move legality (PRD 6.2) — actions show a pending/disabled state and wait for the `state_updated` broadcast; the board never mutates optimistically.
- `lib/board`'s legal-move function runs client-side too (via the shared `GameRoomState.legalMoves` the server already computed and sent — the client does not recompute legality itself), used **only** to highlight which pawns are tappable; the authoritative check is always the plpgsql function's re-derivation on the server.
- **Identity:** anonymous Supabase Auth (`ensureSession`, `lib/supabase/auth.ts`) — PRD 1.3's "lightweight player identity", no signup friction. Requires `enable_anonymous_sign_ins = true`; enabled in `supabase/config.toml` for local dev, but **the equivalent dashboard toggle must be enabled on the hosted project before this works against staging/production** — it is not on by default.
- **Realtime wiring** (`lib/hooks/useRoomConnection.ts`, `lib/realtime/room-channel.ts`): session → `claim_seat` (issues the connection token used by `request_roll`/`request_move`'s duplicate-session check) → `get_room_state` snapshot → subscribe with `{ config: { private: true } }`, in that order, matching PRD 6.3 exactly. The activity feed reads `match_events` directly (RLS already permits a seated player to `select` it) on every `state_updated` broadcast, rather than a separate `flavor_event` broadcast channel — simpler, and match_events is already the durable log everything else replays from, so this was a deliberate simplification of what Section 7 originally described, not a shortcut around it.
- **Board rendering is a deliberate simplification, not the traditional cross shape** — see `components/arena/boardLayout.ts`'s docstring for the reasoning (a 14x14 square ring, verified to place every color's entry exactly on a corner, matching `ENTRY_OFFSET`; home-lane/finished progress shown in the status pod instead of as on-board cells). Chosen over hand-deriving the traditional board's pixel coordinates from memory, which had already produced a subtle error (a diagonal grid jump) before it could be caught — and this environment has no way to visually verify a coordinate table before shipping it, so precision that could be verified programmatically was prioritized over traditional fidelity. Revisit as a design pass, not a rules-engine change — nothing about it touches game logic.
- **A real bug was caught and fixed by the automated browser playtest, not by any pgTAP/parity test:** `create_room`/`join_room`/`fill_bot` were written in M2, before `private.ludo_broadcast_state` existed (M3), and never got backfilled — so a lobby's other players never saw a join or a bot-fill without manually refreshing. Every pgTAP test up to that point only asserted database state after a call, never whether a subscribed client actually got told. Fixed in `supabase/migrations/20260913235804_m4_backfill_lobby_broadcasts.sql`. **Lesson for later milestones:** a new mutating RPC's checklist should include "does it call `ludo_broadcast_state`", and that's exactly the kind of thing worth a pgTAP assertion against `realtime.messages`, not just database state — not yet added, worth doing before this goes further.
- **Deferred, not built this pass:** preset reaction chips (PRD 5.2), rematch quorum UI beyond the single button (shows "Waiting for others…" but not who), and the mobile/accessibility pass (PRD 7.2/7.4 — 44px touch targets, safe-area insets, reduced-motion, keyboard operability, `aria-live` regions beyond the couple already present). The playtest above was a single desktop-viewport browser session, not the mobile/cross-browser/4-human matrix PRD §12 calls for.

## 10. Build Sequence

Each milestone has a gate — don't start the next until the gate passes.

| # | Milestone | Scope | Gate to proceed |
|---|---|---|---|
| M0 | ✅ Scaffolding | Next.js skeleton, Supabase local dev, CI, env vars | Builds and deploys an empty shell |
| M1 | ✅ Schema + rules engine (both copies) | Migrations (Section 4), `lib/board` (TS) AND the plpgsql rules functions, each with a full unit test suite (movement, capture, safe tiles, exact-roll home entry/overshoot, consecutive sixes, no-blockade, win/ranking), plus the `tests/parity/` golden-vector suite passing both | Unit + parity tests green — **36 TS unit tests, 38 pgTAP assertions, 17 parity checks, all passing** |
| M2 | ✅ RLS + core RPCs (local only) | Policies live (Section 5, including `realtime.messages`); `create_room/join_room/fill_bot/start_match/request_roll/request_move/get_room_state` wired with row-locking and `EXECUTE`-only grants | Unit + parity (M1) still green; **66 pgTAP assertions** (38 rules-engine + 9 RLS-denial + 19 RPC end-to-end incl. the full create→join→fill→start→roll→move→win loop). **Product owner RLS sign-off still required** before this touches staging — local passing tests are not that sign-off. |
| M3 | ✅ Timers, bots, reconnect | Sweep job, bot-priority function shared across all trigger paths, duplicate-session + reclaim handling | 91 pgTAP assertions total (66 from M1/M2 + 25 new); `pg_cron` confirmed firing live against wall-clock time, not just via direct function calls |
| M4 | ✅ Realtime + UI | Broadcast wiring, lobby/arena/summary UI, applying the design punch-list corrections directly (not built against the flagged mockup copy) | Automated browser playtest (real Chromium, not a mock): create room → fill 3 bots → start match → live board/dice/turn-timer/activity-feed rendering → roll → bot turns auto-resolving via the sweep, zero console errors. A **real bug was caught and fixed** this way — see below. |
| M5 | Analytics + accessibility + mobile | Event schema (PRD 8.1), WCAG AA pass, 360px layout, safe-area insets | Axe clean, keyboard-only pass, 360px manual check |
| M6 | Full test matrix + load | Everything in PRD §12 Test Coverage, load test at target room count | All PRD §11 acceptance criteria met |

## 11. Carried-Forward Open Item

- **Sweep interval cost at scale** (PRD Open Question #7) — deferred; revisit the 1s `pg_cron` cadence once real concurrent-room volume from M6's load test is known.
