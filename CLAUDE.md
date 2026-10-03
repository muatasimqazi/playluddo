@AGENTS.md

# Luddo House

3D multiplayer Luddo (Next.js App Router + React Three Fiber + Supabase), shipped as a website (Vercel) and iOS/Android apps (Capacitor). Product background: `docs/LLM_CONTEXT.md`. The game is spelled **Luddo** in all copy, never "Ludo".

## Commands

```bash
npm run dev                # :3000 — the user's own dev server; don't kill it or touch .next
npm test                   # TS rules engine, presentation, i18n, analytics — no DB
npm run lint && npx tsc --noEmit
npm run build              # web build (dynamic)
npm run build:capacitor    # static export for the apps (output: "export")
supabase test db           # pgTAP; needs `supabase start`
npm run test:parity        # TS engine vs SQL engine; needs `supabase start`
npm run test:multiplayer   # two real local clients; needs `supabase start`
```

## Things that bite

- **Two builds.** Routes must work in both `npm run build` and `npm run build:capacitor`. The static export can't serve `[id]` routes keyed by runtime IDs, so use query params (`/room?id=`, `/replay?match=`, `/tournaments/view?id=`).
- **Two rules engines.** The authoritative one is plpgsql in `supabase/migrations/`; `lib/board/` is a TS copy for client highlighting and offline practice. A rule change goes in both, then `npm run test:parity`.
- **Live match UI is `components/simulator/`** (`Simulator.tsx` for HUD/menus, `SimulatorScene.tsx` for 3D). `components/arena/` is mostly dead code. Check a component is imported before editing it.
- **drei `<Html>` is a separate React root** with no app providers (no i18n context): pass strings in as props.
- **i18n is client-side** (`lib/i18n`), not `app/[lang]`. Each of the 8 catalogs in `lib/i18n/messages/` is typed as the full English `Messages`, so a new key goes in all 8.
- **Old browsers.** `browserslist` targets Chrome 79 (LG TVs). Syntax is down-leveled, but newer runtime APIs need a polyfill or a guard.
- **Migrations** are timestamped `supabase/migrations/YYYYMMDDHHMMSS_name.sql`; apply locally with `supabase migration up --local`. Never push to the hosted project from here.

## Conventions

- Commits: conventional prefix with a plain-English, player-facing subject, e.g. `fix: keep Sign in on screen on tablets in portrait`.
- Adding a board/piece set touches artwork, `lib/presentation/*`, all 8 catalogs, a migration and tests; `git show --stat c5ab423` is the template.
