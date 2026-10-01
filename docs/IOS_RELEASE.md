# Shipping Luddo House to the App Store

The iOS app is the same Next.js game, statically exported (`npm run build:capacitor`)
and wrapped in a Capacitor shell (`ios/`). It talks to the same Supabase project as
the website (whatever `.env.local` points at when you build).

## Build and run

```bash
npm run ios          # static export → cap sync → opens the project in Xcode
```

In Xcode pick a simulator or a plugged-in iPhone and press Run. After changing any
web code, run `npm run cap:sync` again (or just `npm run ios`) — the app embeds a
copy of the build, it doesn't load the website.

## What's already set up

- **Identity:** bundle id `com.luddohouse.app`, display name "Luddo House",
  version 1.0 (1), iPhone + iPad, iOS 15+, arm64, category Board Games.
- **Icon and launch screen:** branded (`ios/App/App/Assets.xcassets`).
- **Game feel:** full screen (status bar hidden), native haptics on rolls and
  moves, no long-press callouts / link previews / text selection on game UI,
  layouts respect the Dynamic Island, notch and home indicator.
- **Privacy:** `ios/App/App/PrivacyInfo.xcprivacy` declares what's collected (see
  "Privacy label" below); no tracking, so no App Tracking Transparency prompt.
  Google Analytics is left out of the app build.
- **Export compliance:** `ITSAppUsesNonExemptEncryption = NO` (HTTPS only), so
  uploads don't ask the encryption question.
- **Microphone and camera:** usage text is set for voice and video chat.
- **Game Center:** leaderboard, achievements and sign-in (see "Game Center" below).
- **Sign-in:** email and phone codes. "Continue with Google" is hidden in the
  app — Google blocks its sign-in inside embedded web views, and offering it
  would require Sign in with Apple as well (App Review guideline 4.8).
- **Links:** invite, room and team links shared from the app point at
  https://luddohouse.com, so friends can open them in a browser and join with
  just a name.

## What you need to do

1. **Apple Developer Program** membership (paid) for the account that will own
   the app.
2. **Signing:** in Xcode → App target → Signing & Capabilities, choose your Team.
   Keep "Automatically manage signing" on.
3. **App Store Connect:** create the app with bundle id `com.luddohouse.app`,
   primary category **Games → Board**, secondary e.g. Family.
4. **Supabase auth redirects:** make sure `https://luddohouse.com` is in
   Authentication → URL Configuration → Redirect URLs (email links from the app
   come back to the website).
5. **Archive and upload:** one command builds, signs, and uploads to App Store
   Connect (build number is a timestamp, so every upload is newer):
   ```bash
   APPLE_TEAM_ID=JAK975JG8T npm run ios:archive -- --upload
   ```
   Without `--upload` it just writes `build/ios/export/App.ipa` (drag it into
   Transporter to upload). For a new App Store version (e.g. 1.1), first run
   `agvtool new-marketing-version 1.1` in `ios/App`.
6. **App Store listing:**
   - Screenshots: 6.9" iPhone (1320 × 2868) and 13" iPad (2064 × 2752) at minimum.
     The simulator's File → Save Screen does it; practice games make good shots.
   - Age rating: answer the questionnaire honestly — the game itself has no
     objectionable content, but the voice and text chat between players is
     user-generated content, which raises the rating and needs moderation
     tools (see "Before review" below).
   - Privacy Policy URL: `https://luddohouse.com/privacy` (on the App Privacy page).
   - Support URL: `https://luddohouse.com/support` (support@luddohouse.com).
7. **Privacy label, age rating and review notes:** see
   [`STORE_DISCLOSURES.md`](STORE_DISCLOSURES.md). It matches the manifest and
   covers voice, video, the age check, push and the demo accounts reviewers
   need for video.

## Game Center

