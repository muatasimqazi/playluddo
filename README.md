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
lib/supabase/         # Browser Supabase client
components/           # lobby/ arena/ summary/
supabase/migrations/  # Schema, RLS policies, and the authoritative plpgsql rules engine/RPCs
```

Current status: **M0 scaffolding** — see the build sequence in `docs/IMPLEMENTATION_HANDOFF.md` Section 10 for what's next (M1: schema + both rules-engine implementations + parity tests).
