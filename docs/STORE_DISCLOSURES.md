# Store disclosures and review notes

Covers V4's last open items from [`COMPETITIVE_ROADMAP.md`](COMPETITIVE_ROADMAP.md): the App Store privacy label, Google Play Data Safety and target audience, the age-rating answers that change with chat, voice and video, and the notes reviewers need. It also covers V1's two manual checks. The answers below match the code as of 2026-09-30, `ios/App/App/PrivacyInfo.xcprivacy` and [`/privacy`](../app/privacy/page.tsx). Change all four together.

**Video is already switched on in production** (`private.feature_flags.video_chat`). Submit these disclosures with the next build, or switch the flag off until they're live:

```sql
update private.feature_flags set enabled = false where name = 'video_chat';
```

## What the app collects

| Data | Where it's stored | Linked to the player | Purpose | Notes |
|---|---|---|---|---|
| Display name | Supabase | Yes | App functionality | Shown at tables and on leaderboards |
| Email address | Supabase Auth | Yes | App functionality | Only when signing in with email or Google |
| Phone number | Supabase Auth, Twilio (sends the code) | Yes | App functionality | Only when signing in with a phone number |
| User ID | Supabase; Game Center player ID on iOS | Yes | App functionality | Guests get an anonymous ID |
| Avatar photo | Supabase Storage | Yes | App functionality | Optional upload |
| Birth month and year | Supabase | Yes | App functionality | Age check before online play; kept until the account is deleted |
| Country | Supabase | Yes | App functionality | Optional, typed into the profile |
| Table chat, reactions, reports | Supabase | Yes | App functionality | Reports keep recent messages as evidence |
| Game results, XP, achievements | Supabase | Yes | App functionality | Leaderboards, profile, replays |
| Push token | Supabase | Yes | App functionality | Turn, rematch, friend and team alerts |
| Page views and interactions | PostHog | No | Analytics | Anonymous ID, no `identify` call, no person profiles |
| Call connection outcome | PostHog | No | Analytics | `call_ice_outcome`: transport facts only, never IPs, SDP or player IDs |
| Voice and video | Not stored | n/a | n/a | Direct between devices, or through Twilio's TURN relay in real time; never recorded |

Not collected: precise or coarse location, contacts, browsing history, advertising ID, health, financial or payment data, crash logs. No tracking, so no App Tracking Transparency prompt.

**Two questions to settle before submitting:**
- **PostHog session replay:** if it's enabled in the PostHog project settings, the analytics row also covers screen content. Keep it off for the app, or add it to both labels.
- **PostHog IP capture:** PostHog stores the request IP for coarse geolocation unless "Discard client IP data" is on in project settings. Turn that on; otherwise both stores expect "Coarse location: Analytics, not linked".

## App Store Connect → App Privacy

Answer **Yes, we collect data**. Then, for each type:

| Category → type | Linked to you | Tracking | Purpose |
|---|---|---|---|
| Contact Info → Name | Yes | No | App Functionality |
| Contact Info → Email Address | Yes | No | App Functionality |
| Contact Info → Phone Number | Yes | No | App Functionality |
| Identifiers → User ID | Yes | No | App Functionality |
| Identifiers → Device ID | Yes | No | App Functionality (push token) |
| User Content → Photos or Videos | Yes | No | App Functionality (avatar photo only) |
| User Content → Gameplay Content | Yes | No | App Functionality |
| User Content → Other User Content | Yes | No | App Functionality (chat, reports) |
| Usage Data → Product Interaction | No | No | Analytics |
| Other Data → Other Data Types | Yes | No | App Functionality (birth month and year, country) |

Audio Data stays **unchecked**. Apple counts data as collected only when it's kept longer than needed to serve the request in real time, and voice and video only pass through (directly, or via the relay) without being stored.

## Google Play → App content

### Data safety

- Does the app collect or share user data? **Yes.**
- Is all data encrypted in transit? **Yes.**
- Can users request deletion? **Yes**: in the app (profile → Delete account), and at `https://luddohouse.com/support`.

| Data type | Collected | Shared | Optional | Purpose |
|---|---|---|---|---|
| Personal info → Name | Yes | No | No (a display name is needed to sit at a table) | App functionality |
| Personal info → Email address | Yes | No | Yes | App functionality, Account management |
| Personal info → Phone number | Yes | No | Yes | App functionality, Account management |
| Personal info → User IDs | Yes | No | No | App functionality, Account management |
| Personal info → Other info | Yes | No | No (birth month and year before online play; country is optional) | App functionality |
| Photos and videos → Photos | Yes | No | Yes | App functionality (avatar) |
| Messages → Other in-app messages | Yes | No | Yes | App functionality (table chat) |
| App activity → App interactions | Yes | No | No | Analytics |
| App activity → Other user-generated content | Yes | No | Yes | App functionality (reports) |
| App activity → Other actions | Yes | No | No | App functionality (game results) |
| Device or other IDs | Yes | No | Yes | App functionality (push token) |

