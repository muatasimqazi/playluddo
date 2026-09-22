# Luddo House

_Let's Play Luddo._

An immersive 3D Luddo table in a modern apartment, with server-authoritative private multiplayer rooms and offline practice against computers.

- **Product spec:** [`docs/PRD.md`](docs/PRD.md)
- **Engineering handoff (schema, RPC contracts, build sequence):** [`docs/IMPLEMENTATION_HANDOFF.md`](docs/IMPLEMENTATION_HANDOFF.md)
- **Design references:** [`designs/`](designs/)
- **Simulator brief:** [`docs/Immersive 3D Multiplayer Luddo Simulator.md`](docs/Immersive%203D%20Multiplayer%20Ludo%20Simulator.md)
- **Simulator implementation and controls:** [`docs/SIMULATOR_IMPLEMENTATION.md`](docs/SIMULATOR_IMPLEMENTATION.md)

## Stack

Next.js (App Router) · React Three Fiber / Drei / Three.js · Supabase (Postgres, Auth, Realtime) · Zustand · Tailwind CSS. Capacitor remains preparation-only.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in from `supabase status` once you've run `supabase start`
supabase start                      # local Postgres + Auth + Realtime
supabase migration up --local      # includes private chat and explicit API-role privileges
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). [Offline practice](http://localhost:3000/practice) works without Supabase.

## Player sign-in

The welcome screen supports Google, passwordless email, and phone OTP sign-in while keeping guest play available. Configure the hosted Supabase project under **Authentication → Sign In / Providers**:

- Enable Google and add its client ID and secret.
- Enable email OTP and set the site URL plus allowed redirect URLs for each deployed environment.
- Enable phone sign-in and configure an SMS provider such as Twilio. Phone numbers must use international format, for example `+15551234567`.

Profile display names are stored in Supabase Auth user metadata and automatically populate the player name used when creating or joining rooms. Provider credentials belong in Supabase secrets and must not be committed to this repository.

## Project layout

See `docs/IMPLEMENTATION_HANDOFF.md` Section 2 for the full rationale. Short version:

```
app/                  # / (entrance), /practice, /room/[roomId] (lobby/arena/summary)
lib/board/            # Board geometry + rules engine (TypeScript) — client-side rendering/highlighting only
lib/supabase/         # Browser Supabase client, anonymous-auth helper, typed RPC wrappers
lib/realtime/         # Room channel subscribe + activity-feed fetch
lib/hooks/            # Room subscription/reconnection/snapshot recovery and countdown
lib/presentation/     # Logical-to-3D mapping, event playback/replay, offline practice
lib/store/            # Zustand room store
components/simulator/ # Physical scene, apartment, cameras, HUD, settings, chat
supabase/migrations/  # Schema, RLS policies, and the authoritative plpgsql rules engine/RPCs
supabase/tests/       # pgTAP tests: rules engine, RLS denial, and end-to-end RPC flow (`supabase test db`)
tests/rules-engine-ts/  # TS rules-engine unit tests, no DB dependency (`npm test`)
tests/parity/           # TS engine vs SQL engine golden-vector suite (`npm run test:parity`, needs `supabase start`)
tests/presentation/     # Motion paths, playback ordering, replay isolation, recovery, practice
tests/integration/      # Isolated two-client local multiplayer and chat verification
```

## Testing

```bash
npm test              # TS rules engine unit tests — no DB needed
supabase test db       # plpgsql rules engine pgTAP tests — needs `supabase start`
npm run test:parity    # asserts both engines agree — needs `supabase start`
npm run test:multiplayer # two real local clients; removes its own test room and users
npm run lint
npx tsc --noEmit
npm run build -- --webpack # verified production build; also available if Turbopack workers are restricted
```

The original M0–M4 backend remains in place. The simulator redesign replaces the live arena and adds a coherent entrance/lobby, physical dice and pieces, independent camera/board controls, local replay, graphics presets, private chat/reactions, and offline practice. See the [implementation notes](docs/SIMULATOR_IMPLEMENTATION.md) for verification, architectural boundaries, and the remaining asset-fidelity and release-audit work. Local validation does not replace the staging/production RLS sign-off described in the original PRD.
