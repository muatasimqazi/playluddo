# Luddo House: context for an AI assistant

Use this as background on the product. It describes what is built as of 1 October 2026. If something isn't covered here, say you don't know. Don't guess at features.

---

## 1. What it is

**Luddo House** (tagline: *Let's Play Luddo*) is a multiplayer Luddo game played at a realistic 3D table in a furnished room. It runs in the browser at **https://luddohouse.com**, and there are iOS and Android apps built from the same code.

People play with friends and family: they create a private room and share a link, and friends join from a browser with just a name. There's also offline practice against computer players, pass-and-play on one device, a Party Mode that puts the table on a TV with phones as controllers, and Snakes & Ladders on the other side of the board.

**Naming:**
- The game is spelled "Luddo", with two d's, everywhere: the brand (*Luddo House*, *Let's Play Luddo*) and the game itself ("a Luddo night", "play Luddo online"). Never write "Ludo" or "Ludo House".
- Many people know the game as "Ludo". If someone asks, it's the same game; the About page (luddohouse.com/about) explains the spelling.
- Early planning documents call the product "Luddo Rivals". That name is obsolete.

## 2. Audience and values

- **Who it's for:** friends and families who live apart, and groups who want a game night. It's aimed at teens and adults. Online play is 13+, and video is 18+.
- **The feeling:** sitting round a real table with your people. Warm, social and playful, not competitive grinding.
- **What makes it different:**
  1. **Made for a real table:** a 3D table in a choice of rooms, joining from a link without installing anything, faces on the seats over video, and Party Mode on a TV.
  2. **No ads and no betting:** no interstitial ads, coins, entry fees, pots, prize money, loot boxes, spin wheels or energy timers. Nothing is for sale. Every cosmetic is earned by playing.
  3. **Your rules:** the host of a private room chooses house rules, which everyone at the table can see.
  4. **Dice you can check:** online dice are rolled on the server, and after a match players can check the recorded rolls against a commitment the server published before play began.
  5. **Everyone can play:** colour-blind mode, symbols on every seat, screen-reader announcements, full keyboard control, reduced motion, and 8 languages.

## 3. Luddo rules (Classic, the default)

- **Players and board:** 2–4 players on the standard board, and 5–6 players on a hexagonal board. Each player has 4 pawns of one colour, and pawns start in their base (the "nest").
- **The track:** the shared track has 52 cells, and all colours move clockwise. A pawn walks 51 cells round the track, then up to 6 cells up its own home lane: 57 steps in all.
- **Safe cells:** the 4 entry cells and 4 star cells are safe (8 in total). No capture can happen on a safe cell.
- **Leaving base:** you need a 6 to bring a pawn out onto your entry cell.
- **Sixes are rolled first.** A 6 is rolled again straight away, before anything moves. The first roll that isn't a 6 ends the rolling. You then move by each die in the order rolled: 6, 6, 3 means a move of 6, then 6, then 3. Each die must be used before the next: a die with no legal move when its turn comes ends the moving, and the dice after it are lost. So a 6 that no piece can move doesn't earn another roll; if it's the first 6 of the turn, the turn ends on that roll. (This rule changed on 1 October 2026. Before that, each 6 was moved straight away and then earned another roll. On 2 October 2026 a die with no legal move stopped being skipped, because skipping let an unusable 6 buy a free roll.)
- **Three sixes in a row** count for nothing: none of them is moved, and the turn passes.
- **Capturing:** landing exactly on an opponent's pawn on a non-safe cell sends it back to base. It captures every opponent pawn on that cell. Your own pawns can share a cell freely.
- **Extra roll:** a capture earns one extra roll, taken after the turn's dice are used up. So does getting a pawn home, while the "extra roll for getting home" rule is on (it's on by default). However many moves qualify, a turn earns at most one extra roll. A player's last pawn getting home ends their game, so it earns nothing.
- **Exact roll home:** you need the exact number to move up the home lane or reach home. A pawn that would overshoot can't be chosen for that die.
- **No blockades in Classic:** two pawns of one colour on a cell don't block anyone. Blockades exist only as a house rule.
- **Winning:** the first player to get all 4 pawns home wins. The others keep playing for 2nd, 3rd and so on, until every place is decided.
- **Timers:** each decision (roll, then choose a pawn) has its own countdown, 15 seconds by default (10 or 30 as a house rule). If time runs out, the server rolls or moves for that player. After 3 missed decisions in a row, or 45 seconds disconnected, a computer takes over the seat. The player can reclaim it by coming back at any point before the match ends.

## 4. Modes and house rules

