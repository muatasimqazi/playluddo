# Snakes & Ladders

The wooden table board has two printed faces. Use **Flip board** in practice or in a private-room lobby. Only the host can change a private room's game, before the match starts. A rematch keeps that choice and returns to the lobby, where the host can flip again.

Practice saves both games independently on the device. Flipping pauses the current side and resumes the other; **Start a fresh practice** resets only the visible game.

## Rules and artwork

- One glass piece per player, beginning off the board at square 0.
- Any die value enters. Pieces move automatically along the numbered, alternating rows.
- Land on a ladder's foot to climb; land on a snake's head to slide.
- Sixes give no extra roll. Pieces can share squares without capturing.
- An exact roll is required to reach 100; overshooting leaves the piece where it is and ends the turn.
- Finishers are recorded in order and skipped. Everyone continues until all places are decided.

The grid is cropped through texture UVs from `designs/snake-and-ladder.png`; the source image is unchanged. Like the Ludo print, both faces use an unlit material to preserve their colors.

Ladders: 4→16, 9→30, 21→42, 50→68, 63→81, 71→91.

Snakes: 14→6, 36→24, 54→46, 64→59, 94→88, 98→78.

## Multiplayer and deployment

Apply `supabase/migrations/20260918020000_snakes_and_ladders.sql` before deploying the client. It adds `rooms.game_type` (default `ludo`) and the authenticated, host-only `set_room_game` RPC. Existing rooms remain Ludo.

Private games use the existing locked roll RPC, server-generated dice, connection tokens, bot/timeout handling, durable events, and private realtime snapshots. A Snakes & Ladders roll emits both its roll and move in one transaction. The presentation timeline animates them in order and can replay the action. Bot turns allow enough time for the full roll and slide animation.

`lib/board/snakes.ts` is the offline practice rules mirror. `npm run test:parity` compares every square and die against the SQL engine. Other checks: `npm test`, `supabase test db`, and `npm run test:multiplayer` (local Supabase only).
