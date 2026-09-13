# Ludo Rivals

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
app/                  # Next.js routes
lib/board/            # Board geometry + rules engine (TypeScript) — client-side rendering/highlighting only
lib/supabase/         # Browser Supabase client
components/           # lobby/ arena/ summary/
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

Current status: **M0 + M1 + M2 done (locally)** — core schema, both rules-engine implementations (TS + plpgsql) with a parity suite proving they agree, RLS policies, and the core RPCs (`create_room`/`join_room`/`fill_bot`/`start_match`/`request_roll`/`request_move`/`get_room_state`) with row-locking and a full end-to-end pgTAP flow test. **M2's RLS policies still need product-owner sign-off before touching staging/production** — passing locally is not that sign-off (see `docs/PRD.md` Section 10, Open Question #8). See the build sequence in `docs/IMPLEMENTATION_HANDOFF.md` Section 10 for what's next (M3: turn-timer sweep job, bot takeover, reconnect/duplicate-session handling).
