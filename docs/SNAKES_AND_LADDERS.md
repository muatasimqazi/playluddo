# Snakes & Ladders

The wooden table board has two printed faces. Use **Flip board** in practice or in a private-room lobby. Only the host can change a private room's game, before the match starts. A rematch keeps that choice and returns to the lobby, where the host can flip again.

Practice saves both games independently on the device. Flipping pauses the current side and resumes the other; **Start a fresh practice** resets only the visible game.

## Rules and artwork

- One glass piece per player, beginning off the board at square 0.
- A six is needed to enter, and the piece goes straight to square 6 (`20260921010000_snakes_six_to_enter_and_two_player_win.sql`). Pieces move automatically along the numbered, alternating rows.
- Land on a ladder's foot to climb; land on a snake's head to slide.
- Rolling a six grants another roll. Pieces can share squares without capturing.
- An exact roll is required to reach 100; overshooting leaves the piece where it is and ends the turn.
- Finishers are recorded in order and skipped. Everyone continues until all places are decided.

The default board artwork lives at `designs/snake-and-ladder/snakes-and-ladders-board.svg`. Its checkerboard and numbers are vector SVG, with the snake and ladder artwork embedded as image elements. Like the Luddo print, it uses an unlit material to preserve its colors. Numbering runs from square 1 at the bottom-left up to 100 at the top-left, alternating direction each row.

Default board (board 0):

- Ladders: 3→23, 4→16, 7→27, 9→30, 17→37, 28→54, 36→65, 50→73, 71→91, 77→84.
- Snakes: 22→2, 26→6, 59→40, 64→44, 82→62, 87→46, 93→72, 95→75, 98→38.

## House rule variants (F2.6)

The host picks these in a private-room lobby; they are off by default so the game plays as above. All three sit outside the Ludo allow-list and combine freely.

- **Any roll to start** (`snakesAnyRollToStart`): a piece joins the board on any roll, not only a six.
- **Bounce back off 100** (`snakesBounceBack`): overshooting 100 bounces back off the end instead of the piece staying put.
- **Second board** (`snakesBoard`, 0 or 1): a second printed board with its own snakes and ladders. Its lightweight vector artwork is `designs/snake-and-ladder/snakes-and-ladders-board-2.svg`, generated to the same 1–100 numbering as the default so pieces land correctly.
  - Ladders: 2→23, 8→26, 20→41, 32→51, 40→59, 63→81, 74→92, 85→95.
  - Snakes: 17→7, 30→9, 43→22, 54→34, 66→45, 76→58, 89→68, 97→79.

The rule keys live in `RoomRules` (`lib/board/types.ts`), resolve identically on both engines (`lib/board/rules.ts` and `private.ludo_resolve_rules`), and the two boards' jump tables are `SNAKES_LAYOUTS` in `lib/board/snakes.ts`, mirrored by the `private.snakes_move` CASE tables. Apply `supabase/migrations/20260928210000_snakes_variants.sql` (the two rule toggles) and `20260929020000_snakes_second_board.sql` (the second board) for the server half.

## Multiplayer and deployment

Apply `supabase/migrations/20260918020000_snakes_and_ladders.sql` and `supabase/migrations/20260918030000_svg_snakes_board.sql` before deploying the client. The first adds `rooms.game_type` (default `ludo`) and the authenticated, host-only `set_room_game` RPC. The second aligns server movement with the custom SVG artwork. Existing rooms remain Luddo.

Private games use the existing locked roll RPC, server-generated dice, connection tokens, bot/timeout handling, durable events, and private realtime snapshots. A Snakes & Ladders roll emits both its roll and move in one transaction. The presentation timeline animates them in order and can replay the action. Bot turns allow enough time for the full roll and slide animation.

`lib/board/snakes.ts` is the offline practice rules mirror. `npm run test:parity` compares every square and die against the SQL engine. Other checks: `npm test`, `supabase test db`, and `npm run test:multiplayer` (local Supabase only).
