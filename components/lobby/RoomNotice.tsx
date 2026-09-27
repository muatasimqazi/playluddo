import Link from "next/link";
import { Icon } from "@/components/simulator/Icon";
import "@/components/simulator/simulator.css";

// Room errors arrive as the server's RPC error codes; say what happened in
// the app's own voice instead of showing "ROOM_NOT_FOUND" on a blank page.
const NOTICES: Record<string, { title: [string, string]; body: string }> = {
  ROOM_NOT_FOUND: {
    title: ["This table has", "cleared."],
    body: "The link may be old or mistyped, or the game has already finished.",
  },
  ROOM_FULL: {
    title: ["Every seat is", "taken."],
    body: "This table is already full. Start a new one, or try a quick match.",
  },
  ALREADY_STARTED: {
    title: ["The game has", "started."],
    body: "This table is mid-game and isn't taking new players.",
  },
  UNAUTHENTICATED: {
    title: ["Let's get you", "seated."],
    body: "We couldn't sign you in to this table. Head back and try the link again.",
  },
};

export function RoomNotice({ code }: { code: string }) {
  const notice = NOTICES[code] ?? {
    title: ["Couldn't reach", "the table."] as [string, string],
    body: "Check your connection and try the link again.",
  };
  return (
    <main className="sim-entrance">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <section className="entrance-content room-notice" role="alert">
        <span className="eyebrow">LUDDO HOUSE</span>
        <h1>
          {notice.title[0]}
          <br />
          <em>{notice.title[1]}</em>
        </h1>
        <p>{notice.body}</p>
        <Link className="sim-primary" href="/">
          <span>Back to the apartment</span>
          <Icon name="arrow" />
        </Link>
      </section>
    </main>
  );
}