The app signs players in to Game Center at launch (Apple's "Welcome back"
banner; players who aren't signed in on the device are never blocked), posts a
running **Wins** total when they finish a game first, and reports achievements.
The leaderboard page has Game Center / Achievements buttons in the iOS app.
Code: `ios/App/App/GameCenterPlugin.swift` (native) and `lib/gameCenter.ts`
(the IDs below live in `GAME_CENTER` there). Table Together (one shared device)
doesn't report wins.

Create these in App Store Connect → Luddo House → **Features → Game Center**
(IDs must match exactly), then on the version page turn on **Game Center** and
add them to the version:

| Type | Reference name | ID | Notes |
|---|---|---|---|
| Leaderboard (Classic, **High score**, Integer, sort **High to Low**) | Total Wins | `com.luddohouse.wins` | Score is the player's running win total; format e.g. "Wins" |
| Achievement | First Win | `com.luddohouse.first_win` | Win any game |
| Achievement | Ludo Champion | `com.luddohouse.ludo_win` | Win a game of Ludo |
| Achievement | Top of the Ladder | `com.luddohouse.snakes_win` | Win a game of Snakes & Ladders |
| Achievement | Online Victory | `com.luddohouse.online_win` | Win an online game (friends or quick match) |
| Achievement | Ten Wins | `com.luddohouse.ten_wins` | Win 10 games (reports progress along the way) |

Each achievement needs a point value (total ≤ 1000), a title/description and a
512×512 or 1024×1024 image — ready-made ones are in `designs/game-center/`
(`python3 designs/game-center/render.py` regenerates them). Anything not
created yet just fails silently in the app — it's safe to ship before they
exist, but players won't see them.

### Game Center sign-in

In the iOS app the profile panel offers **Continue with Game Center**, which
signs in to (or, the first time, creates) a Luddo House account for that Game
Center player. The app sends GameKit's Apple-signed identity proof to the
`game-center-sign-in` Supabase Edge Function
(`supabase/functions/game-center-sign-in/`), which verifies it against
Apple's key and returns a one-time magic-link token the app redeems for a
normal session. Accounts carry `app_metadata.game_center = true` and a private
placeholder email (`gamecenter+<hash>@luddohouse.com`) that never receives
mail.

The function must be deployed before a build that uses it ships:

```sh
supabase functions deploy game-center-sign-in   # verify_jwt=false comes from supabase/config.toml
cd supabase/functions/game-center-sign-in && deno test --allow-net   # proof verification tests
```

Sign-in only works in a signed build on a real device signed in to Game
Center; the bundle ID it accepts is `com.luddohouse.app`.

## Sign in with Apple

- **iOS app:** Apple's native sheet via `@capgo/capacitor-social-login`
  (`lib/nativeAuth.ts`), token verified by Supabase with
  `signInWithIdToken`. Needs the Sign In with Apple capability on the
  `com.luddohouse.app` App ID and the `com.apple.developer.applesignin`
  entitlement (in `App.entitlements`).
- **Website:** Supabase's Apple OAuth redirect using the Services ID
  `com.luddohouse.web` (return URL
  `https://mnhxjuivtegezhzhiswp.supabase.co/auth/v1/callback`).
- **Supabase → Auth → Providers → Apple:** Client IDs
  `com.luddohouse.web,com.luddohouse.app`; the secret key is a JWT that
  **expires every 6 months** (current one: 2027-03-27). Regenerate it with
  `node scripts/apple-client-secret.mjs path/to/AuthKey_UQC983N63K.p8` (copies
  it to the clipboard) and paste it in. Only the website's flow uses it.
- The social-login plugin is configured in `capacitor.config.ts` to bundle
  only Apple and Google — `facebook: false` keeps the Facebook SDK out of the
  app (applied on `npx cap sync`, which `ios:archive` runs).

## Google sign-in in the iOS app

Google blocks its web sign-in inside the app's web view, so the app uses
Google's native sheet (same plugin as Apple) and `signInWithIdToken`.
- Google Cloud Console: iOS OAuth client
  `1026111066835-o0o0docc4rthuaefvijv1nv0eik4aohk.apps.googleusercontent.com`
  (bundle ID `com.luddohouse.app`), set as `GOOGLE_IOS_CLIENT_ID` in
  `lib/nativeAuth.ts`.
- Its reversed ID is a URL scheme in `ios/App/App/Info.plist`
  (`com.googleusercontent.apps.1026111066835-…`).
- Supabase → Auth → Providers → Google → **Client IDs**: the web client ID
  first, then the iOS one, comma-separated. Keep "Skip nonce checks" off.

## Account deletion

Profile panel → **Delete account** (with a confirmation) calls the
`delete-account` Edge Function (`supabase/functions/delete-account/`), which
removes the player's profile photos and deletes the auth user; foreign keys
delete their teams, memberships, wins and matchmaking rows and detach their
game seats. For Sign in with Apple accounts in the iOS app, the player
confirms with Apple once more and the function revokes the Apple token, as
Apple requires. Setup (once):

```sh
supabase functions deploy delete-account
supabase secrets set APPLE_PRIVATE_KEY="$(cat path/to/AuthKey_UQC983N63K.p8)"
cd supabase/functions/delete-account && deno test   # Apple revocation tests
```

Without the secret, accounts are still deleted but Apple revocation is
skipped (logged in the function's logs).

## Player safety (guideline 1.2)

Online tables have chat and voice with people who may be strangers (Quick
match), so the app has:
- **Filter:** `private.clean_text` masks profanity and slurs in chat, seat
  names and leaderboard names (migration `20260928010000_moderation.sql`).
- **Block / Report:** at the table, **Chat → At this table** lists the other
  people with **Block** (hides their chat and reactions, mutes their voice;
  by account, so it lasts) and **Report** (reason, optional details, optional
  block). Reports land in `public.player_reports` with the player's recent
  messages as evidence.
- **Terms:** `/terms` (zero tolerance), agreed to once before a player's first
  online table (`components/lobby/TableRules.tsx`).
- **Acting on reports within 24 hours** (Apple requires it): review open
  reports in Supabase → Table Editor → `player_reports` (or
  `select * from player_reports where status = 'open'`). To remove a player,
  ban them in Authentication → Users (⋯ → Ban user), then set the report's
  status to `actioned`. A Database Webhook on `player_reports` inserts can
  email or post you each new report.

## Before review — worth deciding

- **Universal links (optional):** to have luddohouse.com room links open the app
  instead of Safari, add the Associated Domains capability
  (`applinks:luddohouse.com`) and serve
  `https://luddohouse.com/.well-known/apple-app-site-association` with your Team
  ID. The app already routes links it's opened with (`components/NativeShell.tsx`).
