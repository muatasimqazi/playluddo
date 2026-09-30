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
          Effective September 27, 2026. This policy explains what {BRAND.name} (&ldquo;we&rdquo;) collects
          when you play on luddohouse.com or in the {BRAND.name} app, why, and the choices you have.
        </>
      }
    >
      <h2>The short version</h2>
      <ul>
        <li>You can play without an account. We create an anonymous player ID so games work.</li>
        <li>If you sign in, we keep your profile, wins and teams so they follow you across devices.</li>
        <li>We don&rsquo;t sell your data, show ads, or track you across other apps and websites.</li>
        <li>Voice chat goes directly between players&rsquo; devices. We don&rsquo;t record or store it.</li>
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
        We use PostHog to understand how the game is used — for example which screens are visited and which
        buttons are tapped — so we can improve it. These analytics aren&rsquo;t linked to your name, email
        or phone number. On our website (not the app) we also use Google Analytics to measure visits. Both
        use cookies or similar browser storage.
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
          <strong>Twilio</strong> — sends sign-in codes by text message, if you sign in with a phone number.
        </li>
        <li>
          <strong>Apple</strong> — only if you choose &ldquo;Continue with Apple&rdquo;, and for Game Center
          sign-in, leaderboard and achievements in the iPhone and iPad app.
        </li>
        <li>
          <strong>Vercel</strong> — hosts the website.
        </li>
        <li>
          <strong>PostHog</strong> and, on the website only, <strong>Google Analytics</strong> — usage
          analytics.
        </li>
        <li>
          <strong>Google</strong> — only if you choose &ldquo;Continue with Google&rdquo;.
        </li>
      </ul>
      <p>
        We may also disclose information if required by law, or to protect players and the service from
        abuse.
      </p>

      <h2>Voice chat and your microphone</h2>
      <p>
        Voice chat is optional and only starts when you join the table&rsquo;s audio. It connects you
        directly with the other players at your table; we only relay the connection details needed to set
        that up. We never record or store what&rsquo;s said. You can leave audio at any time, and turn off
        microphone access in your device settings.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Your account, profile, wins and teams are kept until you delete your account.</li>
        <li>Game records and table chat are kept to run the service and may be removed over time.</li>
        <li>Anonymous player IDs that are no longer used may be removed.</li>
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
        {BRAND.name} isn&rsquo;t directed at children under 13, and we don&rsquo;t knowingly collect
        personal information from them. If you believe a child has given us personal information, contact us
        and we&rsquo;ll delete it.
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
