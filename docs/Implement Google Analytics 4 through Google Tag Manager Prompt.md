You are a senior product analytics engineer and game analytics specialist.

Your task is to instrument **Luddo House** (https://luddohouse.com), a multiplayer 3D Luddo game, with **Google Analytics 4 (GA4) delivered through Google Tag Manager (GTM)**.

You have the complete codebase. Do not start by adding analytics calls. First understand how the game actually works, trace the real player journeys, design a measurement plan, get it reviewed, and only then implement it.

Read `docs/LLM_CONTEXT.md` first. It is the authoritative description of the product: modes, rules, ways to play, accounts, age rules and what the game deliberately does not have (no purchases, no coins, no ads). Read `AGENTS.md` too. This project uses Next.js 16 with breaking changes, so read the relevant guide in `node_modules/next/dist/docs/` (especially anything on scripts and third-party libraries) before writing Next code.

The game is spelled **Luddo**, never "Ludo", including in event values, docs, GTM names and GA labels.

---

# Accounts and access

## Google Analytics

- **GA4 account ID:** `408679797`
- **Account / property name:** Luddo House
- **Existing measurement ID in code:** `G-75GZQ69MCG`, loaded directly with `gtag.js` in `app/layout.tsx`. Confirm in the GA admin that this is the web data stream of the Luddo House property before you build on it.

## Google Tag Manager

- **Container ID:** `GTM-N7X49V9F`, already loaded on the website from `app/layout.tsx` (the `GTM_ID` constant). The ID is public by nature, so keep it as a constant rather than moving it to an environment variable.
- Open this container in Chrome and record what it contains today (tags, triggers, variables, published versions) before changing anything. Don't create a second container.

## Browser access

You have full access to the web through **Google Chrome**, signed in as the account owner. Use it to:

- read and configure GA4 (admin, custom definitions, key events, DebugView, Realtime)
- create and configure the GTM container (variables, triggers, tags, workspaces)
- run GTM Preview / Tag Assistant against a local build and, after deploy, against production
- read current Google documentation on GA4, GTM and Consent Mode when you are unsure

This means you can do the GA4 and GTM configuration yourself rather than only writing instructions for it. Use these guardrails:

- **Go ahead without asking:** read anything; create and edit items in an unpublished GTM workspace; use Preview, Tag Assistant, DebugView and Realtime.
- **Ask first, and show exactly what will change:**
  - publishing a GTM container version
  - creating GA4 custom dimensions or metrics (they count against a quota and can only be archived, not deleted)
  - marking key events
  - changing property settings such as data retention, Google signals, reporting identity, User-ID, data sharing or data filters
  - linking BigQuery or any other product
  - accepting terms of service
  - deleting anything
- **Never:** touch any other GA account, property or GTM container, or enter credentials anywhere other than Google's own sign-in pages.
- **Production testing:** never use public quick match on production for testing, because it pairs you with real players. Test online play in private rooms only.

---

# Primary objective

Build an analytics foundation that answers questions specific to Luddo House:

- How many visitors start a game, and through which way to play (practice, Table Together, private room, quick match, Party Mode)?
- Where do people drop off between landing, the age check, signing in or naming themselves, and sitting down at a table?
- How well do invite links work? How many shared links turn into a friend joining and a game starting?
- Which modes (Classic, Quick, Master, Rush, Family, Team Up) and which game (Luddo or Snakes & Ladders) are played and finished?
- How long do games take, and how often are they finished rather than abandoned?
- How often do seats get handed to a computer player because of timeouts or disconnects, and how often do players reclaim them?
- How often do people rematch, use "Play again", or come back the next day (streaks)?
- Do the social features get used: reactions, chat, voice, video, friends, watching?
- Does Party Mode work: TV screen opened, phones joined, game started, game finished?
- How many guests go on to sign in, and with which method?
- Where do connection, realtime and 3D/graphics problems happen?

There is **no monetization**. Nothing is for sale, and there is no virtual currency. Do not add purchase, `earn_virtual_currency` or `spend_virtual_currency` events.

Avoid generating large volumes of meaningless events.

---

# What already exists (verify each point; don't trust it blindly)

- **GTM and `gtag.js` both load:** `app/layout.tsx` loads two things on the web, and **both are web only**:
  - the GTM container `GTM-N7X49V9F` (the standard snippet through `next/script` `afterInteractive`, plus the `<noscript>` iframe at the top of `<body>`)
  - the original direct `gtag.js` snippet for `G-75GZQ69MCG`

  Both write to the same `window.dataLayer`. If the container also fires a Google tag for `G-75GZQ69MCG`, every page view is counted twice. Remove the direct snippet once GTM's Google tag is set up and published (see Phase 5).
- **Keep GA/GTM out of the app build.** The Capacitor app build (`CAPACITOR_BUILD`) deliberately leaves both out, to keep the App Store privacy label limited to what `ios/App/App/PrivacyInfo.xcprivacy` declares.
- **PostHog** is the product analytics tool, and it also runs in the app. It is initialised in `instrumentation-client.ts` with session replay that masks all text and inputs, and with manual `$pageview` capture on App Router navigations. The only custom event today is `call_ice_outcome` in `lib/analytics/ice.ts`. Don't remove or weaken PostHog.
- **Under-13 handling:** `lib/analytics/children.ts` (`stopAnalyticsForChild`) and `deviceAgeBlocked()` in `lib/community.ts` turn PostHog off on any device or account that answered under 13. **Google Analytics is not covered by this today.** GA/GTM must send nothing for these users either. Treat this as a requirement, not an option.
- **Consent:** there is no cookie/consent banner. GA and GTM currently load unconditionally on the web.
- **Privacy policy:** `app/privacy/page.tsx` says Google Analytics is used on the website "to measure visits". Gameplay events in GA go beyond that. Draft the wording change and flag it for review; don't change the policy's meaning on your own.
- **IDs in URLs:** routes use query parameters (`/room?id=…`, `/tournaments?id=…`, replays, watch links) because the app is a static export. A room URL **is the invitation**: anyone with it can try to join. Default `page_view` collection would send these to GA.

---

# Phase 1 — Audit the application

Before changing code, trace the real flows through the code and confirm or correct the summary in `docs/LLM_CONTEXT.md`. Starting points:

- `app/` routes: home, `practice`, `table-together`, `room`, `screen` (Party Mode TV), `watch`, `replay`, `tournaments`, `leaderboard`, `profile`, `how-to-play`, `about`
- `components/lobby/`: `QuickMatch`, `RoomLobby`, `JoinTable`, `PlayAgain`, `AgeCheck`, `TableRules`, `EntrancePickers`
- `components/simulator/`: the live 3D table (`Simulator.tsx` holds the menu, chat and victory screen). **`components/arena/` and the old summary components are dead code**, so don't instrument them.
- `components/controller/`, `components/party/`: Party Mode phones and TV
- `components/auth/`, `lib/nativeAuth.ts`: guest, Google, email code, phone code, Game Center
- `lib/store/room-store.ts`, `lib/hooks/useRoomConnection.ts`, `lib/realtime/`: room state, realtime channel, reconnects
- `lib/hooks/useTableCall.ts`, `useVoiceChat.ts`: voice and video
- `lib/hooks/useAdaptiveQuality.ts`: automatic graphics step-down
- `lib/presentation/`: practice and the offline engine
- `supabase/migrations/`: the authoritative server engine, RPCs (`request_roll`, `request_move`, room and match RPCs), `match_events`, `match_results`

Determine in particular:

- Which client code paths observe a **real** game start and game end, not a component mounting.
- How online games (server-authoritative) and offline games (practice and Table Together, run in the TypeScript engine) differ in where lifecycle events can be observed.
- What each client sees at the end of an online match. Every seated player's browser sees the same result, so decide on a per-player or per-match perspective (see Phase 2).
- How seat takeover by a computer (3 missed decisions or 45s disconnected) and seat reclaim appear on the client.
- How refreshing, reconnecting and joining mid-game rehydrate state, because these are the main risk for duplicate events.
- How Party Mode splits work between the TV (`/screen`), the VIP phone, player phones and audience phones.
- Which stable IDs exist (room, match, team, tournament, auth user) and which of them grant access if leaked.
- How `RpcError` codes are structured, and whether they can be reported as a safe allow-list.

Write down the real player journey as a diagram before proposing events.

---

# Phase 2 — Measurement plan

Propose an event taxonomy before writing code. Use GA4 recommended events where they genuinely fit: `login`, `sign_up`, `share`, `tutorial_begin`, `tutorial_complete`, `level_up`, `unlock_achievement`, `join_group`, `select_content`. Use custom events only when needed. Use `snake_case`.

The lists below are **suggestions to check against the code**, not a spec. Cut anything the code can't support reliably, and add what's missing.

## Shared game parameters

Define one consistent set and reuse it across lifecycle events:

| Parameter | Values (low cardinality) |
|---|---|
| `game_type` | `luddo`, `snakes_ladders` |
| `game_mode` | `classic`, `quick`, `master`, `rush`, `family`, `team_up` |
| `play_context` | `practice`, `table_together`, `private_room`, `quick_match`, `party`, `tournament`, `team` |
| `is_online` | boolean |
| `seat_count` / `human_count` / `bot_count` | integers |
| `bot_difficulty` | `easy`, `normal`, `hard`, or absent |
| `board_shape` | `square` (2–4), `hex` (5–6) |
| `rules_customized` | boolean: house rules differ from the mode's preset |
| `turn_timer_s` | `10`, `15`, `30` |
| `entry_point` | how the player got to this table: `invite_link`, `room_code`, `friend_invite`, `play_again`, `rematch`, `quick_match`, `tournament`, `party_qr`, … |

## Acquisition and accounts

- `page_view`, with sensitive query parameters removed (see Phase 7)
- `login` / `sign_up` with `method`: `google`, `email_code`, `phone_code`, `game_center`, `guest`. Signing in after playing as a guest keeps the guest's progress, so decide whether that is `sign_up`, `login`, or a separate `guest_upgraded`, and document the choice.
- Age check: whether it was shown and completed, **never the answer or any age bucket**. An under-13 answer turns analytics off, so that outcome must never reach GA at all.
- `tutorial_begin` / `tutorial_complete` for How to Play, if it fits

## Getting to a table

- `play_mode_selected` (which way to play was chosen)
- `room_created` (mode, game type, seats, bots, rules customized)
- `invite_shared` or GA's `share` with `method` (`share_sheet`, `copy_link`, `qr`, `friend`) and `content_type: room_invite`
- `room_joined` with `entry_point`, plus whether a seat was taken or the player joined as audience
- Quick match: `matchmaking_started`, `match_found` (`wait_time_ms`), `matchmaking_cancelled`, `matchmaking_failed`
- Party Mode: `party_screen_opened` (TV), `party_controller_joined` (`role`: `vip`, `player`, `audience`), the VIP starting the game
- `watch_started` for spectating

## Game lifecycle (most important)

- `game_started`
- `game_completed`
- `game_abandoned`, with `abandon_reason`: `left_table`, `quit`, `closed_tab` if detectable, `room_closed`, …
- `rematch_requested`, `rematch_started`, and `play_again_used`

**Perspective:** in an online match every seated player's browser can observe the end of the game. Prefer **per-player events**: each client reports *its own* outcome (`finish_place`, `won`) once. Use a shared `game_id` so the number of matches is a count of distinct `game_id`s. State this rule clearly in the docs so nobody sums events and gets four times the number of games.

Put **aggregates** on `game_completed` rather than sending in-game events. The end-of-game summary already computes most of these:

- `duration_seconds`, `turn_count`
- `finish_place`, `won`, and for Team Up, `team_won`
- `captures`, `sixes`, `pawns_home`, `missed_decisions`
- `seat_taken_over` (boolean), `seat_reclaimed` (boolean)
- `used_chat`, `used_voice`, `used_video`, `reaction_count`, as booleans or small counts. Never send content.
- `rush_clock_expired` for Rush

## Social, progression and trust

- `friend_added`, `friend_invited_to_table`
- `call_joined` (`kind`: `voice` or `video`), `camera_enabled`. Decide whether the existing PostHog `call_ice_outcome` belongs in GA too, or stays only in PostHog.
- `share` for replays, highlight clips and team recap cards (`content_type`)
- `level_up` (`level`), `unlock_achievement` (`achievement_id`: the internal code, not display text), `cosmetic_unlocked` (category only), `streak_milestone` (3, 7, 30)
- `dice_verify_opened`: "dice you can check" is a core differentiator, so measure whether people use it
- Teams and tournaments: `join_group` for a team, `tournament_created`, `tournament_joined`, `tournament_completed`

## Do **not** send to GA4

These happen too often, and GA is the wrong place for them:

- each roll, pawn selection, move, capture or turn change
- each reaction or chat message
- camera moves, view changes, animation and render events

The server already records every match in `match_events` and `match_results`. Per-move and per-roll analysis belongs there (or in BigQuery), not in GA. If you think a per-move event is needed, justify it with a question it answers that the aggregates can't.

Respect GA4 limits: event names up to 40 characters, at most 25 parameters per event, parameter values up to 100 characters, and the property's custom dimension quotas.

---

# Phase 3 — Multiplayer reliability

Make it measurable how often online play breaks, using events or parameters such as:

- realtime channel disconnected / reconnected / failed to reconnect (with `game_phase` and `duration_ms` offline)
- a seat handed to a computer, with `reason`: `timeouts` or `disconnect`; and the seat reclaimed
- Party Mode: a phone dropping and pausing the table; the 2-minute pause ending in a computer taking over
- room-level failures from RPC error codes (room full, room not found, age required, …)
- lobby wait time: from room created to game started, and from joining to game started

Never send another player's name, ID or any personal information.

---

# Phase 4 — Funnels to support

Design the events so these can be built in GA4 Explorations:

1. **Visitor → player:** landing → play mode selected → age check completed → signed in or guest → sat at a table → `game_started`
2. **Invite loop:** `room_created` → `invite_shared` → friend `room_joined` (`entry_point: invite_link`) → `game_started` → `game_completed`
3. **Quick match:** `matchmaking_started` → `match_found` → `game_started` → `game_completed`
4. **Party Mode:** `party_screen_opened` → `party_controller_joined` → `game_started` → `game_completed`
5. **Completion:** `game_started` → `game_completed` (versus `game_abandoned`), split by mode, play context and seat takeovers
6. **Rematch:** `game_completed` → `rematch_requested` → `rematch_started`
7. **Offline → online:** first practice game → first online game
8. **Guest → account:** guest plays → `sign_up` / upgrade
9. **Retention:** first game → second game → returns on a later day → streak milestones

Identify any other funnels the code suggests.

---

# Phase 5 — Application-side architecture

GTM is the delivery layer. Components should not call `gtag()` or `dataLayer.push()` directly.

Build one typed analytics module in `lib/analytics/`, next to the existing files, that:

- centralizes event names and their parameter types. Misspelt or unknown events (`gameStarted`, `Game Started`, `game-start`) must fail to type-check.
- validates and strips `undefined`/`null`, and caps string lengths
- pushes a flat, consistent object to `window.dataLayer`
- **does nothing** when GTM isn't loaded: in the Capacitor app build, on server render, for under-13 devices or accounts, and when analytics consent is denied
- protects against duplicate events (Phase 9)

**PostHog decision:** PostHog has almost no custom events today. Decide whether this module should send the same domain events to PostHog as well. That would give one catalog and two destinations, and it would also cover app users, who never reach GA. Present your recommendation in the review step. Don't change PostHog behaviour before it's approved.

**Loading GTM:** GTM already loads in `app/layout.tsx`, so build on it rather than rewriting it. What's left:

- **Remove the direct `gtag.js` snippet.** Once GA4 is delivered through the container, delete the `G-75GZQ69MCG` `<Script>` tags so GA is loaded only once. Plan the order so there is no gap and no double counting:
  1. configure the Google tag in the container
  2. preview it
  3. publish it, with approval
  4. deploy the code change that removes the direct snippet
- **Gate GTM for children and consent.** The GTM snippet is a static script that runs for everyone today. Make sure it doesn't load, or sends nothing, on under-13 devices (Phase 7). Consent Mode defaults must be pushed *before* the GTM snippet runs (Phase 11). If that means changing how the snippet loads, check what the installed Next.js recommends for third-party scripts.

Remember that `/screen` runs on TV browsers as old as Chromium 79 (LG webOS). Analytics code must not break that page.

---

# Phase 6 — Identity

- Guests get a Supabase auth user too. Determine whether a privacy-safe internal identifier can be used as GA4 User-ID. If so, decide whether to send the raw auth UUID or a salted hash, and explain why it's safe.
- Using User-ID needs a privacy policy update and approval. Propose it; don't switch it on silently.
- Never send names, emails, phone numbers, display names, friend codes, room codes, auth tokens, ages, birth dates or IP-derived identifiers.
- Distinguish anonymous visitors, guest players and signed-in players.

---

# Phase 7 — Privacy, children and URLs

- **Under-13:** no GA/GTM data at all for any device that answered under 13, or for an account the server marks as under 13. Hook into the same places as `stopAnalyticsForChild` and `deviceAgeBlocked()`. Prevent GTM from loading at all where possible, and stop pushes if the answer comes mid-session.
- **Redact URLs:** remove or replace `id`, `code`, invite, tournament, replay and any other access-granting query parameters from `page_location`, `page_referrer` and `page_title` before they reach GA. Check the actual routes for every such parameter. Room and tournament IDs must not appear in GA in any form that would let someone join.
- **`game_id`:** reuse an existing match identifier if one exists that does not grant access. If the only available ID grants access (such as a room ID), send a one-way hash of it instead.
- **Errors:** report error *codes* from an allow-list, never raw messages, stack traces, URLs or RPC payloads.
- **Video and voice:** only whether they were used. Never anything about who was on camera.

---

# Phase 8 — User properties

A few low-cardinality properties only, for example:

- `player_type`: `guest` or `signed_in`
- `app_locale`: one of the 8 supported locales
- accessibility adoption such as `colorblind_mode` and `reduced_motion` (booleans), if useful
- `graphics_quality` preset, if useful
- a coarse `level_bucket`

Never an age or age bucket. Never rapidly changing game state.

---

# Phase 9 — Duplicate event protection

Events must represent real domain transitions, not renders. They must not fire again because of:

- React Strict Mode double effects in development
- rerenders of `Simulator`, or zustand store updates in `room-store`
- realtime reconnects that replay or rehydrate room state
- refreshing the page on a finished match, or joining mid-game
- the same player having the table open in two tabs
- Party Mode, where the TV and phones all observe the same game

Fire lifecycle events where the state transition happens, and de-duplicate per `(event, game_id, player)`. For example, keep a short-lived record in `sessionStorage`, wrapped in try/catch. Test each of the cases above.

---

# Phase 10 — GTM and GA4 configuration (do it in Chrome)

Using your browser access and the guardrails above:

1. Open container `GTM-N7X49V9F` and record its current state, including any tags already firing on luddohouse.com.
2. Add (or confirm) the Google tag for the Luddo House GA4 stream `G-75GZQ69MCG`. Then remove the direct `gtag.js` snippet from the code, in the order given in Phase 5.
3. Use a **scalable generic setup** rather than one tag per event: Data Layer Variables, a Custom Event trigger that matches the event catalog, and a GA4 Event tag that uses the pushed event name with mapped parameters.
4. Configure Consent Mode v2 defaults (see Phase 11).
5. Make sure GA4 page views come from one source only, with redacted URLs, and that App Router client-side navigations are counted exactly once.
6. Propose the custom dimensions and metrics you need, then create them after approval.
7. Propose key events, likely `game_started`, `game_completed`, `sign_up` and `room_joined` via invite. Mark them after approval.
8. Set up internal/developer traffic filtering so testing doesn't pollute production data.
9. Test in GTM Preview / Tag Assistant and GA4 DebugView.
10. Ask before publishing the container. After it's published and the code is deployed, verify on production with Realtime.

Record in the docs exactly what you configured: container ID, variables, triggers, tags, custom definitions and key events.

---

# Phase 11 — Consent

There is no consent banner today, and GA and GTM run unconditionally on the web. Review the current behaviour and present the options, for example Consent Mode v2 with region-specific defaults for the EEA/UK, with or without a consent banner. Recommend one. **Don't build a banner without approval.** If one is approved, all of its text must go through the app's i18n system with complete catalogs for all 8 languages.

Never get around browser privacy controls or a user's choice.

---

# Phase 12 — Documentation

Create `docs/analytics.md` with:

- the real player journey diagram
- an event table: | Event | When and where it fires | Parameters (type, required/optional) | Example payload | Question it answers |
- the per-player vs per-match counting rule
- user properties, custom dimensions, metrics and key events
- what is never sent and why (children, URLs, PII)
- the GTM/GA4 configuration as built
- how GA4 and PostHog divide the work

---

# Phase 13 — Reports

Explain how to build the following, and which belong in GA4 versus PostHog, Supabase (`match_results`, `match_events`) or a BigQuery export:

- DAU / WAU / MAU; new vs returning players
- games started and completed; completion and abandonment rate by mode, play context and seat count
- average game duration by mode; games per player
- way-to-play mix and mode popularity; Luddo vs Snakes & Ladders
- invite link conversion; quick match success rate and wait time
- Party Mode completion
- seat takeover rate, reconnect success rate, realtime failure rate
- rematch and Play again rate; streak retention
- guest → signed-in conversion by sign-in method
- adoption of chat, voice, video, reactions, dice verification and accessibility settings

---

# Phase 14 — Quality assurance

Test locally first, then on production after deploy.

## Local testing

- **Don't touch the user's running dev server on port 3000 or the `.next` folder.** Port 3001 is a different project.
- Build in a separate git worktree and serve it on another port, such as 3917. Check the page `<title>` to confirm it's this app. Use local Supabase where you need online play.
- Use GTM Preview against the local build.

## Scenarios

- new visitor; returning visitor
- guest; signed-in player; guest who signs in mid-session
- age check answered 13+ (events flow) **and** under 13 (nothing reaches GA from that point, including after a refresh)
- practice vs computer players; Table Together
- create private room → share link → second Chrome profile joins → play → finish
- win, loss, Team Up win
- leave mid-game; seat taken over by a computer after timeouts; disconnect and reclaim the seat
- rematch; Play again
- quick match, **locally only**
- Party Mode: `/screen` plus phones emulated in Chrome
- Snakes & Ladders
- refresh during a game and on the results screen; two tabs on one table
- a right-to-left locale (Urdu or Arabic), to check event values aren't localized text
- the Capacitor build (`npm run build:capacitor`) contains no GTM/GA code

## What to verify

Each event must fire:

- exactly once
- with the correct parameters
- with no undefined/null values
- with no PII and no room or invite IDs in any URL field
- with nothing duplicated by React rendering or reconnects

Run `npm test` and `npm run lint`, and add unit tests for the analytics module: type safety, sanitizing, de-duplication and the under-13 off switch.

---

# How to work

1. Read `docs/LLM_CONTEXT.md` and `AGENTS.md`.
2. Audit the code and the GA4/GTM accounts (read-only).
3. Document the real journey.
4. Propose the taxonomy, the PostHog decision, the identity approach, the consent approach and the URL redaction rules.
5. **Stop and present these for review before changing any code or any Google configuration.**
6. Implement the analytics module and the under-13/consent/URL safeguards around the existing GTM snippet.
7. Instrument lifecycle, multiplayer, social and reliability events.
8. Configure GTM and GA4 in Chrome, within the guardrails.
9. Write `docs/analytics.md` and draft the privacy policy wording change.
10. Run the QA scenarios.
11. Report exactly what changed.

Don't refactor unrelated code. Don't change game behaviour or the server rules engines. Don't add tracking to every button. Analytics should represent meaningful **domain events**.

---

# Final deliverables

1. **Player journey:** a diagram of the real flows, including Party Mode and offline play.
2. **Measurement plan:** the event taxonomy, parameters, user properties and the counting rule.
3. **Implementation:** the code changes, with tests.
4. **GTM configuration:** what was built: container ID, variables, triggers, tags.
5. **GA4 configuration:** custom dimensions and metrics, key events, filters, audiences, including anything still waiting for approval.
6. **Funnels:** how to build each funnel above.
7. **QA report:** each scenario tested and its result, with GTM Preview / DebugView evidence.
8. **Gaps:** what can't be measured reliably. For example, app users are invisible to GA by design, and tab closes are only partly detectable.
9. **Recommendations:** for example, BigQuery export, server-side events from `match_results` for match-level truth, or a clearer split between GA4 and PostHog.
10. **Privacy changes:** the drafted privacy policy wording and anything that needs the owner's decision.