Audio and video aren't listed. Calls are passed on in real time and never stored, and Play doesn't count a user-initiated transfer to the people they're talking to as sharing. Twilio and Supabase are service providers acting for us, which Play doesn't count as sharing either.

### Target audience and content

- **Target age groups:** 13–15, 16–17, 18 and over. Leave the under-13 groups unticked: online play is 13+ (F0.4).
- **Appeals to children?** Answer honestly; a board game often does. If Play decides it does, the app falls under the Families policy, which bans the analytics SDK in children's sessions. Either keep PostHog out of under-13 sessions, which the age answer already identifies, or don't target or appeal to under-13s. Decide before submitting.
- **Ads:** none. **In-app purchases:** none.

## Age ratings

Both questionnaires now ask about user-to-user communication. Answer:
- **Unrestricted web access:** No.
- **User-generated content / users can interact:** Yes. Text chat, voice, and video in private rooms.
- **Messaging and chat:** Yes, with filtering, blocking and reporting.
- **Gambling or simulated gambling:** No. There are no coins, wagers or random rewards.
- **Age assurance:** online play asks for birth month and year (13+); video needs a signed-in account that is 18+, and so does every other human at the table.

Expect 12+ on the App Store and Teen on Google Play (IARC). If the result comes out lower, check the chat and video answers.

## Review notes

Paste into App Store Connect (App Review Information → Notes) and Play Console (App access):

> No account is needed to play. "Settle in with an offline practice game" starts a game against computer players immediately. Quick match finds an opponent online, or seats computer players after 45 seconds.
>
> Online play asks for your birth month and year once. Answer 18 or older to reach every feature. Under-13s keep offline play only.
>
> Voice chat is available at online tables. Video chat is only offered at private tables, and only when every person seated is signed in and 18 or older. To see it, sign in with the two demo accounts below on two devices, open a private table from one and join it from the other with the room code, then tap the camera button.
>
> Safety: chat is filtered for profanity and slurs. Every player's chat entry, and every video tile, has Report and Block. Blocking stops your audio and video reaching that person at the source, not just on your screen. Reports are reviewed within 24 hours. Voice and video go directly between devices, or through an encrypted relay when a direct connection isn't possible. They're never recorded or stored. These protections apply to our apps; we don't claim they stop someone using a modified app or recording their own screen, and the privacy policy says so.
>
> Demo accounts (signed in, 18+): `<reviewer-1 email>` / `<code delivery: see below>`, `<reviewer-2 email>`.

Sign-in uses one-time codes, so a reviewer can't type a password. Before submitting, either add the two demo addresses to an inbox the reviewer can't see and give App Review a phone number or email whose codes you forward, or add Supabase test OTPs (Auth → Providers → Phone → "Test phone numbers and OTPs"). Test OTPs are the usual approach.

## V1: the two manual checks

**First, give the relay its Twilio credentials.** The `ice-servers` function needs `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` (Twilio Console → Account → API keys & tokens). As of 2026-09-30 only the SID is set in production, so every call falls back to STUN only, and calls between cellular networks will fail. Set the token, which takes effect without a redeploy:

```bash
supabase secrets set TWILIO_AUTH_TOKEN=<auth token>
```

**Voice between two phones on separate cellular networks.** Use two phones on different carriers with Wi-Fi off on both. Sign in on each, open a private table on one and join it from the other, and both tap the microphone. Pass: both hear each other within a few seconds. In PostHog, the two `call_ice_outcome` events for that call should show `outcome = connected`. Expect `candidate_type = relay` on at least one side, since carrier NAT usually defeats direct connections.

**The PostHog insight for the <2% target.** Run:

```bash
POSTHOG_PERSONAL_API_KEY=phx_... POSTHOG_PROJECT_ID=<id> node scripts/posthog-ice-insights.mjs
```

The key needs `insight:write` and `query:read`; for an EU project add `POSTHOG_HOST=https://eu.posthog.com`. The script creates "Call connection failure rate", which is failed ÷ (connected + failed) per day by `video_table`. It also creates a second insight broken down by `turn_offered`: a rate that's high only where `turn_offered = false` means the TURN credentials failed and calls fell back to STUN only. Rerunning updates both in place. To add the alert, open the first insight and choose Alerts → New alert → "has value", more than 2.

After the two-phone test, `node scripts/posthog-ice-insights.mjs --check` (same environment variables) prints the last 7 days: connected, failed, the failure rate, how many connected through the relay, how many were offered no TURN, and the median time to connect.