| Mode or preset | What changes |
|---|---|
| **Classic** | The rules above |
| **Quick** | 1 pawn starts on the board, and 2 pawns home wins. Aimed at games under 7 minutes |
| **Master** | You must capture at least once before your pawns can enter the home lane |
| **Rush** | A 5- or 10-minute clock. When it runs out, players are ranked by pawns home, then total progress |
| **Family** | 30-second turns, with the extra roll for getting home |
| **Team Up (2v2)** | Partners sit opposite (red + yellow, green + blue). They can't capture each other and can share cells. Once your own pawns are home, you move your partner's. A team wins when all 8 of its pawns are home |

- **House rules panel:** in a private room, the host can switch individual rules: extra roll for getting home, blockades, pawns that start on the board, pawns needed to win, capture before going home, and the turn timer. Only combinations on a tested allow-list are accepted, and the rest are greyed out.
- **Where modes are offered:** quick match offers Classic or Quick only. Team Up is offered in private rooms, team rooms and Party Mode.

## 5. Snakes & Ladders

The wooden board has two printed faces; you flip it to play Snakes & Ladders.
- **The basics:** one piece each, starting off the board. A 6 is needed to enter, and the piece goes straight to square 6. Ladders lift a piece and snakes slide it down. A 6 earns another roll, and pieces never capture.
- **Finishing:** an exact roll is needed to reach 100, and overshooting leaves the piece where it is. Everyone keeps playing until every place is decided.
- **House rules:** any roll to start, bouncing back off 100, and a second board layout.

## 6. Ways to play

- **Practice:** offline against computer players at Easy, Normal or Hard. It needs no account or internet, and the last move can be undone.
- **Table Together:** pass-and-play for 2–4 people sharing one device. Undo works here too.
- **Private room:** the host creates a room and shares a link or code, and friends join from any browser with just a name. Empty seats can be filled with computer players. A rematch keeps the room's rules.
- **Quick match:** matchmaking into a Classic or Quick game.
- **Party Mode:** open **luddohouse.com/screen** on a TV or on a laptop connected to one. Phones scan a QR code and become controllers: a big Roll button, then a mini-board for choosing a pawn. The first phone is the VIP, who picks the game and rules and starts it. Extra phones can join as an audience, sending reactions, predicting the winner (bragging rights only) and voting for the moment of the match. In Party Mode, chat and voice are off and turns are 30 seconds. A phone that drops pauses the table for up to 2 minutes before a computer takes its seat.
- **Cast to TV:** where the browser supports it, a table can be cast to a TV.
- **Watching live tables:** friends and teammates can watch a table without a seat, sending reactions only. Watching is off by default. The host turns it on, and any seated player can turn it off.
- **Teams and tournaments:** private teams have weekly seasons with standings, champion badges and shareable recap cards. Private tournaments take 8 or 16 players at 4-player tables, with the top two of each table going through. The winner gets a trophy and a badge. There are no entry fees and no prizes.

## 7. The 3D table

- **Rooms:** Apartment (the default, overlooking a city skyline), Mahogany Study, Café, Lake Cabin and Rooftop.
- **Boards:** Signature, Classic, Geometric and Aladdin artwork.
- **Pieces:** glass discs by default, with marble and wood styles to earn. Pieces stack on shared cells, and a finished piece slides off the board into a slot beside its base.
- **Dice:** a physical die that tumbles, in Classic, Glass, Marble and Wood skins.
- **Camera:** Seated, Overhead and Table views, plus orbit, pan and zoom (keys `L`, `1`, `2`, `3`). There's an optional action camera for captures and finishes, the board can be rotated, and the last roll and move can be replayed.
- **Graphics:** quality presets, with automatic step-down on slow devices.

## 8. Talking at the table

- **Reactions:** emoji plus quick phrases ("Nice move!", "Good game"), shown as speech bubbles over the seat.
- **Chat:** text chat at the table, with rate limits and filtering.
- **Voice:** a voice call at the table.
- **Video:** players' faces appear on cards above their seats; on phones it's a strip of tiles. Video is only in private rooms, never in quick match. It needs every human at the table to be signed in and 18+. Cameras are off by default, and video is never recorded.
- **Safety controls:** every video tile has Report and Block. Blocking stops your audio and video reaching that person. One tap hides all incoming video.
- **Friends:** add friends by code or from a recent table, see who's online, and invite them to a table in one tap. "Play again" lists your last 5 tables.

## 9. Progression (earned, never bought)

