import type { Metadata } from "next";
import { InfoPage, SUPPORT_EMAIL } from "@/components/site/InfoPage";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Terms of Use – ${BRAND.name}`,
  description: `The rules for playing ${BRAND.name}, including how players treat each other.`,
  alternates: { canonical: "/terms" },
};

// Players agree to these before their first online table
// (components/lobby/TableRules.tsx). App Store guideline 1.2 requires terms
// with zero tolerance for objectionable content and abusive users.
export default function TermsPage() {
  return (
    <InfoPage
      eyebrow="TERMS OF USE"
      title="House"
      accent="rules."
      intro={
        <>
          Effective September 28, 2026. These terms apply when you play {BRAND.name} on luddohouse.com or in
          the {BRAND.name} app. By playing, you agree to them.
        </>
      }
    >
      <h2>Playing together</h2>
      <p>
        {BRAND.name} lets you play, chat and talk with other people, including people you don&rsquo;t know
        when you use Quick match. We have <strong>zero tolerance</strong> for objectionable content or abusive
        behavior. You agree not to:
      </p>
      <ul>
        <li>harass, bully, threaten or intimidate anyone;</li>
        <li>post or say anything hateful, discriminatory, sexual, violent or otherwise objectionable;</li>
        <li>use a name or photo that does any of the above, or impersonates someone else;</li>
        <li>share anyone&rsquo;s personal information, including your own, or send spam or scams;</li>
        <li>cheat, exploit bugs, or disrupt other players&rsquo; games.</li>
      </ul>
      <p>
        Chat is filtered for offensive language, but no filter is perfect. At any table you can open{" "}
        <strong>Chat</strong> to <strong>block</strong> a player (you won&rsquo;t see their messages or hear
        their voice again) or <strong>report</strong> them to us.
      </p>

      <h2>How we moderate</h2>
      <p>
        We review reports within 24 hours. When content or behavior breaks these terms, we remove it and may
        suspend or permanently remove the player responsible, without notice. You can also report something by
        emailing <a href={`mailto:${SUPPORT_EMAIL}?subject=Report%20a%20player`}>{SUPPORT_EMAIL}</a>.
      </p>

      <h2>Your account</h2>
      <p>
        You can play without an account. If you create one, keep your sign-in secure; you&rsquo;re responsible
        for what happens under it. You can delete your account at any time from your profile. {BRAND.name}{" "}
        isn&rsquo;t intended for children under 13.
      </p>

      <h2>What you share</h2>
      <p>
        You keep ownership of what you post, such as your name, photo and messages. You give us permission to
        store and show it to other players as needed to run the game. How we handle your information is
        described in the <a href="/privacy">privacy policy</a>.
      </p>

      <h2>The service</h2>
      <p>
        {BRAND.name} is provided as is. We work to keep it running smoothly, but we can&rsquo;t promise it will
        always be available or free of errors, and we may change or discontinue features. To the extent the
        law allows, we aren&rsquo;t liable for indirect or incidental losses from using it. Nothing here limits
        rights you have under the law where you live.
      </p>

      <h2>The App Store</h2>
      <p>
        If you downloaded the app from Apple&rsquo;s App Store, these terms are between you and us, not Apple,
        and Apple&rsquo;s{" "}
        <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/">
          Licensed Application End User License Agreement
        </a>{" "}
        also applies. Apple has no obligation to provide support for the app.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. We&rsquo;ll change the date at the top, and for significant changes
        we&rsquo;ll let you know in the app or on the website. Continuing to play means you accept them.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
    </InfoPage>
  );
}
