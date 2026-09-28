import type { Metadata } from "next";
import { InfoPage, SUPPORT_EMAIL } from "@/components/site/InfoPage";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Support – ${BRAND.name}`,
  description: `Help with ${BRAND.name}: joining friends, quick match, voice chat, accounts and contacting us.`,
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  return (
    <InfoPage
      eyebrow="SUPPORT"
      title="How can we"
      accent="help?"
      intro={
        <>
          Questions, a bug, or feedback? Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> — we usually reply within two business
          days. It helps to mention your device and, for a game problem, the room code.
        </>
      }
    >
      <a className="sim-primary info-cta" href={`mailto:${SUPPORT_EMAIL}`}>
        <span>Email support</span>
      </a>

      <h2>Playing with friends</h2>
      <h3>How do I invite friends?</h3>
      <p>
        Choose <strong>Play with friends</strong>, create a private table, then share the link or the
        six-character room code. Friends who open the link just enter their name to take a seat — no account
        or download needed. The host starts the game once everyone&rsquo;s seated; empty seats can be filled
        with computer players.
      </p>
      <h3>A friend&rsquo;s link says the table is full or already started</h3>
      <p>
        Tables only take new players before the game begins, and only up to the number of seats the host
        chose. Ask the host to start a new table or change the table size.
      </p>

      <h2>Quick match</h2>
      <h3>How does quick match work?</h3>
      <p>
        Quick match looks for other people starting the same game with the same table size. The game starts
        as soon as the table fills. If it hasn&rsquo;t filled after 45 seconds, it starts with whoever has
        joined, and computer players take the empty seats.
      </p>

      <h2>During a game</h2>
      <h3>What happens if I don&rsquo;t take my turn?</h3>
      <p>
        Each turn has a short timer. If it runs out, the game plays that turn for you. After three missed
        turns — or if you&rsquo;ve been away for a while — a computer player takes over your seat so the game
        can continue. Come back to the table to take your seat back.
      </p>
      <h3>How do I play?</h3>
      <p>
        <strong>Ludo:</strong> roll a six to bring a piece out, race all four pieces around the board and
        into the center, and land on opponents to send them home. <strong>Snakes &amp; Ladders:</strong>{" "}
        climb ladders, slide down snakes, and land exactly on 100. Tap <strong>?</strong> at the top of the
        table for the full rules and controls.
      </p>
      <h3>Voice chat isn&rsquo;t working</h3>
      <p>
        Tap <strong>Join audio</strong> at the table and allow microphone access when asked. If you declined
        earlier, turn it back on in your device&rsquo;s settings (on iPhone: Settings → {BRAND.name} →
        Microphone), then rejoin the audio.
      </p>

      <h2>Your account</h2>
      <h3>Do I need an account?</h3>
      <p>
        No. You can play every mode without one. Signing in (with Apple, Google, an email or phone code, or
        Game Center in the iPhone and iPad app) keeps your name, avatar, wins and teams across devices and puts
        you on the leaderboard.
      </p>
      <h3>Can I sign in with Game Center?</h3>
      <p>
        Yes, in the iPhone and iPad app: open your profile and tap <strong>Continue with Game Center</strong>.
        Your first time creates an account; after that you&rsquo;re signed back in to the same account on any
        device using the same Game Center account. Game Center isn&rsquo;t available on the website, so to
        play there with the same profile, use the app.
      </p>
      <h3>How do I delete my account?</h3>
      <p>
        Email <a href={`mailto:${SUPPORT_EMAIL}?subject=Delete%20my%20account`}>{SUPPORT_EMAIL}</a> from
        the email address, or with the phone number, you signed in with, and we&rsquo;ll delete your
        account, profile, photo, wins and teams. See the <a href="/privacy">privacy policy</a> for details.
      </p>

      <h2>Safety</h2>
      <h3>How do I report a player?</h3>
      <p>
        Email <a href={`mailto:${SUPPORT_EMAIL}?subject=Report%20a%20player`}>{SUPPORT_EMAIL}</a> with the
        room code, the player&rsquo;s name and what happened. We review every report and may remove content
        or block players who break the rules.
      </p>
    </InfoPage>
  );
}
