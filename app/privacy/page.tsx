import { SUPPORT_EMAIL } from "@/lib/support";
import type { Metadata } from "next";
import { InfoPage } from "@/components/site/InfoPage";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Privacy Policy – ${BRAND.name}`,
  description: `How ${BRAND.name} collects, uses and protects your information.`,
  alternates: { canonical: "/privacy" },
};

// Keep in sync with what the app actually collects, the iOS privacy manifest
// (ios/App/App/PrivacyInfo.xcprivacy) and the App Store privacy label.
export default function PrivacyPage() {
  return (
    <InfoPage
      eyebrow="PRIVACY POLICY"
      title="Your seat,"
      accent="your data."
      intro={
        <>
          Effective October 1, 2026. This policy explains what {BRAND.name} (&ldquo;we&rdquo;) collects
          when you play on luddohouse.com or in the {BRAND.name} app, why, and the choices you have.
        </>
      }
    >
      <h2>The short version</h2>
      <ul>
        <li>You can play without an account. We create an anonymous player ID so games work.</li>
        <li>If you sign in, we keep your profile, wins and teams so they follow you across devices.</li>
        <li>We don&rsquo;t sell your data, show ads, or track you across other apps and websites.</li>
        <li>
          Before you play online we ask for your birth month and year, to keep online tables 13+ and video
          18+. Other players never see it.
        </li>
        <li>
          Voice and video chat go directly between players&rsquo; devices, or through an encrypted relay
          when they can&rsquo;t connect directly. We don&rsquo;t record or store either.
        </li>
      </ul>

      <h2>What we collect</h2>
      <h3>When you play (no account needed)</h3>
      <ul>
        <li>
          <strong>An anonymous player ID</strong>, created automatically so we can seat you at a table and
          keep your place if you reconnect.
        </li>
        <li>
          <strong>The name you enter</strong> for a game, which other players at your table can see.
        </li>
        <li>
          <strong>Your birth month and year</strong>, asked once before your first online table. We use it
          only to check that you&rsquo;re old enough for online play (13+) and video (18+). It&rsquo;s never
          shown to other players or sent to our analytics. If you&rsquo;re under 13, we don&rsquo;t keep
          your birth month or year, only the month you&rsquo;ll become old enough.
        </li>
        <li>
          <strong>Game activity</strong>: the tables you create or join, your rolls and moves, and results.
        </li>
        <li>
          <strong>Table chat</strong> messages and reactions you send, which the other players at that table
          can see. Chat is automatically filtered for offensive language.
        </li>
        <li>
          <strong>Reports and blocks</strong>: if you report a player, we keep your report together with that
          player&rsquo;s recent messages at the table so we can review it. If you block someone, we keep that
          choice so it applies at future tables too.
        </li>
        <li>
          <strong>Notification settings and a device token</strong>, if you turn on notifications: the
          token lets us reach your device, and we keep your time zone so quiet hours work.
        </li>
      </ul>
      <h3>If you sign in</h3>
      <ul>
        <li>
          <strong>Your email address or phone number</strong>, used only to send you a sign-in code and to
          recognize your account.
        </li>
        <li>
          If you <strong>continue with Apple or Google</strong>: the email address (with Apple, this can be a
          private relay address that hides your real one) and, the first time, the name they share with us,
          plus an ID that recognizes your account. We never see your Apple or Google password.
        </li>
        <li>
          <strong>Your profile</strong>: display name, chosen avatar, country (optional), and a profile photo
          if you upload one. Uploaded photos are stored at a public web address so other players can see
          your avatar.
        </li>
        <li>
          <strong>Your wins</strong>, shown on the leaderboard, and <strong>teams</strong> you create or join.
        </li>
        <li>
          If you sign in with <strong>Game Center</strong> in the iPhone or iPad app: an ID Apple gives us for
          your Game Center account, used only to recognize your account, and your Game Center nickname as
          your starting display name. We don&rsquo;t receive your Apple ID, email or contacts.
        </li>
      </ul>
      <h3>Game Center</h3>
      <p>
        In the iPhone and iPad app, if you&rsquo;re signed in to Game Center, your win total and achievements
        are sent to Apple&rsquo;s Game Center, where Game Center players can see them. Apple handles that
        information under its own privacy policy. You can turn Game Center off in your device&rsquo;s
        Settings.
      </p>
      <h3>Usage analytics</h3>
      <p>
        We use PostHog to understand how the game is used — for example which screens are visited, which
        buttons are tapped and how games go — so we can improve it. PostHog also makes session recordings: replays of how a
        visit moved through the screens, with taps and scrolls. Every word on screen and everything typed is
        hidden in them, so they never show names, chat or codes, and the 3D table and video aren&rsquo;t
        recorded. PostHog uses your IP address to estimate your approximate location (country and city). These
        analytics aren&rsquo;t linked to your name, email or phone number. Recordings and analytics are deleted
        automatically after PostHog&rsquo;s retention period. On a device where someone has told us
        they&rsquo;re under 13, we turn analytics off. On our website (not the app) we also use Google
        Analytics, through Google Tag Manager, to measure visits and how games go: for example which way of
        playing you chose, when a game starts and ends, your place, simple counts such as captures and sixes,
        and whether you used chat or a call. Games are identified by a random match number, not by your name
        or account. We never send Google your name, contact details, chat, your age or birth date, or the
        links and codes that let someone join your table, team or TV screen. In the European Economic Area,
        the UK and Switzerland, Google Analytics is off. Google Analytics keeps this event data for 14
        months. Both PostHog and Google Analytics use cookies or similar browser storage.
      </p>

      <h2>How we use it</h2>
      <ul>
        <li>To run games: seating players, syncing moves, timing turns, and letting computer players fill in.</li>
        <li>To keep your profile, wins, teams and leaderboard place when you sign in.</li>
        <li>To send the sign-in codes you ask for.</li>
        <li>To keep the game working, secure and fair, and to improve it.</li>
        <li>To review reports and remove content or players that break our <a href="/terms">Terms of Use</a>.</li>
      </ul>
      <p>We don&rsquo;t use your information for advertising, and we don&rsquo;t sell or rent it.</p>

      <h2>Who we share it with</h2>
      <p>Only the services that run the game on our behalf:</p>
      <ul>
        <li>
          <strong>Supabase</strong> — accounts, the game database, real-time play and photo storage.
        </li>
        <li>
          <strong>Twilio</strong> — sends sign-in codes by text message, if you sign in with a phone number,
          and relays voice and video calls when players&rsquo; devices can&rsquo;t connect directly. Calls
          stay encrypted through the relay, so Twilio can&rsquo;t see or hear them, and nothing is stored.
        </li>
        <li>
          <strong>Apple</strong> — only if you choose &ldquo;Continue with Apple&rdquo;, and for Game Center
          sign-in, leaderboard and achievements in the iPhone and iPad app.
        </li>
        <li>
          <strong>Vercel</strong> — hosts the website.
        </li>
        <li>
          <strong>PostHog</strong> (usage analytics and session recordings) and, on the website only,{" "}
          <strong>Google Analytics</strong> through Google Tag Manager (usage and game analytics), both with
          approximate location from your IP address.
        </li>
        <li>
          <strong>Google</strong> — only if you choose &ldquo;Continue with Google&rdquo;.
        </li>
        <li>
          <strong>Apple, Google and your browser&rsquo;s push service</strong> — deliver the notifications
          you turn on. They receive the notification text and your device token.
        </li>
      </ul>
      <p>
        We may also disclose information if required by law, or to protect players and the service from
        abuse.
      </p>

      <h2>Voice and video chat, your microphone and camera</h2>
      <p>
        Voice chat is optional and only starts when you join the table&rsquo;s audio. Video is optional too,
        your camera is off until you turn it on, and it&rsquo;s only offered at private tables where every
        player is signed in and 18 or older. It&rsquo;s never offered in Quick match.
      </p>
      <p>
        Calls connect you directly with the other players at your table. When a direct connection
        isn&rsquo;t possible, the call passes through an encrypted relay run by Twilio, which can&rsquo;t
        see or hear it. We only pass along the connection details needed to set the call up. We never record
        or store what&rsquo;s said or shown, so a report about a call relies on your description of what
        happened. You can leave audio or turn your camera off at any time, and turn off microphone and camera
        access in your device settings.
      </p>
      <p>
        These protections cover the official {BRAND.name} website and apps. We can&rsquo;t control a
        modified app, or someone recording their own screen, so only share video with people you trust.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Your account, profile, wins and teams are kept until you delete your account.</li>
        <li>Game records and table chat are kept to run the service and may be removed over time.</li>
        <li>Anonymous player IDs that are no longer used may be removed.</li>
        <li>
          Your birth month and year are kept until you delete your account. For an under-13 answer, the
          account or player ID and everything tied to it, including any profile photo, are deleted after
          30 days without play.
        </li>
        <li>
          Device tokens are kept until you turn notifications off on that device, the device stops accepting
          them, or you delete your account.
        </li>
      </ul>

      <h2>Your choices and rights</h2>
      <ul>
        <li>Play without an account, or sign out at any time.</li>
        <li>Edit your name, avatar, photo and country from your profile.</li>
        <li>Leave or delete teams from your profile.</li>
        <li>
          <strong>Delete your account and data</strong> at any time: open your profile and tap{" "}
          <strong>Delete account</strong>. This immediately deletes your account, profile, photo, wins and the
          teams you own, and, if you used Sign in with Apple in the app, revokes our access to your Apple ID.
          Games you played stay in the other players&rsquo; history without your account attached. You can
          also email <a href={`mailto:${SUPPORT_EMAIL}?subject=Delete%20my%20account`}>{SUPPORT_EMAIL}</a> and
          we&rsquo;ll do it for you.
        </li>
        <li>
          Ask for a copy of your data, or to correct it, by emailing us. Depending on where you live, you may
          have further rights under local law, and we&rsquo;ll honor them.
        </li>
      </ul>

      <h2>Children</h2>
      <p>
        {BRAND.name}&rsquo;s online tables are for players 13 and older, and video is for players 18 and
        older. Younger players can still play against computers, or pass-and-play on one device, without an
        online account. We don&rsquo;t knowingly collect personal information from children under 13; when
        someone tells us they&rsquo;re under 13, we keep only the month they&rsquo;ll become old enough. If
        you believe a child has given us personal information, contact us and we&rsquo;ll delete it.
      </p>

      <h2>Security</h2>
      <p>
        Information is sent over encrypted connections, and game actions are checked on our servers so
        players can only act for their own seat. No system is perfectly secure, but we work to protect your
        information.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If we change this policy, we&rsquo;ll update the date at the top, and for significant changes
        we&rsquo;ll let you know in the app or on the website.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
    </InfoPage>
  );
}
