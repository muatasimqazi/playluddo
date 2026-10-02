# Competitive Roadmap: Matching and Beating Ludo King

**Status:** In progress · **Created:** 2026-09-28 · **Reconciled with the code:** 2026-09-30
**Companion docs:** [`PRD.md`](PRD.md) (original MVP scope) · [`IMPLEMENTATION_HANDOFF.md`](IMPLEMENTATION_HANDOFF.md) (schema, RPC contracts) · [`SNAKES_AND_LADDERS.md`](SNAKES_AND_LADDERS.md)

This document compares selected features of Ludo King (and, where relevant, Ludo Club and Ludo STAR) with Luddo House, plus the places where we can offer a different experience. Each feature has an ID, the competitor baseline, **our version**, implementation notes, acceptance criteria, and a size estimate. Each feature heading carries a status mark (✅ built · ◐ partly built · ☐ not started) and a **Status** line linking its commits. Section 0 summarizes both.

**Audit revision (2026-09-28):** factual corrections are incorporated below. Each affected feature has an **Also see** line naming the Section 15 recommendations that apply to it; R11 (release, accessibility and doc reconciliation) applies to every feature. Section 15 contains proposed implementation requirements, linked to the affected features. Section 12 records all 18 product decisions (2026-09-28), and the feature text has been updated to match them. A Section 15 item is approved only where a decision or the feature text adopts it; the rest are proposals to settle before treating a feature as ready to build.

Sizes: **S** ≈ 1–2 days · **M** ≈ 3–5 days · **L** ≈ 1–2 weeks · **XL** > 2 weeks.

---

## 0. Implementation status (2026-09-30)

Reconciled against `develop` at `e2706e5`. ✅ means the feature's code is merged. Each acceptance criterion has **not** been re-verified item by item; ◐ and ☐ entries list what is known to be missing.

**Switched on in production (checked 2026-09-30).** All three server feature flags are on: `online_age_check` (F0.4), `push_notifications` (F1.7, delivering) and `video_chat` (V0–V4). The roadmap said video should stay off until V4's store disclosures ship. They are drafted in [`STORE_DISCLOSURES.md`](STORE_DISCLOSURES.md) but not yet entered in App Store Connect or Play Console.

**What's missing**

| Feature | Status | Missing |
|---|---|---|
| V4 Video safety | ◐ | Entering the drafted privacy label, Data Safety, age-rating answers and review notes in the store consoles; demo accounts for reviewers |
| V5 Party-screen video and voice | ☐ | All of it |
| V6 Media server | ☐ | Conditional; its listed tests (`useTableCall` unit tests, fake-camera browser test) are also missing |
| F5.1 Localization | ◐ | Localized store listings; the 360px screenshot pass |
| F5.5 Accessibility | ◐ | The VoiceOver/TalkBack audit (manual); localizing the in-game announcements with the rest of the table HUD |
| F5.6 Store listings | ☐ | All of it |

**Everything else is built:** F0.1–F0.4, F1.1–F1.7, P1–P8, V0–V3, F2.1–F2.6, F3.1–F3.7, F4.1–F4.5, F5.2.

Section 15 (R1–R11) holds proposals, not features, so it isn't tracked here. R11's PRD and handoff reconciliation is still open.

---

## 1. Positioning: how we win

We are not trying to out-content Ludo King. We aim to stand out on five things:

1. **Dice you can check.** Our online dice are already rolled on the server. We propose post-match verification of their recorded sequence against a commitment observed before play (F1.2). Ludo King advertises RNG certification; per-match seed verification was not identified in the reviewed sources.
2. **No ads, no betting.** No interstitial ads, no coin entry fees, no pots, no loot boxes. The PRD 3.3 guardrails stay in force for every feature below.
3. **Made for a real table.** The 3D apartment table, **Party Mode** (the table on a TV, phones as controllers: Section 6), voice and **video chat with faces on the seats** (Section 7), Table Together, and joining from a link with no install. We lean into family and friend nights, not strangers grinding coins.
4. **Your rules.** We let a private room's host choose explicit, visible house rules. Competitor modes and customization differ by product and version.
5. **Everyone can play.** Accessibility, localization, and fair handling of disconnects.

## 2. Engineering conventions for every feature

- **Every rule change is built twice.** Game rules live in `lib/board/*.ts` (client copy: offline practice and move highlighting) **and** in the plpgsql migrations (authoritative). Any new rule needs both, plus golden vectors in `tests/parity` and pgTAP coverage in `supabase/tests`. Budget for this in every Game Modes item.
- **Room rules are data.** Section 4, item F0.2 adds a single `rooms.rules jsonb` column. Every mode and house rule after it reads from that column instead of adding its own column or code path.
- **The server stays authoritative.** Clients send intents through RPCs. No new client-side decisions about rolls, moves, rewards or XP.
- **The event log is the source for stats.** `match_events` includes `dice_rolled`, `legal_move_selected` and `player_finished`. It does not yet record every fact required below: F0.3 must add match identity, initial snapshots and missed-decision events before stats, replay, XP and achievements can reliably derive from it (Section 15, R1).
- **Guests keep working.** Anything tied to an account (XP, friends, cosmetics) degrades gracefully for anonymous players. Anything that needs an account nudges them to sign in and never blocks play.
- **Next.js:** this repo runs a Next.js version with breaking changes. Read `node_modules/next/dist/docs/` before adding routes, i18n, or service workers.

## 3. Phase overview

| Phase | Theme | Features | Goal |
|---|---|---|---|
| 0 | Foundations | F0.1–F0.4 | Fair dice, a rules config, a stats pipeline, and the 13+ age check for online play |
| 1 | Quick wins | F1.1–F1.7 | Close the most visible gaps cheaply |
| Party | Party Mode (big screen + phone controllers) | P1–P8 | Can run alongside Phase 1 after rules, age and display-membership foundations; presets and mixed media have additional dependencies (Section 15, R8) |
| Video | Video chat: faces at the table | V0–V6 | Remote friends at the table. Ship V1 (TURN relay) right away. V0 (18+ check, after F0.4), V2, V3 and V4 must ship together |
| 2 | Game modes | F2.1–F2.6 | Match Ludo King's modes, then beat them with house rules |
| 3 | Progression and retention | F3.1–F3.7 | Reasons to come back tomorrow, without betting mechanics |
| 4 | Competitive and social | F4.1–F4.5 | Tournaments, team seasons, replays, spectating |
| 5 | Reach | F5.1, F5.2, F5.5, F5.6 | Localization, 6 players, accessibility, store listings; F5.3/F5.4 are moved placeholders |

---

## 4. Phase 0: Foundations

