import Link from "next/link";
import type { Metadata } from "next";
import { InfoPage } from "@/components/site/InfoPage";
import { BRAND } from "@/lib/brand";
import { SUPPORT_EMAIL } from "@/lib/support";

export const metadata: Metadata = {
  title: `About – ${BRAND.name}`,
  // "Ludo" appears here on purpose: it's the spelling most people search for,
  // and this page is where we explain why we write it "Luddo".
  description: `${BRAND.name} is Luddo — the game many know as Ludo — played at a real-looking table with friends and family, with no ads and no betting.`,
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <InfoPage
      eyebrow="ABOUT"
      title="Let's play"
      accent="Luddo."
      intro={
        <>
          {BRAND.name} is a place to play Luddo with the people you&rsquo;d most like to sit across from,
          whether they&rsquo;re on the sofa next to you or in another country.
        </>
      }
    >
      <Link className="sim-primary info-cta" href="/">
        <span>Pull up a chair</span>
      </Link>

      <h2 id="spelling">Why &ldquo;Luddo&rdquo;?</h2>
      <p>
        You may know the game as Ludo. Here it&rsquo;s Luddo, with two d&rsquo;s. That&rsquo;s how
        it&rsquo;s spelled.
      </p>
      <p>
        It&rsquo;s the same game many of us grew up with: roll a six to bring a piece out, race all four
        pieces around the board and home, and send anyone you land on back to the start. If you came looking
        for Ludo, you&rsquo;re in the right place. See <Link href="/how-to-play">how to play</Link> for the
        full rules.
      </p>

      <h2>A real table</h2>
      <p>
        Every game is played at a 3D table in a furnished room. Share a link and friends join from any
        browser with just a name, with no account or download needed. Turn on video and their faces sit at
        the table with you. Or open Party Mode, put the table on a TV, and use your phones as controllers.
      </p>

      <h2>No ads. No betting.</h2>
      <p>
        There are no ads, coins, entry fees, prize pots or loot boxes, and nothing is for sale. Every dice
        style and piece you unlock, you earn by playing.
      </p>

      <h2>Your table, your rules</h2>
      <p>
        The host of a private table picks the mode and the house rules, and everyone at the table can see
        them before the first roll. Play a quick game, a long one, in teams of two, or with up to six
        players.
      </p>

      <h2>Dice you can check</h2>
      <p>
        In online games, the dice are rolled on our server, not on anyone&rsquo;s device. Before the first
        roll, the server publishes a commitment to that game&rsquo;s dice. When the game ends, you can check
        every recorded roll against it.
      </p>

      <h2>Everyone at the table</h2>
      <p>
        {BRAND.name} speaks eight languages, including Arabic and Urdu written right to left. It has a
        color-blind mode, symbols on every seat, screen-reader announcements, full keyboard control and a
        reduced-motion setting.
      </p>

      <h2>Say hello</h2>
      <p>
        Ideas, bugs or a good story from game night? Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </InfoPage>
  );
}
