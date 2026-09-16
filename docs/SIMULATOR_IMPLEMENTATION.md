# Apartment simulator

The experience now uses one full-viewport React Three Fiber scene. The apartment, coffee table, board, pieces, and die share the same perspective camera and lighting. The old DOM-measured board is no longer on the match rendering path. Its files are retained so the earlier work remains available.

The board surface uses `designs/board-design.png` through a static asset import. An sRGB canvas applies the source PNG's Adobe RGB ICC profile before GPU upload, preserving the intended ink hues. Texture UVs remove the image's 128px print margin without modifying the source, aligning its printed grid to the canonical 15×15 layout. Resting pieces sit on the four corner stars in each home area, leaving the central emblems visible.

The printed surface uses a matte physical material with reduced reflections and bypasses filmic tone mapping, which otherwise desaturates the bright green and yellow inks. Its neutral albedo compensates for the room's light intensity; lighting and shadows still affect the board.

Playing pieces are low, rounded glass discs inspired by the supplied counter reference. Their physical materials use transmission, refraction, colored absorption, and polished highlights rather than alpha-only transparency. Shared-square pieces form small vertical stacks; movement lifts from the current stack height and settles onto the destination stack. Selection rings and padded hit targets remain separate from the glass geometry.

## Run and play

- `/`: apartment entrance, private-room creation, joining by code, and practice entry.
- `/practice`: an explicitly offline game against three computers, using the existing TypeScript rules. The session survives reloads. Start a fresh game from the table menu.
- `/room/[roomId]`: private multiplayer lobby, live table, and match completion/rematch. Online rolls and moves still go exclusively through the existing authoritative Supabase RPCs.

Apply the two new database migrations to each environment before releasing this version. Both have been applied and tested locally; no remote deployment was performed.

```sh
supabase migration up --local
npm run dev
```

The chat migration adds `table_messages` and `send_table_message`. It checks membership, assigns the sender on the server, limits length and sending frequency, and broadcasts on the existing private room channel. It never grants clients permission to send arbitrary room broadcasts. The subsequent migration removes inherited API-role table-write privileges so the documented RPC-only mutation boundary is explicit.

## Controls

| Control | Action |
| --- | --- |
| Space / Roll dice / physical die | Send a roll intent when permitted |
| Highlighted piece / numbered piece button | Send a legal move intent |
| L / Look | Orbit, constrained pan, scroll or pinch zoom |
| R / Rotate board | Drag the board and release to snap to a quarter turn; arrow buttons also rotate |
| 1 / Reset view / Escape | Return to the seated view |
| 2 | Overhead view |
| 3 | Table view |
| Camera panel | Seated, overhead, table, north, east, and west views |
| Replay | Watch the previous roll and move locally; return to live at any time |

Camera, board orientation, graphics, sound, and action-camera preferences stay on the current device. Orientation is associated with the player's color. Entering rotation mode stops camera inertia; changing board orientation does not touch the camera, table, apartment, or network state.

## Implementation boundaries

- `components/simulator/Apartment.tsx`: modeled architecture, furniture, table, and decorative objects. Existing walnut texture plus a procedural fabric texture; no apartment photograph backdrop.
- `components/simulator/SimulatorScene.tsx`: camera controller, independently rotating board group, physical die, pieces, lighting, projected player labels, and quality settings. Device pixel ratio reduces under sustained low frame rate.
- `components/simulator/GlassPawn.tsx`: rounded disc geometry and four tinted glass materials, using the renderer's shared transmission pass.
- `components/simulator/Simulator.tsx`: simulator HUD, settings, actions, reactions/chat, replay controls, and match completion.
- `lib/presentation/board.ts`: maps canonical logical pawn positions to board-local coordinates and builds every movement waypoint, including home-lane transitions. World positions never enter game rules.
- `lib/presentation/camera.ts`: screen-aware camera framing. Portrait layouts preserve a horizontal field of view that includes the board and physical die; presets stay inside the apartment.
- `lib/presentation/timeline.ts`: deduplicates and serializes durable roll/move events. The die resolves to the recorded result before movement plays. Captured pieces return after the capturing piece arrives. Replay owns its own visual state and queues incoming live events without altering authoritative state.
- `lib/presentation/practice.ts`: offline-only state transitions using the established TypeScript rules and bot strategy.
- `lib/hooks/useRoomConnection.ts`: subscription plus snapshot reconciliation on join/rejoin, offline/foreground handling, durable event refresh, and recent chat recovery. Stale event sequences cannot replace newer room state.

Event gaps or failed event reads recover by snapping to an authoritative snapshot. Rejoining restores the current board instead of replaying an extended backlog. A human whose seat is being covered can reclaim it through the existing server RPC. Match completion keeps the scene mounted so the final movement can finish before the result appears.

## Verification

```sh
npm run lint
npx tsc --noEmit
npm test                  # Rules and presentation/replay tests
supabase test db           # Rules, permissions, RPCs, chat authorization and rate limiting
npm run test:parity        # TypeScript and SQL rules agree
npm run test:multiplayer   # Two isolated clients against local Supabase; cleans up its own data
npm run build -- --webpack
```

The multiplayer test refuses non-local Supabase URLs. It checks private subscriptions, identical state delivery, roll authority, rejection of another player's intent, chat identity/delivery, and snapshot recovery. It never uses an existing player's room.

Validated locally: 51 rules/presentation checks, 114 database assertions, 17 SQL/TypeScript parity cases, and the two-client multiplayer integration test. Lint and TypeScript checks pass. Desktop and phone-sized Safari previews were inspected for board framing, camera switching, input controls, and HUD layout. The camera regression test projects the board corners and die edge through the actual perspective camera at four screen ratios.

Webpack production compilation passed. Turbopack production compilation encountered an environment-specific CSS-worker port-binding error in the agent sandbox; the project still uses its existing default bundler configuration.

## Remaining visual and product depth

The environment is a procedural 3D reconstruction, not a scanned or artist-authored photorealistic apartment. The next fidelity pass should replace furniture/architecture with optimized GLB assets and baked indirect lighting while preserving the scene's interaction boundaries. Current reflections, materials, contact shadows, and directional lighting do not include screen-space ambient occlusion or depth of field.

Replay currently covers the previous action recorded since joining. Full-match replay browsing/export, a match-introduction sequence, elaborate victory effects, and unrestricted avatar customization are not included. Action camera provides restrained event-based framing changes, not authored camera shots for every capture. Dedicated mobile-device performance and accessibility audits remain appropriate before release.