### F0.1 Unbiased dice ✅ · S
**Status (2026-09-30):** [`8387819`](https://github.com/muatasimqazi/playluddo/commit/8387819) — built.

**Also see (Section 15):** R2

**Problem:** online Ludo still rolls with `1 + (get_byte(gen_random_bytes(1), 0) % 6)` (historical definitions in `20260913222115_rpcs.sql:466` and `20260913225951_m3_timers_bots_reconnect.sql:93`; current Ludo definition in `20260918020000_snakes_and_ladders.sql:139`). No later migration fixes that Ludo path. 256 is not a multiple of 6, so faces 1–4 each have probability 43/256 and faces 5–6 each have 42/256. Snakes & Ladders already rejects bytes ≥252 in that same migration, lines 279–292. Offline `randomDie` also uses unbiased rejection sampling with `crypto.getRandomValues` (`lib/presentation/practice.ts:299–304`), not `Math.random`.
**Fix:** add one `private.roll_die()` function that uses rejection sampling (draw a byte, retry while it is ≥ 252, return `1 + byte % 6`). Every roll path calls it.
**Acceptance:**
- One `roll_die()` function, used by every Ludo and Snakes & Ladders roll path.
- Deterministic tests cover rejection and all 252 accepted byte values, with 42 values mapping to each face. Statistical sampling is a diagnostic with a documented threshold and false-failure policy, not the sole regression gate.
- Preserve and test the already-unbiased offline roll path.

### F0.2 Room rules config ✅ · M
**Status (2026-09-30):** [`d46bb58`](https://github.com/muatasimqazi/playluddo/commit/d46bb58) — built.

**Also see (Section 15):** R9

Add `rooms.rules jsonb not null default '{}'`, with a TypeScript `RoomRules` type and a SQL accessor holding the defaults. Every rule below becomes a key:

```ts
interface RoomRules {
  mode: "classic" | "quick" | "master" | "rush" | "team";
  bonusRollOnFinish: boolean;   // F1.5
  blockades: boolean;           // F2.4
  startOnBoard: 0 | 1 | 2 | 4;  // pawns placed on their entry cell at start (F2.1)
  pawnsToWin: 1 | 2 | 3 | 4;    // F2.1
  captureToEnterHome: boolean;  // F2.2
  turnSeconds: 10 | 15 | 30;    // F2.4
  matchMinutes: number | null;  // F2.3
}
```

**Acceptance:**
- The host sets rules in the lobby (the same pattern as `set_room_game`), and only before the match starts.
- A rematch keeps the rules.
- Quick match offers canonical Classic and Quick presets (Quick arrives with F2.1), both with finish bonuses on and blockades off. Team Up is not available in quick match (Section 12, decisions 1, 2 and 4).
- The rules are included in the room state JSON, and in the event payload at match start so replays stay correct.

### F0.3 Match stats pipeline ✅ · M
**Status (2026-09-30):** [`1292392`](https://github.com/muatasimqazi/playluddo/commit/1292392) — built.

**Also see (Section 15):** R1 · R8

Add a `private.match_stats(room_id)` function that derives, for each player: rolls, sixes, a histogram of faces 1–6, captures made, pawns lost, pawns finished, turns, missed decisions, and longest streak without a six. It derives from `match_events`, but the log doesn't yet record everything this needs: rematches reuse the room with no per-match id, and missed decisions change counters without an event. R1's additions come first. It is called at match completion, and its output is written to a `match_results` table (room_id, user_id, placement, stats jsonb, rules jsonb, finished_at).
This table feeds F1.1, F3.1, F3.2, F3.4 and F4.2. The existing `player_stats.wins` trigger becomes an aggregation over it.
**Acceptance:**
- Stats derived from the events match a parity fixture for a known game.
- Guests get a `match_results` row with a null `user_id`, so the summary still works for them.

### F0.4 Age check before online play ✅ · M
**Status (2026-09-30):** [`397a76f`](https://github.com/muatasimqazi/playluddo/commit/397a76f) · [`b5f939f`](https://github.com/muatasimqazi/playluddo/commit/b5f939f) — built behind the `online_age_check` flag, which is **off**. The 30-day cleanup of inactive under-13 guests runs as `purge-inactive-under13-guests` (pg_cron), and the privacy policy and terms describe the age check. Signing in as a guest now links the new sign-in to the guest (`lib/supabase/linkAccount.ts`, and the Game Center function server-side), so the answer carries over; an identity that already has an account signs in to it and nothing is copied (`tests/integration/account-link.test.ts`). Support corrections are built: `private.support_correct_age` sets or clears an answer for staff only, with an audit trail (`private.age_corrections`) that is deleted with the account. It's covered by pgTAP, and the procedure is in [`SUPPORT.md`](SUPPORT.md). The hosted project has manual linking and the `email_change` code template on, and the legal review for signed-in under-13 accounts is done (both confirmed 2026-09-30). The review applied the 30-day rule to them as well. They go through the `purge-under13-accounts` Edge Function, woken daily by the `purge-inactive-under13-accounts` cron job, which removes their profile photos before deleting the account. Guests are still deleted in SQL.

**Also see (Section 15):** R3 · R7 · R8

**Decided (Section 12, question 5):** online play is **13+**. Under-13s keep offline practice and Table Together. Video (V0) reuses this answer with an 18+ threshold.

**When we ask:** once per account, before the player's **first online table**: private room, link join, quick match, Party Mode controller, Party audience, or watching a live table. The question appears in the same flow as the "Keep the table friendly" agreement (`components/lobby/TableRules.tsx`), which today is remembered per device only. Players who already accepted the rules are asked their age once on their next online table.

**Guests are asked too.** Guests are anonymous Supabase users, so their answer is stored against that user id. **The answer carries over (built 2026-09-30):** signing in as a guest links the new identity to the guest, keeping the user id, for every sign-in path (web OAuth, native Apple and Google, email and phone codes, Game Center). When the identity already has an account, the guest signs in to that account instead and is asked there if it has no answer. Never copy an answer to an unrelated account.

**How we ask (a neutral age screen):**
- "What's your date of birth?" with month and year pickers. The screen doesn't say what age is required or pre-fill a year, and it isn't a yes/no "Are you 13?" question, which invites people to click yes.
- One line explains why: "We ask so we can keep online tables safe. We only keep your birth month and year."
- **The answer is final.** It can't be changed in the app; changing it goes through support. A device-level flag also remembers an under-13 answer, so the player can't immediately retry with a fresh guest session on the same device. This is a speed bump, not a guarantee.
- **Device flag (decided, Section 12, question 12):** the flag stores only the month the player turns 13 and lifts itself then. It blocks **new age answers** on that device; it never blocks an account that already has an eligible answer, so a parent signing in on a shared phone still plays. Support can clear a flag set by mistake.

**Eligibility boundary (decided, question 12):** we only know birth month and year, so a player becomes eligible on the **first day of the month after** the month they turn the minimum age. Someone born in March 2013 becomes 13+ on 1 April 2026. The same rule applies to the 18+ video threshold. Test the boundary on the last day of the birth month and the first day of the next.

**Rollout (decided, question 12):** matches already running when F0.4 launches finish normally. From launch, every new online participation needs an answer: creating or joining a room, joining by link, quick match, rematch, and reclaiming a seat. A player who was queued in quick match at launch is asked before being seated.

**Under 13:** "Online tables are for players 13 and older. You can still play against computers or pass-and-play with Table Together." The online buttons on the home page are replaced by those two options. A shared room link opens the same message instead of the lobby.

**What we store (keep it minimal):**
- A table in the `private` schema: `age_declarations(user_id, birth_year, birth_month, declared_at, source)`, with no client read access.
- `source` records how the age was established: `self_declared` now, platform signals later (see V0).
- Eligibility is computed on the server, so a player who is too young today **becomes eligible automatically** when they reach the minimum age.
- Clients only see booleans from `get_age_eligibility()` (`online`, `video`). Age never goes into room state, PostHog, or anything visible to other players.
- Deleted with the account: the table references `auth.users` with `on delete cascade`, so the existing `delete-account` function covers it.

**Under-13 answers (decided, Section 12, question 13):**
- Store **no birth month or year**. Keep only a marker with the month the player becomes eligible (`eligible_from`) and `declared_at`, so the same account can't simply answer again with a different age.
- Be accurate about what this saves: `eligible_from` still reveals the birth month to within a month. The meaningful reduction is deletion, below, not the choice of field.
- **Anonymous accounts** with an under-13 marker, and all their data, are deleted automatically after **30 days without activity** (a scheduled job). The device flag stays on the device only.
- When `eligible_from` arrives, the marker is deleted and the player is asked again as a new declaration.
- **Signed-in accounts** that answer under 13 hold personal data such as an email address. **Decided by the launch-market legal review (2026-09-30):** the same 30-day rule applies. They're deleted with everything tied to them, including profile photos, after 30 days without activity.
- Support can correct a mistaken answer through a documented, logged procedure.
- Nothing about an under-13 answer is sent to PostHog beyond an anonymous count.

**Enforced on the server:** `create_room`, `join_room`, `join_room_by_id` and `matchmake` reject players with no declaration or an under-13 declaration, with a specific error code the client turns into the age screen or the under-13 message. `create_party_room` is exempt: the screen has no seat, chat or voice, so it isn't asked (Section 12, question 8). Every phone that takes a seat is age-checked through the join path.

**Policy updates:** the privacy policy says we ask for birth month and year, why, and how long we keep it, and that online play is 13+. The terms state the minimum ages (13 online, 18 video).

**Acceptance:**
- Every path to an online table asks exactly once per account, and never again after an answer.
- An under-13 or undeclared player can't create, join or matchmake into an online table, even by calling RPCs directly (pgTAP).
- Offline practice and Table Together work with no age question.
- An answer given as a guest survives linking that guest to a new sign-in.

---

## 5. Phase 1: Quick wins

### F1.1 Full end-of-game summary ✅ · S (after F0.3)
**Status (2026-09-30):** [`a930b7c`](https://github.com/muatasimqazi/playluddo/commit/a930b7c) — built.

**Also see (Section 15):** R1 · R8

**Ludo King:** winner screen plus rewards.
**Ours:** PRD 5.3's promised stats: captures, sixes rolled, turns, pawns home, missed decisions. Plus two things of our own:
- **Dice chart:** each player's face histogram, next to the expected 1/6 line. This is the visible first step of the fair-dice story.
- **Moment of the match:** the biggest capture or comeback, picked from the events, with a button to replay it (uses the existing replay timeline).

**Files:** `components/summary/MatchSummary.tsx` and the in-scene completion view in `components/simulator/Simulator.tsx`.

### F1.2 Dice you can verify ✅ · M (after F0.1)
**Status (2026-09-30):** [`f3e7bf8`](https://github.com/muatasimqazi/playluddo/commit/f3e7bf8) — built.

**Also see (Section 15):** R2 · R8

**Ludo King:** advertises RNG certification; no per-match seed-verification feature was identified in the reviewed official sources.
**Ours:** a commit-reveal scheme.
- **At match start:** the server generates a secret 32-byte seed, stored in the `private` schema, and publishes `sha256(seed)` in the room state.
- **Each roll:** is derived as `HMAC-SHA256(seed, roll_sequence)`, reduced with rejection sampling.
- **At match end:** the seed is revealed. The summary has a "Verify dice" sheet that recomputes every roll in the browser and checks it against the events.
- **Caveat:** verification checks the recorded roll sequence against the commitment observed before play. It does not prove unbiased seed selection, availability of a reveal, or an independently authentic and complete history. The protocol details and security tests proposed in Section 15, R2 are prerequisites to this claim.

**Acceptance:**
- The browser verification passes for Ludo and Snakes & Ladders.
- Tampering with any logged roll fails verification.
- The seed is unreadable by any client role until the match ends (an RLS test).

### F1.3 Reactions and quick phrases ✅ · S
**Status (2026-09-30):** [`1ef5da2`](https://github.com/muatasimqazi/playluddo/commit/1ef5da2) — built.

**Ludo King:** advertises emojis in its inventory; the size of its emoji, sticker and phrase sets wasn't verified.
**Ours today:** 6 emoji (`Simulator.tsx`, reaction picker).
**Ours next:** 24 emoji in themed rows, plus 12 quick phrases ("Nice move!", "So close!", "Your turn", "Good game", "Hurry up 😅"…). Phrases are localized with F5.1. Reactions show as a 3D speech bubble over the player's seat, with a short animation.
Bonus: **table-aware reactions**, e.g. a one-tap "Revenge!" that appears only right after you were captured.
**Acceptance:**
- Rate limits and blocks apply exactly as they do for chat (see `send_table_message` and the moderation migration).

### F1.4 Computer opponents with difficulty levels ✅ · M
**Status (2026-09-30):** [`3ba2fbd`](https://github.com/muatasimqazi/playluddo/commit/3ba2fbd) — built.

**Ludo King:** offers play against the computer; whether it has difficulty levels wasn't established in the reviewed sources.
**Ours today:** one fixed-priority computer (`lib/board/bot.ts`), mirrored in SQL.
**Ours next:** Easy, Normal and Hard, for offline practice and Table Together only. Online computer players stay on the current SQL logic, so seats a computer takes over stay predictable.
- **Easy:** random legal move, with a bias towards leaving the nest.
- **Normal:** the current logic.
- **Hard:** scores each move by danger (how many opponent pawns are within 1–6 cells behind the destination), preference for safe cells, captures, progress, and whether it opens a pawn from the nest. It uses a one-roll expectation search.

**Acceptance:**
- Hard beats Normal in at least 65% of simulated 4-player games (add a simulation script under `scripts/`).
- Difficulty is shown in the practice setup wizard and remembered per device.

### F1.5 Extra roll for getting a pawn home (house rule) ✅ · S (after F0.2)
**Status (2026-09-30):** [`d46bb58`](https://github.com/muatasimqazi/playluddo/commit/d46bb58) — built.

**Also see (Section 15):** R9

**Competitor baseline:** the reviewed sources do not establish Ludo King's finish-bonus rule. Our default is a product decision, not a verified parity claim.
**Ours today:** no extra roll (a PRD 4.2 decision).
**Ours next:** a `bonusRollOnFinish` rule in both engines, plus parity vectors. **Default: on** (decided, Section 12 question 1), so this reverses PRD 4.2. Update `earnsBonusRoll` in `lib/board/rules.ts` and its SQL mirror, keeping the rule that a roll never earns more than one bonus. Update the How to play page (F1.6) and the PRD.

### F1.6 How to play, and a first-game guide ✅ · S
**Status (2026-09-30):** [`d83190f`](https://github.com/muatasimqazi/playluddo/commit/d83190f) — built.

**Ludo King:** its official FAQ describes tutorial videos accessible from game settings.
**Ours:**
- A `/how-to-play` page for Ludo and Snakes & Ladders, which shows **this room's** house rules when opened from a table.
- A first practice game with contextual tips: "Roll a 6 to leave your base", "Stars are safe", "Capture to earn another roll". Each tip appears once and can be dismissed.
- Also reachable from the in-game Controls & shortcuts panel.

### F1.7 Push notifications ✅ · M
**Status (2026-09-30):** [`316c5fb`](https://github.com/muatasimqazi/playluddo/commit/316c5fb) — built behind the `push_notifications` flag, which is **off**.

**Also see (Section 15):** R6 · R8

**Ludo King:** reminders and friend requests.
**Ours:** notifications that are useful, never nagging:
- "Your turn" is sent only when the app is in the background and the turn has been waiting for more than 5 seconds.
- "A friend opened a table", "Your team is playing".
- The rematch vote ending.

**Implementation:**
- **iOS and Android:** `@capacitor/push-notifications` with APNs and FCM.
- **Web:** a service worker for Web Push.
- **Server:** a `push_tokens` table, and a Supabase Edge Function triggered from the turn-change and invite paths.

**Acceptance:**
- Each notification type can be switched off separately in Preferences.
- No marketing pushes.
- Quiet hours are respected.

---

## 6. Party Mode: the big screen, with phones as controllers

**Ludo King:** supports local pass-and-play, browser play and Android TV. A shared TV with separate phone controllers was not established by the reviewed sources; broader market exclusivity is unverified.
**Ours:** play the way Jackbox party games work. The 3D table runs on a TV or laptop that everyone in the room can see. Each person picks up their own phone, scans a QR code, and plays from it with **no app, no sign-up, no install**. Controllers still use anonymous authentication and the 13+ age check. This fits our table-first pillar.

The experience in one paragraph: someone opens **playluddo.com/screen** on a TV or on a laptop connected to one. The screen shows a large room code and a QR code. Phones scan it, enter a name and pick an avatar, and appear around the 3D table. The first phone to join is the **VIP**: they choose the game, the house rules, and when to start. During play the TV shows the cinematic table. Each phone shows only what that player needs: a big roll button, their pieces, and reactions. Up to 4 people play, and everyone else can join as **audience**.

### Architecture

- **The screen is a new kind of room member.** Today only seated players receive the room channel (RLS on `realtime.messages`) and can call `get_room_state`. Add a `room_displays` table (room_id, user_id of an anonymous auth user, created_at). Update the realtime and room-state policies so a display can **read** everything but call no roll, move or chat RPCs. Build this once. F4.4 (watching live tables) and P6 (audience) reuse the same read-only path.
- **The phones are ordinary seats.** They join through the existing link-with-a-name flow (`join_room_by_id`), and roll and move through the existing `request_roll` and `request_move` RPCs. Nothing about the rules engine changes.
- **The room is marked as a party room:** `rules.party = true` (F0.2). Clients use that flag to decide what to render. Party rooms get their own defaults (P7).
- **Routes use query parameters,** because the static iOS/Android export can't pre-render dynamic path segments (see `app/room/page.tsx`):
  - `/screen` creates a party room.
  - `/screen?id=…` reconnects the screen to an existing party room.
  - Phones use the normal `/room?id=…`. When the room is a party room, that page renders the controller instead of the 3D scene.
- **Sound:** comes from the screen. Phones default to haptics only, with an option to turn their own sound on.

### P1 Screen: create and pair ✅ · M
**Status (2026-09-30):** [`da5b8b1`](https://github.com/muatasimqazi/playluddo/commit/da5b8b1) — built.

**Also see (Section 15):** R4 · R8

- `create_party_room()` RPC: creates a lobby room with **no host seat**, registers the caller as its display, and returns the room id and code. The caller is an anonymous session; no sign-in or age check is needed (Section 12, question 8).
- The lobby screen shows the room code in large type, a QR code for `/room?id=…`, and the short URL `playluddo.com/join`. Seats fill in live, with avatars. A "waiting for the VIP to start" hint follows.
- The QR code stays in a corner during play so late arrivals can join as audience.
- Keep the TV and every phone awake with the Screen Wake Lock API.
- **Dependency:** a small QR generator package (choose one when implementing).
**Acceptance:**
- A display can't roll, move, chat or take a seat (pgTAP).
- Reloading the screen reconnects it to the same room.

### P2 VIP controls ✅ · S
**Status (2026-09-30):** [`be688aa`](https://github.com/muatasimqazi/playluddo/commit/be688aa) — built.

**Also see (Section 15):** R4 · R8

- The first phone to take a seat becomes the host (`host_player_id`). The VIP is shown with a crown on the TV.
- From the phone, the VIP picks Ludo or Snakes & Ladders, a house-rules preset (F2.4), and fills empty seats with computers, then starts the game.
- If the VIP leaves, the role passes to the next seat.

### P3 Phone controller ✅ · L
**Status (2026-09-30):** [`39c8a10`](https://github.com/muatasimqazi/playluddo/commit/39c8a10) — built.

**Also see (Section 15):** R4 · R8

New `components/controller/` UI, shown when a seated player is in a party room:
- **Your turn:** the whole phone becomes a big **Roll** button, with a haptic buzz (`@capacitor/haptics` in the app; `navigator.vibrate` on the web where supported) and a colour flash.
- **Shake to roll:** optional; asks for iOS motion permission.
- **Choosing a piece:** a 2D mini-board of your colour, with legal pieces glowing, plus the numbered piece buttons that already exist. Tapping a piece previews its move on the **TV** before you confirm.
- **Waiting:** your pieces' progress, the current player, and a reaction pad.
- Accessible and one-handed, with 44px minimum targets and reduced motion respected.
**Acceptance:**
- A full 4-phone game on one TV runs without anyone needing to look at another player's phone. Looking at the shared TV is the point.
- A roll registers within 300 ms round-trip, with a pending state shown.

### P4 The TV view ✅ · M
**Status (2026-09-30):** [`aca78c6`](https://github.com/muatasimqazi/playluddo/commit/aca78c6) — built.

**Also see (Section 15):** R4 · R8

The existing `Simulator` in a **screen** variant:
- No local seat, and the action camera on by default, with cinematic framing for captures and finishes.
- Oversized names, turn ring and reactions that are readable from a sofa about 3 m away. Reactions appear large over the seat that sent them.
- The TV shows the countdown to the turn timeout.
- **Performance:** TV browsers are weak, so the screen defaults to the lowest quality preset and steps up if frame rate allows. The recommended setup is a laptop over HDMI, AirPlay, or Chromecast screen sharing.

### P5 Reconnecting phones ✅ · S
**Status (2026-09-30):** [`9061bc5`](https://github.com/muatasimqazi/playluddo/commit/9061bc5) — built.

**Also see (Section 15):** R4 · R8

Phones lock and apps get backgrounded far more often at a party:
- Controllers reclaim their seat automatically on unlock (the existing reclaim path).
- In party rooms, a disconnected phone **pauses the table for up to 2 minutes** instead of handing the seat to a computer after 45 seconds. A computer takes over only after that.
- The TV shows who it is waiting for.

### P6 Audience ✅ · M
**Status (2026-09-30):** [`eebbcc1`](https://github.com/muatasimqazi/playluddo/commit/eebbcc1) — built.

**Also see (Section 15):** R3 · R4 · R7 · R8

Jackbox's best idea: everyone in the room gets to join in, not only the 4 players.
- Once the seats are full, further phones join as **audience** (a `room_displays` role, `audience`).
- **Audience phones must be 13+** and pass the age check (F0.4), like players (decided, Section 12, question 15). They also see the short Party agreement (decision 7).
- Audience phones can:
  - send reactions to the TV
  - vote for **Moment of the match** at the end
  - make a **winner prediction** before the start, for bragging rights only: no stakes, no rewards of value
- The audience **never** affects the rules or the dice.
- Voting goes through a rate-limited RPC (the same pattern as `send_table_message`).

### P7 Party defaults and safety ✅ · S
**Status (2026-09-30):** [`ac11d73`](https://github.com/muatasimqazi/playluddo/commit/ac11d73) — built.

**Also see (Section 15):** R3 · R4 · R7 · R8

- **Defaults:** 30-second turns, pausing on disconnect (P5), extra roll for getting home, and a Family preset.
- **Chat off, voice off:** everyone is in the same room.
- **Agreement:** phones see the short one-tap version of the table rules plus the age question (F0.4). Mixed rooms with remote voice (P8) use the full agreement.
- **Names** are still filtered and can still be reported.
- **Room access:** party rooms are private by link or QR only and never appear in quick match.
- The screen can **lock the room** once the game starts, so only audience can join.

### P8 Stretch: mixed rooms and party extras ✅ · L
**Status (2026-09-30):** [`9802f10`](https://github.com/muatasimqazi/playluddo/commit/9802f10) · [`ddbf3a6`](https://github.com/muatasimqazi/playluddo/commit/ddbf3a6) — Party-screen camera and microphone are V5, not built.

**Also see (Section 15):** R3 · R4 · R5 · R7 · R8

- **Mixed rooms:** some players are at the TV and others play remotely on the normal 3D view with voice chat. Voice for the whole living room can go through the screen device's microphone only when a signed-in 18+ operator authorizes it (V5, Section 12, question 11). Otherwise living-room players join voice from their own phones.
- **Between-game rounds:** a 60-second phone mini-game while the TV shows the podium, such as "guess the final dice total". Purely social.
- **Native TV apps** (tvOS, Android TV) if the web screen proves popular. Capacitor does not target tvOS, so this would be separate work.

**Tests:**
- A pgTAP suite for display and audience permissions.
- An integration test in `tests/integration` with one screen and two controller clients, checking that the screen gets every update and can perform only its listed display actions, such as locking the room (R4).

---

## 7. Video chat: faces at the table

**Ludo King:** live video support and video-bubble presentation were not substantiated by the reviewed sources. Its official features page advertises voice chat. Treat our video feature as a product choice, pending any platform/version-specific competitor evidence.
**Ours:** remote friends **sit at the table with you**. Each player's live camera appears on their seat's 3D figure (`PlayerAvatar3D`), where their avatar photo goes today. A 2D tile strip is the fallback on small phones. It is built for friends and family who can't be in the same room, which pairs with Party Mode for those who can.

**Where it's available:** private rooms (friends by link, teams, and remote players in a mixed Party room). **Never in quick match or other public tables.** The camera is off by default, and each person turns their own camera on. **Only players who have confirmed they are old enough can use video** (V0).

### Where we are today

- `lib/hooks/useVoiceChat.ts` is an audio-only call where every player connects directly to every other player. That's at most 3 connections per person, which is fine for 4 seats. Connection setup messages go through the `send_webrtc_signal` RPC on the room channel. Who is in the call comes from `players.in_voice` in the room state.
- **ICE uses a public STUN server only, with no TURN relay.** Behind strict home routers and mobile carriers, a direct connection often can't be made. Some voice calls already fail today, and video will make the failures obvious.
- **Blocking:** a blocked player stays connected but is muted locally. For video, that's not enough (see V4).
- **Permissions:** the iOS and Android apps only request microphone access, not camera.
- **Privacy policy:** `app/privacy` says voice goes directly between devices and is never recorded. It must be updated for video, and for any relay or media server we add.

### V0 Age check before video ✅ · S (after F0.4)
**Status (2026-09-30):** [`313b54a`](https://github.com/muatasimqazi/playluddo/commit/313b54a) — built behind the `video_chat` flag, which is **off**.

**Also see (Section 15):** R3 · R5 · R8

**Rule (decided, Section 12, question 5):** video is **18+**. Only eligible players can send **or** receive video. Everyone else keeps voice, chat and the full game.

**Minimum age:** set by a single server-side setting, `VIDEO_MIN_AGE = 18`. Legal review per launch market; where local law sets a higher age, the higher one applies.

**No second question.** Every online player has already given their birth month and year (F0.4). Video eligibility is computed from that same answer: `get_age_eligibility().video`. A player who turns 18 becomes eligible automatically.

**Signed-in players only.** Guests have an age answer but still can't use video. Tapping **Turn on camera** as a guest asks them to sign in first, so every video block and report is tied to a real account.

**Enforced on the server, not only in the UI:**
- `set_camera_on` rejects ineligible players.
- `send_webrtc_signal` should authorize video negotiation against the whole table's eligibility and room type, not just the two endpoints. Rejecting video SDP is a defense for the supported protocol; it cannot guarantee that colluding modified clients never exchange imagery through other signaling or data channels. **Decided (Section 12, question 10):** our guarantee covers supported apps only, over direct connections. The privacy policy, terms and store review notes must describe it that way, never as protection against modified apps. Signaling controls are in Section 15, R5.
- **The whole table has to qualify.** Video is only available when **every human seated** is signed in and eligible. Otherwise the camera button reads "Video isn't available at this table", without saying who or why, so no one's age is revealed. Computer players don't count.

**Stronger signals later (evaluate):**
- Apple and Google have been adding platform age-range signals for apps, such as Apple's Declared Age Range API and Google Play's Age Signals API. Where available in the iOS and Android apps, use them to confirm or override a self-declared age and record the `source`.
- We don't plan ID scans or face-based age estimation unless the law in a market we serve requires them. They carry privacy costs we'd rather not take on.

**Acceptance:**
- No age question appears when turning on the camera; eligibility comes from F0.4.
- Supported video sessions reject under-age or guest participants. pgTAP covers camera authorization and signaling; browser tests cover media delivery and revocation. No guarantee is made about modified clients (Section 12, question 10).
- A table with one ineligible or guest player offers no video to anyone, and the copy doesn't identify that player.
- A player who reaches the minimum age becomes eligible with no further action.
- Deleting the account removes the declaration.
- The privacy policy explains that we ask for birth month and year, why, and how long we keep it.

### V1 Reliable connections: a TURN relay ✅ · S–M
**Status (2026-09-30):** [`313b54a`](https://github.com/muatasimqazi/playluddo/commit/313b54a) — the `ice-servers` Edge Function mints short-lived Twilio TURN credentials, falling back to STUN only. Each peer connection reports one `call_ice_outcome` PostHog event (`connected` or `failed`, whether TURN was offered, the winning candidate type, time to connect), so the failure rate is failed ÷ (connected + failed). Production now has `TWILIO_AUTH_TOKEN` (set 2026-10-01), so the relay is offered. The PostHog insights exist: [failure rate](https://us.posthog.com/project/619862/insights/3lmMiKq9) and [by TURN](https://us.posthog.com/project/619862/insights/30DZf1Kp), created by `scripts/posthog-ice-insights.mjs`. **Marked done without the cellular check (decision, 2026-10-01):** no voice call between two phones on separate cellular networks has been made, and no `call_ice_outcome` events had arrived when it was closed. Run that check, then `node scripts/posthog-ice-insights.mjs --check`, when phones are available. The <2% target can only be judged once real calls come in.

**Also see (Section 15):** R5 · R6

When two devices can't connect directly, a TURN server relays their media. Add a managed TURN service (for example Cloudflare's TURN service or Twilio's Network Traversal; pick one when implementing). Issue short-lived credentials from a Supabase Edge Function, fetched at join time, and never ship static credentials in the client.
This fixes voice first. Ship it on its own, before any video work.
**Acceptance:**
- Voice connects between two phones on separate cellular networks.
- ICE failures are tracked in PostHog, with the failure rate below 2% after launch.

### V2 Camera in the call ✅ · M
**Status (2026-09-30):** [`313b54a`](https://github.com/muatasimqazi/playluddo/commit/313b54a) — `useVoiceChat` generalized into `useTableCall`; native camera permissions added.

**Also see (Section 15):** R5 · R6 · R8

- Generalize `useVoiceChat` into a `useTableCall` hook with one audio track and one optional video track.
- Create a video transceiver only for an authorized video-capable table. Audio-only tables must negotiate without a video section so V0's rejection does not break voice. Camera toggles may use `replaceTrack` within the negotiated envelope; eligibility changes, reconnections and negotiation failures still need explicit handling (Section 15, R5).
- Send small video: 320×240 at 15 fps, capped at about 300 kbps per connection. Lower it further when frame rate drops or the network is congested.
- Add `players.camera_on boolean` to the room state JSON, the same pattern as `in_voice`.
- Native permissions: add `NSCameraUsageDescription` (iOS) and `android.permission.CAMERA` (Android), with plain-language reasons.
**Acceptance:**
- Turning the camera on or off updates for everyone within 1 second.
- A 4-way video call over 10 minutes keeps the 3D scene at ≥ 30 fps on a recent phone, or falls back automatically (V3).

### V3 Video in the 3D table ✅ · L
**Status (2026-09-30):** [`313b54a`](https://github.com/muatasimqazi/playluddo/commit/313b54a) · [`e2706e5`](https://github.com/muatasimqazi/playluddo/commit/e2706e5) built the 2D strip; [`aa4303f`](https://github.com/muatasimqazi/playluddo/commit/aa4303f) added:
- **3D video:** on a larger screen, each remote camera is a lit card above its seat figure (`VideoCard` in `PlayerAvatar3D.tsx`). The card turns about the vertical axis to face you, so the players beside you are as readable as the one across. A card is used rather than the face because side seats show their faces edge-on. Tapping a card opens the enlarged view with Report and Block. Your own camera stays a mirrored preview in the HUD.
- **Fallbacks:** phones use the 2D strip. A table that holds under 24 fps for three 2-second windows with cards up drops to the strip for the rest of the visit.
- **Off-screen pausing:** cards off camera, and strip tiles scrolled out of view, stop drawing frames. The receiver still receives and decodes; truly stopping that would need the sender to pause (V6).
- **Mobile data:** a one-time warning appears before the camera starts, where the browser reports mobile data (Chrome on Android, the Android app). The camera then sends 240×180 at 12 fps and ~150 kbps.
- **A V2 bug fixed along the way:** the answering side of each call added its own video transceiver, which WebRTC never pairs with the offer. So its camera went out unnegotiated and only one direction of video worked. It now adopts the offer's transceiver.

Verified with two headless Chromes (fake cameras) at a local private table: video both ways, card tap to the enlarged view, hide-all, the phone strip, the CPU-throttled fallback, and the cellular warning and quality.

**Also see (Section 15):** R5 · R6 · R8

- **In 3D:** each remote camera is a three.js `VideoTexture` on the seat figure's face or portrait card, lit so it matches the scene. Your own camera shows as a small mirrored preview in the HUD.
- **Fallback:** on small screens, or when frame rate drops (the Simulator already lowers pixel ratio under load), switch to a 2D strip of video tiles above the controls. If that isn't enough, pause decoding video for players off-screen.
- **Controls:**
  - camera on or off
  - flip between front and back cameras on phones
  - mute
  - hide everyone's video (audio only, for low data)
  - tap a face to enlarge it
- **Mobile data:** a one-time warning before using video on a cellular connection, where the browser can detect it. Lower quality by default on cellular.
- **Reduced motion:** no animated camera framing around video tiles.

### V4 Safety ◐ · M
**Status (2026-09-30):** [`313b54a`](https://github.com/muatasimqazi/playluddo/commit/313b54a) — blocking is enforced at the sender (`replaceTrack(null)` in `useTableCall`), one tap hides all incoming video, and every remote video tile (and its enlarged view) carries **Report** and **Block**. Report opens the table's `player_reports` form, which notes that video is never recorded. The privacy policy and terms cover camera, video, the TURN relay and the 18+ rule. Missing: the App Store privacy label and Play Data Safety updates, and store review notes. The App Store, Play Store and review-note text is drafted in [`STORE_DISCLOSURES.md`](STORE_DISCLOSURES.md) ([`a680577`](https://github.com/muatasimqazi/playluddo/commit/a680577)). It still has to be entered in the consoles. Video should stay off until it is.

**Also see (Section 15):** R5 · R7 · R8

Video carries the highest risk of any feature here. Everything below must ship before video is switched on for anyone.
- **Blocking is enforced where the video is sent.** In a direct call, each person sends a separate stream to each other person. For a blocked player (in either direction), stop sending both audio and video to them (`replaceTrack(null)` on that connection). Their device never receives your media. Local hiding is not enough.
- **Report from the video tile.** Reports reuse the moderation flow (`player_reports`). Report and block controls sit directly on every video tile. We never record video, so reports describe what happened, and the policy says so.
- **Quick hide:** one tap turns off all incoming video.
- **Age:** enforced by V0. Video is signed-in and age-checked only; guests never get it, so every block and report is tied to an account.
- **Update the policies:** privacy policy (camera access, and that media is not recorded and goes directly between devices or through a relay without being stored) and terms. Update the App Store privacy "nutrition label".
- **Store review:** private-room restrictions reduce exposure but do not guarantee approval. Complete platform-specific UGC review, moderation readiness, age-rating questionnaires, Apple privacy disclosures and Google Play Data Safety/target-audience declarations. Explain the actual controls in review notes (Section 15, R7).

### V5 Video and voice on the Party screen ☐ · L (after P4, P8 and V0–V4)
**Status (2026-09-30):** not started.

**Also see (Section 15):** R5 · R8

**Decided (Section 12, question 11):** the Party screen can use its microphone and camera, and show remote players' video, **only when a signed-in, 18+ operator authorizes it**. The anonymous screen from decision 8 stays media-free.

- **Operator sign-in without typing on a TV:** the screen shows a code; the operator approves it from their own signed-in phone ("Use this screen for video and voice"). The operator must be a non-anonymous account that passes V0 (18+). The screen then acts on that operator's behalf and loses the permission when they sign out, leave, or the room ends.
- **Same table rule as V0:** screen media is only available when **every seated human** is signed in and 18+, and that includes the living-room controllers. A family playing with anyone under 18, or with guests, gets no video; voice follows the normal voice rules. The screen's camera button says "Video isn't available at this table" without naming anyone.
- **What it does:**
  - Remote players' faces appear large on the TV around the table.
  - The screen's microphone carries the living room's voice to remote players (P8).
  - Optionally, the screen's camera shows the living room to remote players.
- **Bystanders:** a room camera captures everyone in view, not only players. The operator must confirm, each time the camera is turned on, that everyone in view is 18+ and agrees to be on camera. This is a stated operator responsibility, not something we can verify, and the terms must say so.
- **Always visible:** while the screen's mic or camera is on, the TV shows a persistent indicator ("Living-room camera on · shared by *operator*"), and remote players see the same label on that video. Off by default, and off again at the start of every game.
- **Accountability:** reports about screen media go against the operator's account. Blocking the operator stops the screen's media reaching the blocker, as in V4.
- **Controllers still send no video.** Living-room phones stay controllers only.

### V6 Media server, only if needed ☐ · L
**Status (2026-09-30):** not started (conditional on measurements). The tests listed under V6 are also missing: `useTableCall` state-machine unit tests and the two-client fake-camera browser test.

**Also see (Section 15):** R5 · R6

Direct connections between four players are a candidate architecture, subject to device, thermal and network measurements. The threat model doesn't require a media server (Section 12, question 10). Evaluate a media server (an SFU; LiveKit or Cloudflare's realtime media service are possible options) if:
- audience video or more than 4 people on video is needed, or
- measured call quality on phones is poor (dropped frames, battery drain, heat).

A media server means video passes through infrastructure operated by us or a provider. Specify actual processing, storage and logging behavior and update the privacy policy accordingly.

**Tests:**
- Unit tests for the `useTableCall` state machine (joining, camera on or off, blocking mid-call).
- A browser-automation test using fake camera and microphone devices (Chromium's `--use-fake-device-for-media-stream`) that runs two clients and checks video reaches only non-blocked peers.
- A manual test matrix: iOS Safari, iOS app, Android Chrome, Android app, desktop Chrome and Safari, on Wi-Fi and cellular.

---

## 8. Phase 2: Game modes

All modes use F0.2's `rooms.rules` and ship in both engines with parity tests.

### F2.1 Quick mode ✅ · M
**Status (2026-09-30):** [`8ff02a3`](https://github.com/muatasimqazi/playluddo/commit/8ff02a3) — built.

**Also see (Section 15):** R9

**Ludo King:** "a fast game to finish quickly".
**Ours:** `mode: "quick"` with `startOnBoard` set to 1 and `pawnsToWin` set to 2 (both adjustable in a private room). The target is a median game under 7 minutes, measured with PostHog.
Quick match gets a Classic/Quick choice.

### F2.2 Master mode ✅ · M
**Status (2026-09-30):** [`0e00498`](https://github.com/muatasimqazi/playluddo/commit/0e00498) — built.

**Also see (Section 15):** R9

**Competitor baseline:** Ludo STAR's current listing mentions capture-before-home, but names Classic, Arrow and Blitz rather than Master. Ludo Club's cited listing does not establish this capture rule. “Master” below is our mode name.
**Ours:** `captureToEnterHome`. A `players.has_captured` flag is set on the first capture. Pawns that aren't eligible stop at the entry to the home lane, and the move is still legal. Opponent seat labels show a "can enter home" marker.

### F2.3 Rush mode (timed) ✅ · M
**Status (2026-09-30):** [`ac3b702`](https://github.com/muatasimqazi/playluddo/commit/ac3b702) — built.

**Also see (Section 15):** R9

**Ludo Club:** games with a time limit.
**Ours:** `matchMinutes` set to 5 or 10. When the clock runs out, players are ranked with the existing `rankPlayers` (pawns home, then total progress), which already supports this. A table clock appears in the HUD, and the last 30 seconds get a sound cue.
**Edge cases:**
- The clock stops while the match is paused.
- The turn in progress finishes before the game ends.

### F2.4 House rules panel ✅ · L
**Status (2026-09-30):** [`316b5b6`](https://github.com/muatasimqazi/playluddo/commit/316b5b6) — built.

**Also see (Section 15):** R9

**Ludo King:** offers several named modes (Classic, Quick, Team Up and others); per-room rule customization wasn't established in the reviewed sources.
**Ours (the differentiator):** a lobby panel where the host turns rules on or off:
- Extra roll for getting home (F1.5)
- Blockades: two of your pawns on the same non-safe cell block opponents from passing
- Pawns that start on the board
- Pawns needed to win
- Must capture before going home (F2.2)
- Turn timer: 10, 15 or 30 seconds

Presets: **Classic**, **Quick**, **Master**, **Family** (30-second timer, extra roll for getting home).
Everyone sees a one-line summary of the rules in the lobby and in the table menu.

**Which combinations are allowed (decided, Section 12, question 14):**
- Hosts pick a preset, then may change toggles only into combinations on a server-side **allow-list**. Anything not on the list is rejected by the server and greyed out in the panel, with a short reason.
- A combination joins the allow-list only after its edge-case fixtures (R9) are written, agreed, and pass in both engines and the parity suite.
- **Launch allow-list:** the four presets, plus single-toggle changes to Classic (blockades on, extra roll for getting home off, turn timer). Other combinations are added over time, ordered by how often hosts ask for them.
- The allow-list is versioned data, so adding a combination needs no client release.
- **Size:** L rather than M, because blockades need logic in both engines, not just a panel (R8).

### F2.5 Team Up (2v2) ✅ · L
**Status (2026-09-30):** [`09aa384`](https://github.com/muatasimqazi/playluddo/commit/09aa384) · [`0c2dc5f`](https://github.com/muatasimqazi/playluddo/commit/0c2dc5f) · [`69e4877`](https://github.com/muatasimqazi/playluddo/commit/69e4877) — built.

**Also see (Section 15):** R9

**Ludo King:** 2v2 team games.
**Ours:**
- Partners sit opposite each other (red + yellow, green + blue). They cannot capture each other and can share a cell safely.
- A team wins when all 8 of its pawns are home.
- Once your own pawns are all home, you roll and move your partner's pawns.
- Partners get **team voice or text** in addition to table chat.
- Private teams (the `teams` table) can start 2v2 games straight from the team card.
- **Where it's available (decided, Section 12, questions 4 and 9):** private rooms, team rooms and Party Mode from launch. Not in quick match. In Party Mode, partners share a colour glow on the TV.

**Schema:** add `players.side smallint`.
**Acceptance:**
- Parity vectors cover partner protection and moving your partner's pawns.
- The summary shows team results.

### F2.6 Snakes & Ladders variants ✅ · S
**Status (2026-09-30):** [`7335171`](https://github.com/muatasimqazi/playluddo/commit/7335171) · [`867205f`](https://github.com/muatasimqazi/playluddo/commit/867205f) — built.

**Also see (Section 15):** R9

Small additions that are only rule keys:
- "Any roll to start" versus "six to start" (the current rule)
- "Bounce back" on overshooting 100
- A second board layout

---

## 9. Phase 3: Progression and retention

Rule for this whole phase: **everything is earned by playing, nothing is bought with a random outcome.** No loot boxes, no coins, no energy timers.

**What counts (decided, Section 12, question 17):** XP, levels, streaks, account achievements, leaderboards and team season standings come only from **completed online games whose result the server recorded** (`match_results`), with these anti-farming limits:
- **Humans required for full credit:** at least one other human at the table. Games with only computer opponents earn reduced credit.
- **Short custom rules earn less:** rule combinations that make games trivially short, such as 1 pawn to win, earn reduced credit. The credit per preset or combination lives in the same versioned data as the F2.4 allow-list.
- **Repeat games tail off:** credit diminishes after many games against the same opponents in one day.
- **Nothing for quitting:** abandoned games and seats played mostly by the takeover computer earn nothing.
- **Idempotent:** each award has a unique key, so a retry or duplicate completion never pays twice.

**Offline games are local only (decided):** practice and Table Together can show stats and achievements on that device, but never add to account XP, leaderboards, trophies or team standings. The exact thresholds (how short is "trivially short", when repeat credit tails off) are set in R10's design and tuned from data.

### F3.1 Player profile and stats ✅ · M (after F0.3)
**Status (2026-09-30):** [`e79106e`](https://github.com/muatasimqazi/playluddo/commit/e79106e) — built.

**Also see (Section 15):** R1 · R7 · R10

Profile page: games played, win rate by mode, total captures, sixes, a head-to-head record against friends, best comeback, and favourite colour. Shown to others from a seat's avatar at the table, with a privacy setting to hide it.

### F3.2 XP and levels ✅ · M (after F0.3)
**Status (2026-09-30):** [`c30fe02`](https://github.com/muatasimqazi/playluddo/commit/c30fe02) — built.

**Also see (Section 15):** R1 · R10

XP is earned for finishing games (more for winning, and for playing with friends), with a daily first-win bonus. Levels are shown on seats. The existing `players.level` column is a placeholder waiting for this.
**Acceptance:**
- XP is granted only on the server, from `match_results`.
- Quitting a game earns nothing.
- Credit follows the "What counts" rules at the top of this phase: reduced against computers only, reduced for trivially short rules, diminishing for repeats, nothing offline.

### F3.3 Daily streak ✅ · S
**Status (2026-09-30):** [`41793cc`](https://github.com/muatasimqazi/playluddo/commit/41793cc) — built.

**Also see (Section 15):** R1 · R8 · R10

A streak for playing at least one game a day, rewarding cosmetics at streak milestones (3, 7, 30 days). Streak freezes are earned, never sold. No spin wheel.

### F3.4 Achievements on every platform ✅ · M
**Status (2026-09-30):** [`4508d29`](https://github.com/muatasimqazi/playluddo/commit/4508d29) — built.

**Also see (Section 15):** R1 · R8 · R10

**Today:** 5 achievements, iOS Game Center only (`lib/gameCenter.ts`).
**Next:**
- An `achievements` table in Supabase, evaluated from `match_results`, with around 30 achievements ("Triple capture", "Win without losing a pawn", "Win from last place", "10 games with your team"…).
- Shown on the web and Android, and mirrored to Game Center on iOS.
- **Follow-up from decision 17:** today `components/simulator/Simulator.tsx:385` reports **offline practice wins** to Game Center: the Wins leaderboard plus the first-win, Ludo/Snakes-win and ten-wins achievements. When F3.4 ships, Game Center should mirror only eligible online results. Scores and achievements already reported can't be taken back, so either start a new Wins leaderboard ID for online wins only, or keep the existing one labelled as all wins. Decide this before F3.4 ships.

### F3.5 Earned cosmetics ✅ · L
**Status (2026-09-30):** [`150fffe`](https://github.com/muatasimqazi/playluddo/commit/150fffe) — built.

**Also see (Section 15):** R8 · R10

**Ludo King:** advertises an inventory of themes, dice and emojis; how much is bought versus earned wasn't verified.
**Ours:** unlocked through levels, achievements and streaks. Types:
- **Dice skins:** glass variants, wood, marble.
- **Piece styles:** pieces separate from board designs, with the constraint that they must remain identifiable.
- **Board designs:** new art. Every board is free to everyone for now (changed 2026-10-02), including the Bazaar (with its own lantern pieces) the Rug, a Persian/Balochi rug (with wool-spindle pieces), and the Mosaic, glazed star tilework (with glazed-tier pieces); these three are meant to be earned by playing once there are more players.
- **Room themes:** café, rooftop, lake cabin. This is our unique 3D advantage.
- **Reaction packs.**

**Schema:** a `cosmetics` catalog and a `player_cosmetics` table.
Equipped items are visible to everyone at the table. Colour-dependent cosmetics must pass F5.5's colour-blind checks.
Nothing is sold for now; every cosmetic is earned (decided, Section 12, question 3).

### F3.6 Friends and who's online ✅ · L
**Status (2026-09-30):** [`078b637`](https://github.com/muatasimqazi/playluddo/commit/078b637) — built.

**Also see (Section 15):** R3 · R7 · R10

**Ludo King:** its FAQ describes playing with Facebook friends; other friend-list features weren't verified.
**Ours:**
- A `friendships` table, filled by requests by code or from a recent table ("Add friend" on a seat).
- Supabase Realtime Presence shows who is online now or at a table.
- **Invite to table** sends an in-app notice and a push (F1.7), and joins them in one tap.
- Blocks (from the moderation migration) hide the blocked player everywhere.

### F3.7 Recently played ✅ · S
**Status (2026-09-30):** [`078b637`](https://github.com/muatasimqazi/playluddo/commit/078b637) — built.

**Also see (Section 15):** R7 · R10

"Play again with these people" on the home page, using your last 5 tables.

---

## 10. Phase 4: Competitive and social

### F4.1 Tournaments ✅ · XL
**Status (2026-09-30):** [`053800a`](https://github.com/muatasimqazi/playluddo/commit/053800a) · [`9464f40`](https://github.com/muatasimqazi/playluddo/commit/9464f40) — built.

**Also see (Section 15):** R8 · R10

**Ludo King:** 8-player tournaments.
**Ours:**
- **Private tournaments** for teams and friends: 8 or 16 players. **Bracket (decided, Section 12, question 16):** four-player tables, and the top two of each table advance. 8 players → final table of 4; 16 players → 8 → final table of 4. Placement within a table uses the existing ranking rules (`rankPlayers`: pawns home, then total progress, then earlier turn order).
- Scheduled starts and check-in.
- **No-shows and disconnects (decided):** a player who misses check-in has their seat filled by a computer. The seat stays theirs for the whole tournament, so they can reclaim it on arrival through the normal seat reclaim, in any round. Mid-game disconnects follow the normal takeover and reclaim rules.
- **Computers (decided):** computers can advance, so brackets stay intact, but **never receive trophies, badges or progression**. If a computer wins the final, no trophy is awarded for that event; human placements still count.
- A bracket view, with the ability to watch live tables (F4.4).
- The winner gets a trophy cosmetic and a profile badge. No entry fees, no prize pools.
- Public tournaments come later, once matchmaking volume can support them.

### F4.2 Team seasons ✅ · M (after F0.3)
**Status (2026-09-30):** [`54db3cf`](https://github.com/muatasimqazi/playluddo/commit/54db3cf) — built.

**Also see (Section 15):** R1 · R10

Weekly seasons for each private team:
- Standings built from `match_results`.
- A season recap card ("Sara won 7 of 10 this week") that can be shared as an image.
- Champion badges.
This extends the existing per-team leaderboard.

### F4.3 Full match replay and highlight clips ✅ · L
**Status (2026-09-30):** [`a612c7c`](https://github.com/muatasimqazi/playluddo/commit/a612c7c) — built.

**Also see (Section 15):** R1 · R5 · R8 · R10

**Today:** replay covers only the last action.
**Next:**
- Browse the whole game from `match_events`, with play, pause and speed controls, from the summary and your profile history.
- **Highlight clips:** record the 3D canvas with `MediaRecorder`, as a 6–10 second clip of a capture or finish with a branded end card, shareable to social media.
- Clips are stored locally only unless the player chooses to share one.

### F4.4 Watching live tables ✅ · M
**Status (2026-09-30):** [`9e48578`](https://github.com/muatasimqazi/playluddo/commit/9e48578) — built.

**Also see (Section 15):** R3 · R4 · R7 · R8

Watch a friend's or team's table without taking a seat.
- Watchers are read-only, with reactions only (no chat, to avoid moderation risk).
- **Opt-in (decided, Section 12, question 15):** watching is **off by default**. The host can turn it on for a table. **Any seated human** can turn it off at any time, which immediately removes current watchers. The seat labels show when anyone is watching.
- **Watchers must be 13+** and pass the same age check as players (F0.4).
- Watchers are a separate `watcher` role, not the Party screen's display role. The Party screen remains the only age-exempt role (decision 8), and only while media-free.
- Reuses the read-only delivery path built for the Party screen (P1), filtered so watchers never receive chat or call signaling.

### F4.5 Undo in offline games ✅ · S
**Status (2026-09-30):** [`825d893`](https://github.com/muatasimqazi/playluddo/commit/825d893) — built.

**Ludo STAR:** its publisher describes spending gems to undo the last dice roll. Our offline move undo is a different feature.
**Ours:** undo the last move in practice and Table Together only, keeping a history stack in `lib/presentation/practice.ts`. It is never available online.

---

## 11. Phase 5: Reach

### F5.1 Localization, including right-to-left languages ◐ · L
**Status (2026-09-30):** [`4a78bae`](https://github.com/muatasimqazi/playluddo/commit/4a78bae) · [`4a7527b`](https://github.com/muatasimqazi/playluddo/commit/4a7527b) · [`1d802b1`](https://github.com/muatasimqazi/playluddo/commit/1d802b1) · [`d1fe0b6`](https://github.com/muatasimqazi/playluddo/commit/d1fe0b6) · [`15d5b0b`](https://github.com/muatasimqazi/playluddo/commit/15d5b0b) — all first-wave locales ship with right-to-left support for Urdu and Arabic. Missing: localized App Store and Play Store listings, and the 360px screenshot pass for each language in the acceptance list.

**Ludo King:** the reviewed sources don't establish its language coverage. Our reason to localize is our own target markets (South Asia, the Middle East, Southeast Asia), not a verified competitor gap.
**Ours:**
- Move all UI text into message catalogs.
- **First wave:** Hindi, Urdu (RTL), Arabic (RTL), Bengali, Indonesian, Spanish, Portuguese (Brazil).
- Mirror the HUD and panels for RTL languages; the 3D scene is unaffected.
- Localize App Store and Play Store listings.
- Check the i18n routing approach against this repo's Next.js docs before choosing a library.

**Acceptance:**
- Screenshots of the main flows at 360px width, in each language.
- No text is clipped in the 3D seat labels.

### F5.2 5 and 6 players ✅ · XL
**Status (2026-09-30):** [`0202395`](https://github.com/muatasimqazi/playluddo/commit/0202395) · [`5e2d7ee`](https://github.com/muatasimqazi/playluddo/commit/5e2d7ee) — built.

**Ludo King:** 5–6 player games.
**Ours:**
- A hexagonal board with new geometry: the track length and entry offsets become per-board data rather than constants in `geometry.ts` and its SQL mirror.
- Two new colours, which must pass the F5.5 checks.
- `players.color` gets a wider check constraint.
- New board artwork and seat layout around the 3D table.

This is the most expensive item. Schedule it after the rules config has settled.

### F5.3 Big-screen mode → moved
Now **Party Mode**, Section 6 (P1–P8).

### F5.4 Video chat → moved
Now a committed feature: **Video chat**, Section 7 (V0–V6).

### F5.5 Accessibility ◐ · M
**Status (2026-09-30):** [`1dc0117`](https://github.com/muatasimqazi/playluddo/commit/1dc0117) — 12px minimum text size. [`0150d3e`](https://github.com/muatasimqazi/playluddo/commit/0150d3e):
- **Symbols:** every seat has a symbol (`lib/presentation/accessibility.ts`). It shows on seat labels, base name plates, the turn bar, the keyboard piece list and the Party screen's move preview, whatever the palette.
- **Colour-blind mode:** a synced preference (`colorBlind`, with the board-style pattern). It switches pawns, glows, seat figures and the Party phone board to a palette whose closest pair stays ΔE₀₀ ≥ 20 under simulated protanopia, deuteranopia and tritanopia, counting the board's cream as a colour (`tests/presentation/accessibility.test.ts`; today's palette bottoms out at ~6). All eight board artworks are recoloured to match: the vector boards in their SVG source, the raster signature board in its ink pass. Pawns and bases also get their symbol.
- **Screen-reader announcements:** rolls, captures, base exits, pieces home, finishes, timeouts, Snakes & Ladders ladders and snakes, turns and the result, in a polite log (`lib/presentation/announcements.ts`). The turn bar's ticking clock is no longer a live region.
- **Keyboard control:** Space rolls. Focus then moves to the roll button or the first movable piece. Arrow keys step through pieces, each labelled with where it is and what the move does. Panels take and return focus.
- **Reduced motion:** the device setting or a synced `reduceMotion` preference. No camera glides or action camera, pawns land without hopping, the die shows its face without tumbling, the board turns and flips in one step, the seat figures and snake tongues hold still, and CSS animations stop (`html.reduce-motion`). Both switches are in the table's Preferences panel and the profile panel's new Accessibility section, in all eight languages.

Missing: the VoiceOver and TalkBack audit on real devices. The announcements and the rest of the table HUD are still English-only (F5.1 never moved `Simulator.tsx` into the catalogs).

Deliver PRD 7.2 in full:
- **Symbols on pawns and seats:** player identity must never depend on colour alone.
- **A colour-blind palette option,** checked with a colour-vision simulator.
- **Screen-reader announcements** for turns, rolls, captures and the end of the game.
- **Complete keyboard control.**
- **Reduced motion** across the 3D scene: it should skip camera moves and pawn hops.
- **An audit** with VoiceOver and TalkBack before release.

### F5.6 Stronger store listings ☐ · S
**Status (2026-09-30):** not started. No store copy or metadata is in the repo.

Rewrite the App Store and Play Store copy around the Section 1 pillars: "No ads. No betting. Your house rules." Add "Dice you can check" only once F1.2 is live for that platform and audience, with wording that matches its caveat (R2). Mention seat reclaim ("Dropped connection? A computer holds your seat until you're back.") only after verifying that behaviour on each platform, since Party Mode changes it (P5). See R11.

---

## 12. Decisions log (formerly open questions)

All 18 questions were decided on 2026-09-28: the original nine, then nine from the audit. Section 15 recommendations are approved only where a decision here, or the feature text, adopts them. The rest remain proposals.

1. ✅ **Decided (2026-09-28): extra roll for getting home is ON by default.** Classic, and every preset and quick match, grant a bonus roll when a pawn reaches home. Hosts can turn it off as a house rule. This reverses PRD 4.2. The one-bonus-per-roll cap still applies: a six that also sends a pawn home earns one extra roll, not two.
2. ✅ **Decided (2026-09-28): blockades are OFF in Classic** (as PRD 4.3 confirmed) and in quick match. They're available only as a house rule in private rooms (F2.4).
3. ✅ **Decided for now (2026-09-28): nothing is sold.** Everything, cosmetics included, is earned by playing. Revisit once Phase 3 retention (D1/D7) is measured. If we sell later, it will only be direct purchases at a shown price: never currency, random rewards, ads or betting. Build F3.5 so a cosmetic *could* later be marked as purchasable without schema changes, but ship no purchase flow.
4. ✅ **Decided (2026-09-28): Team Up launches in private rooms, team rooms and Party Mode only.** Quick match stays Classic/Quick. A 2v2 quick-match queue is reconsidered once matchmaking volume can fill 4-player tables without leaning on computers.
5. ✅ **Decided (2026-09-28): age.**
   - **Online play is 13+.** Everyone is asked their birth month and year once, before their first online table (F0.4). Under-13s keep offline practice and Table Together.
   - **Video is 18+** (`VIDEO_MIN_AGE`, V0), reusing the same answer, and only for signed-in players.
   - **Friends (F3.6) and watching live tables (F4.4)** follow the online age (13+), with no extra gate. Blocking and reporting cover abuse.
   - **Still to do (actions, not decisions):** a legal review per launch market, and updated App Store and Play Store age ratings before video ships.
   - **Consequence to note:** under-13s can't join Party Mode from their own phone, because controllers are online seats. A child-safe Party controller (chat and voice are already off there) is a possible later follow-up.
6. ✅ **Decided (2026-09-28): Easy/Normal/Hard computer opponents are offline only** (practice and Table Together). Online seat filling and disconnect cover keep today's Normal logic in SQL. Revisit once the Phase 2 online modes are stable.
7. ✅ **Decided (2026-09-28): party phones get a short, one-tap agreement.** It's one line ("Be kind, and use a friendly name") with a link to the terms, shown with the age question (F0.4). It is remembered separately from the full agreement: a phone that has only seen the short version still gets the full agreement at its first table with chat or voice. That includes a mixed Party room with remote voice (P8).
8. ✅ **Decided (2026-09-28), amended by question 11: the party screen runs on an anonymous session**, like a guest, with no sign-in and no age question, because it has no seat, chat or voice. Signing the screen in to save party history to a team can come later.
9. ✅ **Decided (2026-09-28): party rooms offer Team Up as soon as F2.5 ships.** The VIP can pick it, and partners share a colour glow on the TV. Until 5–6 player boards (F5.2), more people can still play by sharing a phone as one seat, which needs no extra feature. Everyone else is audience.

### Questions from the audit (decided 2026-09-28)

10. ✅ **Decided (2026-09-28): video safety covers supported apps, over direct connections.** The server refuses video setup for ineligible tables and our apps enforce age and block rules. We state plainly, in the policies and store review notes, that we can't control modified apps. No media server is required for this; V6 stays optional and driven by performance.
11. ✅ **Decided (2026-09-28): the Party screen can use mic and camera, and show video, with a signed-in 18+ operator.** This amends decision 8: the screen still starts anonymous and media-free; media needs an operator to authorize it from their own phone (V5). Every seated human, including living-room controllers, must be signed in and 18+ (the V0 table rule). The operator confirms that everyone in view is 18+ and consents each time the camera turns on, and a persistent indicator shows while mic or camera is on. **Consequence:** families playing with under-18s get no video in Party Mode.
12. ✅ **Decided (2026-09-28): age boundaries and rollout (F0.4).** Eligibility starts on the first day of the month after the birth month in which the player reaches the age (13 online, 18 video). Matches running at launch finish; every new join, rematch, quick match or seat reclaim after launch needs an answer. The under-13 device flag stores only the month the player turns 13, lifts itself then, blocks only new answers on that device (never an already-eligible account), and can be cleared by support.
13. ✅ **Decided (2026-09-28): minimal under-13 data, auto-deleted (F0.4).** No birth month/year is stored for under-13 answers; only an `eligible_from` marker, which still reveals the birth month to within a month. Anonymous under-13 accounts and their data are deleted after 30 days without activity. Signed-in under-13 accounts go through the launch-market legal review, which must finish before F0.4 ships. Support corrections are documented and logged.
14. ✅ **Decided (2026-09-28): presets plus a tested allow-list of combinations (F2.4).** Launch with Classic, Quick, Master and Family, plus single-toggle changes to Classic. A combination is allowed only after its R9 edge-case fixtures are agreed and pass in both engines. The server rejects anything else. **Still to do:** write and agree the R9 fixtures, starting with F1.5 (extra roll for getting home), before either engine changes.
15. ✅ **Decided (2026-09-28): watchers and audience are 13+, and watching is opt-in.** Party audience phones (P6) and live-table watchers (F4.4) pass the same age check as players. Watching is off by default. The host can turn it on, and any seated human can turn it off at any time, removing current watchers. Watchers and audience are roles separate from the age-exempt Party screen.
16. ✅ **Decided (2026-09-28): tournaments (F4.1).** 4-player tables with the top two advancing: 8 → 4 and 16 → 8 → 4. No-shows are filled by a computer and can reclaim their seat in any round; disconnects follow normal reclaim rules. Computers can advance but never receive trophies, badges or progression. If a computer wins, no trophy is awarded. Ties use the existing ranking tiebreakers.
17. ✅ **Decided (2026-09-28): progression counts only server-recorded online games, with anti-farming limits** (Phase 3 "What counts"). Computer-only games and trivially short custom rules earn reduced credit, repeats against the same opponents diminish, abandoned games earn nothing, and awards are idempotent. Offline achievements stay local to the device. **Follow-up:** the iOS Game Center Wins leaderboard and some achievements already count offline wins (F3.4 note); pick the fix before F3.4 ships.
18. ✅ **Decided (2026-09-28): Muatasim Qazi owns all four areas for now**, with the response targets below. Revisit before inviting external users at scale, and before any feature's usage outgrows one person's capacity.

| Area | Owner | Response target |
|---|---|---|
| Moderation (reports on names, reactions, chat, voice, video, audience) | Muatasim Qazi | Every report reviewed within 24 hours, as the table rules promise. Child-safety and threat reports the same day. |
| Legal and launch-market review (age, privacy policy, terms, store ratings) | Muatasim Qazi | Completed before F0.4 and before any video or social feature ships to that market. |
| Operational alerts (TURN spend, call failures, report spikes, push failures) | Muatasim Qazi | Alerts acknowledged within 4 hours during launch weeks, then within 24 hours. |
| Emergency shutdown (server-side flags for rule modes, Party roles and video; R11) | Muatasim Qazi | Able to switch any of them off within 1 hour of a serious incident. The flags must exist before those features ship. |

**Release gate:** no new social or media surface (friends, watching, audience, video) ships until its alerts route to the owner and its kill switch has been tested.

## 13. Success metrics by phase

| Phase | Metric | Target |
|---|---|---|
| 0–1 | Share of players who open "Verify dice" on the summary | Tracked (no target) |
| 1 | Push notification opt-in on mobile | > 50% |
| 1 | Share of completed private games that get a rematch | > 30% (PRD 8.3) |
| Party | Party rooms started, and the share that reach a second game | Tracked; > 40% play a second game |
| Party | Median phones per party room (players plus audience) | ≥ 4 |
| Video | Call connection failures after the TURN relay (V1) | < 2% |
| Video | Camera activation outcomes: eligibility, sign-in, permission and connection | Tracked separately; no second age question at camera activation |
| Video | Private games with at least one camera on | Tracked |
| Video | Reports per 1,000 video minutes | Tracked, with a review threshold that pauses video if exceeded |
| 2 | Median Quick mode game length | < 7 minutes |
| 2 | Private rooms using any non-default house rule | > 20% |
| 3 | Players returning the next day (D1) / a week later (D7) | +10 points / +5 points vs. the pre-Phase 3 baseline |
| 3 | Signed-in players with at least 1 friend | > 30% |
| 4 | Teams with at least 1 game each week during a season | > 50% |
| 5 | Share of sessions in languages other than English | Tracked per locale |

## 14. Competitor sources

- Ludo King features page: https://ludoking.com/features (voice chat, Team Up 2v2, 5–6 players, Quick mode, 8-player tournaments, inventory of themes, dice and emojis)
- Ludo King, Wikipedia: https://en.wikipedia.org/wiki/Ludo_King (6-player mode and Quick mode launched January 2021)
- Ludo Club, App Store: https://apps.apple.com/us/app/ludo-club-fun-dice-board-game/id1267900294 (Classic, Rush, and faster modes)
- Ludo STAR, App Store: https://apps.apple.com/us/app/ludo-star/id1198143062 (Undo, Quick, clubs, tournaments; current listing names Classic/Arrow/Blitz and mentions capture-before-home)
- Ludo King FAQ: https://ludoking.com/faq (tutorial videos, RNG certification claim, browser/Android TV availability, Facebook friends)
- Ludo King RNG certification page: https://ludoking.com/rng-certification (publisher's certification material; distinct from player-verifiable match commitments)
- Gameberry FAQ: https://gameberrylabs.com/faq (Ludo STAR dice-roll undo using gems; distinguish from offline move undo)

**Evidence convention:** these pages were reviewed on 2026-09-28. Store descriptions vary by platform, region and version. Record those details when validating a competitor behavior. Unsupported claims such as a single AI difficulty, fixed modes only, inventory being “largely sold”, or market-wide exclusivity must be qualified until demonstrated. The absence of a feature from a listing does not prove the feature does not exist.

---

## 15. Audit recommendations — proposed requirements

These recommendations address implementation and release gaps. They are **proposals, not decisions**. Questions 10–18 in Section 12 settled the product choices they raised, and the feature text now reflects those answers. Where a remaining recommendation conflicts with a feature sketch, settle it and update the sketch before building. Estimates remain provisional until this work is included.

### R1 Match identity, event coverage and results — F0.3, F1.1, F3.1–F3.4, F4.2–F4.3

**Recommended wording:** “A room contains multiple matches. Each start allocates an immutable `match_id`; events, results, rule snapshots, seeds and rewards belong to that match. Results are unique by `(match_id, player_id)`, with nullable account attribution and explicit human/guest/bot metadata. Completion and reward writes are idempotent.”

- Rematches currently retain room events and recreate pawns (`20260913232948_m4_rematch.sql:36–56`). Add the match boundary before deriving history or rewards.
- Record a versioned initial snapshot: game, board version, resolved rules, seats/colors/sides, pawn IDs and initial positions. Record decision timeouts, action origin (manual/auto-roll/bot/timeout), turn boundaries and terminal reason. Current timeout handling changes counters without recording every miss (`20260913225951_m3_timers_bots_reconnect.sql:283–300`).
- Do not infer unavailable historical metrics. Define backfill availability, result access policies, retention and deleted-account behavior. Preserve a participant identifier even when a guest's `user_id` is omitted; null account IDs must not collapse multiple results.
- Snapshot the team association/membership used for a season. Define whether the existing lifetime leaderboard is preserved or rebuilt during migration.
- Provide full paginated transcript access by match; recent-event feeds are insufficient. F1.1 needs a small arbitrary-moment replay adapter or must defer that button: the existing timeline replaces its recording on each roll (`lib/presentation/timeline.ts:155–156`).

### R2 Verifiable dice protocol — F0.1, F1.2

**Recommended wording:** “Before the first roll, publish and retain a commitment for a fresh match seed. Use a versioned deterministic derivation with canonical match/counter encoding and consecutive roll indices. Rejection sampling consumes a specified HMAC byte stream; exhausted/rejected output expands with a distinct retry counter, never by repeating the same input.”

- Scope seeds to matches, not reusable rooms. Route both games and every human/bot/timeout roll through the derivation. Transaction retries must not consume extra committed roll indices.
- Store seeds in a table with explicit privilege restrictions and RLS as defense in depth. Test direct reads, function grants, security-definer projections, room state, broadcasts and logs for leaks; a `private` schema name alone is not protection.
- Reveal on every terminal outcome, including abandonment. Define stalled-match expiry and unavailable-reveal status. Do not reveal when only the first player finishes and others are still playing.
- The browser retains the commitment observed before play and checks the seed hash, protocol version, consecutive counters and every recorded roll. Test changed rolls, gaps, duplicates, changed commitments, rematches and both games with shared vectors.
- Do not claim proof of server honesty, unbiased seed selection or complete independent history. Define whether client entropy is a later enhancement. Restrict initial verification claims to supported online matches; offline practice has a different randomness and history model.

### R3 Age enforcement, identity and agreements — F0.4, V0, P6–P8, F3.6, F4.4

**Recommended wording:** “Eligibility is an account-bound server capability, independent of agreement acceptance. Validate it for new and existing online membership, not only room creation/join. Returning seats, rematches, social membership, audience/watchers and communication endpoints must not provide alternate entry paths.”

- Add an authenticated, insert-once declaration RPC with input validation and atomic concurrency behavior. Define support corrections, audit history and precedence of platform age signals. Resolve the month boundary in question 12; month/year cannot establish an exact birthday.
- Cover seat claim/reclaim, match/rematch start, game and communication actions, audience/watch admission and future friend actions. Revalidate all human seats at start, including seats filled by matchmaking on another caller's behalf. Define revocation of existing sessions/subscriptions and handling of queued players during rollout.
- Guests really are anonymous Auth users (`lib/supabase/auth.ts`). Identity conversion preserves the ID only when implemented as linking. Current profile login uses sign-in methods (`components/auth/ProfilePanel.tsx:267,281,314`), so add provider-specific conversion tests and distinguish conversion from account switching. Reload eligibility after every auth change; never copy a guest answer to an unrelated account automatically.
- Maintain separate versioned short/full agreement state. Short Party acceptance must not suppress the full agreement when chat/voice becomes available. A previously declared age must not be asked again just because an agreement changed. Gate UGC submission, including names and reactions, behind the appropriate agreement.
- Preserve the media-free screen exemption only for its restricted display capability. Audience/watchers are separate roles, and they are 13+ (decided, question 15).
- A new age-table `auth.users` foreign key with `ON DELETE CASCADE` is covered by `delete-account`. Existing seats and reports use `SET NULL`, so define retained identifiers/content separately; test declaration deletion and local-denial-flag behavior.

### R4 Party permissions and lifecycle — P1–P8, F4.4

**Recommended wording:** “Seats, displays, audience and watchers have separate capabilities. The display receives a scoped public table view and authorized game events, not unrestricted chat, signaling or private metadata. It cannot acquire a seat through another RPC while acting as a display.”

- Change the explicit authorization inside `get_room_state`, relevant event-read policies and the seat-claim-first client connection path, as well as `realtime.messages` authorization. Separate/filter chat and signaling from display delivery. Test every role against every allowed and denied operation.
- Specify atomic first-VIP assignment, concurrent joins, VIP transfer/grace periods, minimum humans, bot fill, rematch quorum, display replacement/recovery and empty-lobby cleanup. A nullable `host_player_id` already exists; authorization and lifecycle behavior are the missing work.
- Decide whether display presence counts for abandonment. The current sweep excludes paused rooms (`20260919020000_pause_matches.sql:29`); add an independent pause-expiry/liveness path for P5 so a two-minute pause actually expires. Define repeated disconnects, simultaneous absences and pause-abuse limits.
- Define who can lock/unlock the room. The proposed screen lock is a limited management capability, so the “can do nothing else” test must name permitted management actions explicitly.
- Give phone-to-TV move previews an authenticated ephemeral event with actor, match/turn version, expiry and rate limits. Previews never mutate board state. A full game should require no one to look at **another player's phone**; looking at the shared TV is intentional.
- Specify audience admission/capacity, membership expiry, vote identity and cutoff, reaction quotas, host kick/ban and revocation of live access. Report/block APIs must support non-seat members.

### R5 Video authorization and privacy — V0–V6, P8, F4.3

**Recommended wording:** “Supported video sessions require an authorized private room and eligible non-anonymous participants. Audio-only tables negotiate without video. Whole-table eligibility is checked on camera activation and signaling, and changes revoke existing supported video sessions.”

- Define offer/answer schemas, size/rate limits, room/member/block checks, negotiation glare, reconnects, ICE restart and track-replacement failures. Decide whether data channels are needed; deny unsupported signaling capabilities. Parsing a literal SDP substring is not a complete protocol validator.
- Test roster/auth/eligibility changes after negotiation and mid-call blocking. Sender-side track removal and local receive teardown protect compliant clients; neither should be described as universal enforcement against colluding modified endpoints. A normal audio transceiver cannot simply accept a video track of a different kind.
- “Signed in” means a non-anonymous authenticated account, not verified identity. Generic table-ineligibility copy avoids explicitly naming a person but cannot guarantee that others cannot infer who caused it.
- Screen voice/video follows decision 11 (signed-in 18+ operator; see V5). Camera permission alone does not authorize bystanders or establish their age. Add an explicit indicator of who receives a stream, including displays.
- Exclude camera textures and call audio from F4.3 highlight capture by default. If inclusion is desired, specify consent and sharing behavior first. Distinguish “the service does not record calls” from the possibility of recipient recording.

### R6 TURN, performance and push operations — V1–V3, V6, F1.7

- TURN credentials: require authenticated issuance, current authorized membership, short TTL, refresh behavior, quotas, spend alerts and secret redaction. Specify regional availability, relay failure fallback and operational ownership. Short-lived credentials alone do not prevent abuse.
- Four-player mesh is a hypothesis to benchmark: three outgoing 300-kbps video streams mean about 900 kbps before audio/overhead. Test named low/mid/high-tier devices, codecs, thermal duration, battery and cellular conditions. A 2D strip does not automatically reduce receive bandwidth or decoding; specify actual sender/receiver suspension and recovery thresholds.
- Define ICE/call-failure denominators, minimum sample volume, thresholds and alert owners. Evaluate SFU need before promising device support.
- Push: delayed “still your turn” checks, deduplication, expiry/cancellation, logout/token cleanup, per-device subscriptions, deep links and quiet-hour timezone are part of the feature. Split basic transport/turn pushes from friend notifications until F3.6 exists.

### R7 Child safety, moderation and policies — F0.4, P6–P8, V4, F3.1/F3.6/F3.7, F4.4

**Recommendation:** complete a launch-market review before collecting age declarations or shipping new social surfaces, rather than waiting for video. These are issues for qualified review, not conclusions that a particular law applies.

- **COPPA:** assess intended/actual audience and actual knowledge; a 13+ label and denial screen do not resolve collection before screening or retention after a known under-13 answer. Inventory auth IDs, birth data, device flags, analytics and support data; approve purposes, retention, deletion and any parental process. Review offline-mode network collection too.
- **UK Children's Code:** assess likely access by under-18s, privacy defaults, age assurance, profiling/presence/discovery and nudges. Include the proposed friends, streaks and watching features in the risk assessment.
- **EU/GDPR:** separate the product minimum age from lawful basis and national thresholds for consent-based child processing, which can vary between 13 and 16. Define geographic handling and rights/support procedures without collecting unnecessary location data.
- **UGC operations:** names, avatars, reactions, invitations, audience votes and live media can be abused without free-text chat. Assign staffing, urgent escalation, sanctions/appeals, response targets and abuse-rate thresholds. Existing report controls require seats; extend them to social and read-only roles. Verify the existing 24-hour review promise is operationally achievable.
- **Stores:** evaluate actual use against Apple and Google UGC policies; private links are not proof of trusted relationships. Review age ratings, target audience, Apple privacy labels and Google Data Safety for the shipped behavior. The short Party agreement must still link to and obtain acceptance of the applicable terms before UGC submission.
- **Policies:** document age collection/retention/corrections, under-13 handling, media endpoints/relays/providers, recipient recording, IP exposure, report evidence, push tokens, sharing, deletion exceptions, processors and international transfers. Replace inconsistent existing under-13 wording in `app/privacy` when F0.4 is approved.

Sources reviewed for the audit (2026-09-28; recheck before release):
- [FTC COPPA guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)
- [ICO introduction to the Children's Code](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/introduction-to-the-childrens-code/)
- [European Commission: safeguards for children's data](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data/are-there-any-specific-safeguards-data-about-children_en)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/#user-generated-content)
- [Google Play UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en)
- [Supabase anonymous-user conversion](https://supabase.com/docs/guides/auth/auth-anonymous)
- [W3C WebRTC specification](https://www.w3.org/TR/webrtc/)

### R8 Dependencies and estimates — all phases

| Feature/slice | Additional prerequisite or scope split |
|---|---|
| F0.3, F1.2, F4.3 | Match identity and event/transcript contracts (R1); verification also requires R2 |
| P1–P7 | F0.2 room configuration, F0.4 controller eligibility, display authorization/lifecycle (R4) |
| P2/P7 presets | F1.5 finish bonus; F2.4 for the full preset panel; F2.5 for Team Up |
| F1.1 moment replay | Small arbitrary-moment replay adapter, or defer to F4.3 |
| F1.7 friend pushes | F3.6; base notification transport can ship earlier |
| V0/V2/V3/V4 | F0.4, V1 connectivity and moderation readiness (threat model decided: question 10) |
| P8/V5 screen media | P4, V0–V4, operator sign-in and indicator (V5), and R5 (question 11 decided) |
| F3.3–F3.5 | Eligible match results, reward idempotency and progression decisions (R10) |
| F4.1 | Tournament bracket decision, results and F4.4 watching; defer cosmetic awards until F3.5 |
| F4.4 | Read-only membership, audience-capable moderation and online eligibility |

Re-estimate after these contracts are settled. F0.3/F0.4/F1.2 may be L once lifecycle, migration and security tests are included. F2.4 includes blockade logic in two engines, not just a panel; F2.6 includes movement/board changes in two engines, not just keys. P5 requires scheduling work; V5 requires a separate endpoint/safety model. Split P8 mixed rooms, mini-games and native TV apps into separately estimated deliverables. Estimates should state staffing and include SQL, TypeScript, parity, migration, device QA, accessibility and localization; operational/legal review lead time should be shown separately.

### R9 Rules contract and edge-case fixtures — F0.2, F1.5, F2.1–F2.6

**Recommendation:** publish a complete preset-value table and compatibility matrix before coding. Every preset inherits `bonusRollOnFinish: true` under decision 1; Classic and quick-match presets use `blockades: false`. Distinguish a preset name from resolved custom values. Version and freeze resolved rules per match, validate them server-side, and add game-specific keys for Snakes & Ladders plus a deliberate home for Party room metadata.

Questions that golden vectors must settle:

| Rule | Required edge cases / recommended direction |
|---|---|
| Finish bonus | Victory/placement completion takes precedence over another roll; otherwise six/capture/finish combine into one boolean bonus. Define Team Up handoff and third-six behavior explicitly. |
| Blockades | Passing versus landing/capture; own and allied passage; two versus three/four pawns; safe/entry cells; formation/breakup; starting stacks; a blockade before home-lane entry. |
| Master | Exact stopping cell before home, partial movement versus illegal move, zero-distance moves; capture credit by pawn/player/team; eligibility persistence after capture and reset on rematch. |
| Team Up | Acting seat versus pawn owner; finished players remaining in turn rotation; bonus/six counters; bot control; capture/stats credit; shared cells/blockades; Master interaction; whether reduced `pawnsToWin` is disallowed. Team chat/voice requires separate authorization. |
| Rush | Match-clock start, pause budget, expiry during roll/move/bonus chains, concurrent actions and clock expiry, equal-turn policy, tied rankings. Existing `rankPlayers` breaks ties by earlier turn order; decide whether that is acceptable for timed competition. |
| Quick | First winner versus continued placement play, ranking unfinished players, preset overrides and queue partitioning. Duration targets depend on this choice. |
| Snakes & Ladders | Any-roll entry destination, bounce landing and snake/ladder resolution, six bonuses, board IDs/versioning and compatibility with Ludo-only keys. |

Use shared scenario fixtures for both engines and transition tests for player actions, bots, timeouts, pauses and rematches. Test supported combinations rather than assuming individually correct toggles compose safely.

### R10 Progression, tournaments and analytics — F3.1–F4.3, Section 13

- Define reward-eligible modes, minimum participation, repeated-opponent limits, bot takeover attribution, quitting/abandonment, daily timezone, streak freezes and season boundaries. One-pawn custom games and colluding accounts must not become unrestricted farming paths.
- Use idempotent award keys and server-authoritative results. Specify guest conversion/deleted-account treatment and offline reward exclusions or a separate trusted design.
- Tournament ties, no-shows, disconnects, advancement and bot awards are decided (question 16; F4.1).
- Each metric needs event names, authoritative trigger, match/member IDs, denominator, owner, retention and dashboard/alert acceptance. Do not include birth data, raw SDP or media in analytics. The first-online age flow and camera activation flow are separate funnels.
- Define participant-minutes versus room-minutes for video reports, minimum sample size, emergency response and false-report handling. A dashboard threshold is not a kill switch by itself.
- Specify Hard-bot simulation composition, seat rotation, number of games, confidence interval and whether “beats” means wins or places higher. The current 65% statement is not an executable acceptance test.

### R11 Release, accessibility and document reconciliation — all features

**Recommended release checklist:**
- Add schema and compatible RPC versions before dependent clients; define old native-client behavior and minimum supported versions. Freeze rules for running matches and change defaults only for new matches.
- Add server-controlled flags for rule modes, Party roles and video, including active-session revocation. Define staged cohorts, owners, rollback criteria, active-match handling and tests for turning a feature off.
- Add localization keys and accessible flows when each feature is built. Age/agreement forms, errors, reporting, controls, rules summaries and phrases must not wait for F5.1/F5.5. Require focus/keyboard behavior, screen-reader labels, non-color partner identity, a non-shake roll option, TV readability and reduced-motion behavior. F5 expands languages and audits coverage.
- Reconcile PRD and handoff before implementation approval: bonus rules recur in the PRD turn state machine, decisions and checklist; economy plans still mention a ledger/refills; timers, native scope, age/UGC, Party membership and rewards also need updates. Mark historical MVP statements as historical and explicitly establish the authority of the updated requirements.
- Before store/marketing copy ships, verify the advertised dice protocol, house rules and reconnect behavior are actually enabled for that audience and platform.