- **What you earn:** XP and levels (shown on seats), a daily streak with milestones at 3, 7 and 30 days, about 30 achievements, and cosmetics: rooms, boards, dice, pieces and reaction packs.
- **What counts:** only completed online games that the server recorded. Games against computers only, very short custom rules and repeated games with the same people earn reduced credit. Quitting earns nothing. Offline games show stats on that device only.
- **Game Center:** on iOS, achievements and the leaderboard are mirrored there.
- **Profile:** games played, win rate by mode, captures, sixes, head-to-head records and favourite colour. Players can hide their profile.
- **End of a game:** the summary shows rankings, captures, sixes, turns, pawns home and missed decisions. It also has a dice chart of each player's rolls against the expected 1-in-6 line, and a replayable "moment of the match". Full match replay and 6–10 second highlight clips can be shared.

## 10. Fair dice

- **Online:** rolls happen on the server with unbiased random numbers. Players only send "roll" and "move" requests, and can't decide outcomes.
- **Checking the dice:** at the start of a match the server publishes a hash of a secret seed. At the end it reveals the seed, and a "Verify dice" sheet recomputes every roll in the browser.
- **The caveat:** this proves the recorded rolls match the commitment made before play. It doesn't independently prove how the seed was chosen. Describe it with that caveat.

## 11. Accounts, age and safety

- **Signing in:** players can play as a guest or sign in with Google, an email code, a phone code, or Game Center on iOS. Signing in after playing as a guest keeps the guest's progress.
- **Age check:** before their first online table, everyone is asked their birth month and year once. Online play needs 13+, and video needs 18+. Under-13s keep offline practice and Table Together.
- **Keeping table rules:** players agree to short table rules ("Keep the table friendly"). Names are filtered, and players can report and block each other. Reports are reviewed within 24 hours.
- **Under-13 data:** minimal, and deleted after 30 days without activity.

## 12. Languages and accessibility

- **Languages:** English, Hindi, Urdu, Arabic, Bengali, Indonesian, Spanish and Portuguese (Brazil). Urdu and Arabic are right-to-left, and the interface mirrors for them. Some in-game table text is still English only.
- **Accessibility:**
  - **Seat symbols:** every seat has a symbol, so identity never depends on colour.
  - **Colour-blind palette:** tested against protanopia, deuteranopia and tritanopia.
  - **Screen readers:** announcements for rolls, moves, captures and turns.
  - **Keyboard:** full control (Space rolls, arrow keys pick pawns).
  - **Reduced motion and text size:** a reduced-motion mode, and a 12px minimum text size.

## 13. Platforms and status

- **Web:** live at luddohouse.com.
- **iOS and Android apps:** built with Capacitor from the same code. The App Store release isn't finished, store listings haven't been written, and some store privacy disclosures for video are drafted but not yet submitted. Don't say the apps are "available on the App Store / Google Play" without checking.
- **Price:** there are no purchases of any kind today.

## 14. What not to say

- **Gambling language:** anything about coins, wagers, pots, prize money, "win big" or rewards of value.
- **Things that don't exist:** made-up features, reviews, ratings or download counts.
- **Fairness overclaims:** don't call the dice "certified fair" or "provably fair". Use "dice you can check", with the caveat in section 10.
- **Competitors:** don't name them in marketing copy. (Ludo King, Ludo Club and Ludo STAR are the main ones.)
- **Children:** don't aim copy at them.

---

## Appendix: technical summary (for coding questions)

- **Stack:**
  - **Web app:** Next.js 16 (App Router) and React 19. This Next.js version has breaking changes; read `node_modules/next/dist/docs/` before writing Next code.
  - **3D:** React Three Fiber, Drei and Three.js.
  - **Backend:** Supabase (Postgres, Auth, Realtime, Edge Functions).
  - **Client:** Zustand for state, Tailwind CSS 4 for styling, PostHog for analytics.
  - **Native apps:** Capacitor 8 (static export, so routes use query parameters such as `/room?id=…` instead of dynamic segments).
- **Two rules engines:** the server engine is authoritative and written in plpgsql in `supabase/migrations/`. A TypeScript mirror in `lib/board/` handles offline play and highlighting moves. Every rule change goes into both, with a parity test suite (`tests/parity`) and pgTAP tests (`supabase/tests`).
- **Rules as data:** room rules live in one `rooms.rules` jsonb column (`RoomRules` in `lib/board/types.ts`).
- **How clients talk to the server:** only through RPCs such as `request_roll` and `request_move`. Game history is a durable `match_events` log, and `match_results` stores each player's per-match stats.
- **Key folders:**
  - `components/simulator/`: the live 3D table (`Simulator.tsx`, `SimulatorScene.tsx`, the rooms, the pawns).
  - `components/controller/`, `components/party/`: Party Mode.
  - `lib/presentation/`: board-to-3D mapping, the animation timeline, practice.
  - `lib/i18n/`: translations.
  - `components/arena/` and the old summary components: dead code from before the 3D table.
- **Tests:** `npm test` (TypeScript rules and presentation), `supabase test db`, `npm run test:parity`, `npm run test:multiplayer`.
