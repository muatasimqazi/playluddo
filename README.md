# Let's Play Luddo

Fast, server-authoritative online Ludo with private rooms, bots, and a responsive web arena.

- **Product spec:** [`docs/PRD.md`](docs/PRD.md)
- **Engineering handoff (schema, RPC contracts, build sequence):** [`docs/IMPLEMENTATION_HANDOFF.md`](docs/IMPLEMENTATION_HANDOFF.md)
- **Design references:** [`designs/`](designs/)

## Stack

Next.js (App Router) · Supabase (Postgres, Auth, Realtime — pure Postgres functions, no Edge Functions layer) · Tailwind CSS · Capacitor (prep-only, not built this phase).

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in from `supabase status` once you've run `supabase start`
supabase start                      # local Postgres + Auth + Realtime
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project layout

See `docs/IMPLEMENTATION_HANDOFF.md` Section 2 for the full rationale. Short version:

```
app/                  # Next.js routes: / (home), /room/[roomId] (lobby/arena/summary)
lib/board/            # Board geometry + rules engine (TypeScript) — client-side rendering/highlighting only
lib/supabase/         # Browser Supabase client, anonymous-auth helper, typed RPC wrappers
lib/realtime/         # Room channel subscribe + activity-feed fetch
lib/hooks/            # useRoomConnection (session -> claim_seat -> snapshot -> subscribe), useCountdown
lib/store/            # Zustand room store
components/           # lobby/ arena/ summary/ shared/
supabase/migrations/  # Schema, RLS policies, and the authoritative plpgsql rules engine/RPCs
supabase/tests/       # pgTAP tests: rules engine, RLS denial, and end-to-end RPC flow (`supabase test db`)
tests/rules-engine-ts/  # TS rules-engine unit tests, no DB dependency (`npm test`)
tests/parity/           # TS engine vs SQL engine golden-vector suite (`npm run test:parity`, needs `supabase start`)
```

## Testing

```bash
npm test              # TS rules engine unit tests — no DB needed
supabase test db       # plpgsql rules engine pgTAP tests — needs `supabase start`
npm run test:parity    # asserts both engines agree — needs `supabase start`
```

Current status: **M0 through M4 done (locally)** — core schema, both rules-engine implementations with a parity suite, RLS policies, the full RPC surface (including rematch), the `pg_cron` sweep job, and now a real Next.js UI (home, lobby, live arena, match summary) wired to Supabase Realtime and Auth. Verified with an actual headless-browser playtest — create room → fill bots → start match → roll → bot turns auto-resolving — with zero console errors, which caught and led to fixing a real bug (`create_room`/`join_room`/`fill_bot` weren't broadcasting state updates; see `docs/IMPLEMENTATION_HANDOFF.md` Section 9). **RLS policies still need product-owner sign-off before touching staging/production** — passing locally is not that sign-off (see `docs/PRD.md` Section 10, Open Question #8). Not yet done: mobile/accessibility pass, preset reaction chips, cross-browser and multi-human-player testing. See `docs/IMPLEMENTATION_HANDOFF.md` Section 10 for the full build sequence.
