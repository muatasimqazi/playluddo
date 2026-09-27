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
- **Microphone:** usage text is set for voice chat.
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
5. **Archive and upload:** Xcode → Product → Archive → Distribute App → App Store
   Connect. Bump the build number (target → General → Build) for every upload.
6. **App Store listing:**
   - Screenshots: 6.9" iPhone (1320 × 2868) and 13" iPad (2064 × 2752) at minimum.
     The simulator's File → Save Screen does it; practice games make good shots.
   - Age rating: answer the questionnaire honestly — the game itself has no
     objectionable content, but the voice and text chat between players is
     user-generated content, which raises the rating and needs moderation
     tools (see "Before review" below).
   - Privacy Policy URL: `https://luddohouse.com/privacy` (on the App Privacy page).
   - Support URL: `https://luddohouse.com/support` (support@luddohouse.com).
7. **Privacy label** (App Store Connect → App Privacy) — match the manifest:
   - *Linked to the user, used for App Functionality:* Name, Email Address,
     Phone Number, User ID, Photos (optional avatar photo), Other User Content
     (table chat), Gameplay Content (results for the leaderboard).
   - *Not linked, used for Analytics:* Product Interaction (anonymous page views).
   - *Not used for tracking.*
8. **Review notes:** tell reviewers no account is needed — "Settle in with an
   offline practice game" plays immediately against computers, and Quick match
   finds an opponent or seats computers after 45 seconds.

## Before review — worth deciding

- **Chat moderation (guideline 1.2):** apps with user-to-user chat need a way to
  report or block people. Table chat and voice are limited to people you invited,
  which helps, but a "report" option in the table menu is the safe route.
- **Account deletion (guideline 5.1.1(v)):** apps that let people create an
  account must let them delete it in-app. Sign-in creates an account, so add a
  "Delete account" action to the profile panel before submitting.
- **Universal links (optional):** to have luddohouse.com room links open the app
  instead of Safari, add the Associated Domains capability
  (`applinks:luddohouse.com`) and serve
  `https://luddohouse.com/.well-known/apple-app-site-association` with your Team
  ID. The app already routes links it's opened with (`components/NativeShell.tsx`).
