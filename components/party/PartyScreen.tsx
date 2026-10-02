"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useProgressRouter } from "@/lib/navigation/progress";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import {
  claimCast,
  createPartyRoom,
  setPartyLocked,
  getPartyExtras,
  getPartyScreen,
  openPartyRound,
  RpcError,
  type PartyExtras,
} from "@/lib/supabase/rpc";
import {
  fetchRecentEvents,
  subscribeToRoom,
  type AudienceReaction,
  type MatchEventRow,
  type MovePreviewSignal,
} from "@/lib/realtime/room-channel";
import { describeMoment, picksFor, topMoment } from "@/lib/presentation/party";
import { isPhrase } from "@/lib/realtime/reactions";
import { useWakeLock } from "@/lib/hooks/useWakeLock";
import { webUrl } from "@/lib/native";
import { BRAND } from "@/lib/brand";
import type { GameRoomState, GameType } from "@/lib/board/types";
import type { TableMessage } from "@/lib/realtime/table-messages";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { TableLoading } from "@/components/simulator/TableLoading";
import { Icon } from "@/components/simulator/Icon";
import { useI18n } from "@/lib/i18n";
import { QrCode } from "./QrCode";
import { CastScreen } from "@/components/cast/CastScreen";
import "@/components/simulator/simulator.css";

import { track } from "@/lib/analytics";
import { analyticsGameType } from "@/lib/analytics/gameParams";
import { usePartyScreenAnalytics } from "@/lib/analytics/usePartyScreenAnalytics";

const Simulator = dynamic(() => import("@/components/simulator/Simulator"), {
  ssr: false,
  loading: () => <TableLoading label="Setting the table…" />,
});

/**
 * Party Mode's shared screen (docs/COMPETITIVE_ROADMAP.md Section 6, P1).
 * Opens a party room, shows its code and a QR code for phones to join, and
 * follows the room live. It never takes a seat: phones do the playing.
 */
let screenOpenedSent = false;

export function PartyScreen() {
  const params = useSearchParams();
  const roomId = params.get("id");
  // Cast to TV: a phone at the table sent this TV here with a cast token.
  const castToken = params.get("cast");
  useWakeLock();
  // Once per page load on this screen (the TV is its own analytics user).
  // A TV showing a cast table is not a Party Mode screen.
  useEffect(() => {
    if (screenOpenedSent || castToken) return;
    screenOpenedSent = true;
    track("party_screen_opened", { has_room: !!roomId });
  }, [roomId, castToken]);
  if (roomId && castToken) return <CastReceiver key={roomId} roomId={roomId} token={castToken} />;
  return roomId ? <ConnectedScreen key={roomId} roomId={roomId} /> : <StartScreen />;
}

/**
 * The TV end of Cast to TV (supabase/migrations/20260930150000_cast_to_tv.sql).
 * It arrives in a browser of its own, as a stranger to the room, and trades
 * the token for read-only access: a party room makes it one more Party screen;
 * an ordinary room gets the cast view on its own private topic.
 */
function CastReceiver({ roomId, token }: { roomId: string; token: string }) {
  const { t } = useI18n();
  const [claim, setClaim] = useState<{ isParty: boolean; castTopic?: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const client = createClient();
    let cancelled = false;
    void ensureSession(client)
      .then(() => claimCast(client, roomId, token))
      .then((result) => {
        if (!cancelled) setClaim(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, token]);
  if (failed || (claim && !claim.isParty && !claim.castTopic))
    return (
      <main className="sim-entrance party-screen">
        {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
        <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
        <div className="entrance-shade" />
        <section className="entrance-content party-start" role="alert">
          <span className="eyebrow">{t("cast.tvEyebrow")}</span>
          <h1>
            {t("cast.tvError1")}
            <br />
            <em>{t("cast.tvErrorEm")}</em>
          </h1>
          <p className="party-hint">{t("cast.tvErrorBody")}</p>
        </section>
      </main>
    );
  if (!claim) return <TableLoading label={t("party.findingTable")} />;
  if (claim.isParty) return <ConnectedScreen roomId={roomId} />;
  return <CastScreen roomId={roomId} topic={claim.castTopic!} />;
}

function StartScreen() {
  const { t } = useI18n();
  const router = useProgressRouter();
  const [gameType, setGameType] = useState<GameType>("ludo");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setPending(true);
    setError(null);
    try {
      const client = createClient();
      await ensureSession(client);
      const room = await createPartyRoom(client, gameType);
      track("party_room_created", { game_type: analyticsGameType(gameType) });
      router.replace(`/screen?id=${room.roomId}`);
    } catch {
      setError(t("party.openError"));
      setPending(false);
    }
  }

  return (
    <main className="sim-entrance party-screen">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <section className="entrance-content party-start" aria-labelledby="party-start-heading">
        <span className="eyebrow">{t("party.partyMode").toUpperCase()}</span>
        <h1 id="party-start-heading">
          {t("party.startTitle1")}
          <br />
          <em>{t("party.startTitleEm")}</em>
        </h1>
        <fieldset className="entrance-player-count">
          <legend>{t("party.whatPlaying")}</legend>
          <div>
            {(["ludo", "snakes_and_ladders"] as const).map((game) => (
              <button
                key={game}
                type="button"
                className={gameType === game ? "is-selected" : ""}
                aria-pressed={gameType === game}
                onClick={() => setGameType(game)}
              >
                <strong>{game === "ludo" ? t("entrance.ludo") : t("entrance.snakes")}</strong>
              </button>
            ))}
          </div>
        </fieldset>
        <button type="button" className="sim-primary" disabled={pending} onClick={() => void open()}>
          <span>{pending ? t("party.openingTable") : t("party.openPartyTable")}</span>
          <Icon name="arrow" />
        </button>
        {error && (
          <p className="party-error" role="alert">
            {error}
          </p>
        )}
        <p className="party-hint">{t("party.hintDefaults")}</p>
        <p className="party-hint">{t("party.hintTv")}</p>
      </section>
    </main>
  );
}

function ConnectedScreen({ roomId }: { roomId: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<GameRoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reactions from the phones (party rooms carry no chat), shown over their seats.
  const [reactions, setReactions] = useState<TableMessage[]>([]);
  // The event log animates each roll and move, as on the phones.
  const [events, setEvents] = useState<MatchEventRow[]>([]);
  const [preview, setPreview] = useState<MovePreviewSignal | null>(null);
  // The audience (P6): who's watching, their picks and votes, and reactions.
  const [extras, setExtras] = useState<PartyExtras | null>(null);
  const [cheers, setCheers] = useState<AudienceReaction[]>([]);
  const loadExtras = useCallback(() => {
    void getPartyExtras(createClient(), roomId)
      .then(setExtras)
      .catch(() => {});
  }, [roomId]);
  const cheer = useCallback((reaction: AudienceReaction) => {
    setCheers((all) => [...all.slice(-5), reaction]);
    setTimeout(() => setCheers((all) => all.filter((r) => r.id !== reaction.id)), 5000);
  }, []);
  const status = state?.status;
  useEffect(() => {
    if (status) loadExtras();
  }, [status, loadExtras]);
  // Games, pauses and how they ended, from the one device that sees them all.
  usePartyScreenAnalytics(state, events, extras?.audience.length);
  // While the podium is up, everyone's phone gets one question (P8).
  const hasRound = !!extras?.round;
  useEffect(() => {
    if (status !== "summary" || hasRound) return;
    void openPartyRound(createClient(), roomId)
      .then(loadExtras)
      .catch(() => {});
  }, [status, hasRound, roomId, loadExtras]);

  useEffect(() => {
    const client = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof subscribeToRoom> | null = null;
    let loadingEvents = false;
    let loadAgain = false;
    // One read at a time; a state that arrives meanwhile reads once more after.
    async function loadEvents() {
      if (loadingEvents) {
        loadAgain = true;
        return;
      }
      loadingEvents = true;
      try {
        do {
          loadAgain = false;
          const next = await fetchRecentEvents(client, roomId);
          if (!cancelled)
            setEvents((current) =>
              (current.at(-1)?.sequence ?? -1) > (next.at(-1)?.sequence ?? -1) ? current : next,
            );
        } while (loadAgain && !cancelled);
      } catch {
        // The table catches up from the next snapshot.
      } finally {
        loadingEvents = false;
      }
    }
    const receive = (next: GameRoomState) => {
      setState((current) =>
        current && current.eventSequence > next.eventSequence ? current : next,
      );
      if (next.status !== "lobby") void loadEvents();
    };
    // Snapshots are authoritative; broadcasts keep them live in between.
    const refresh = () =>
      getPartyScreen(client, roomId)
        .then((next) => {
          if (!cancelled) receive(next);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof RpcError ? e.code : "UNKNOWN");
        });
    ensureSession(client)
      .then(() => {
        if (cancelled) return;
        channel = subscribeToRoom(client, roomId, receive, {
          onStatus: (status) => {
            if (status === "SUBSCRIBED") void refresh();
          },
          onMovePreview: setPreview,
          onPartyExtras: loadExtras,
          onAudienceReaction: cheer,
          onMessage: (message) => {
            if (message.kind === "reaction") setReactions((all) => [...all.slice(-19), message]);
          },
        });
        void refresh();
      })
      .catch(() => {
        if (!cancelled) setError("UNKNOWN");
      });
    return () => {
      cancelled = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [roomId, loadExtras, cheer]);

  if (error)
    return (
      <main className="sim-entrance party-screen">
        {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
        <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
        <div className="entrance-shade" />
        <section className="entrance-content party-start" role="alert">
          <span className="eyebrow">{t("party.partyMode").toUpperCase()}</span>
          <h1>
            {t("party.notShowing1")}
            <br />
            <em>{t("party.notShowingEm")}</em>
          </h1>
          <p className="party-hint">{t("party.onlyOpener")}</p>
          <Link className="sim-primary" href="/screen">
            <span>{t("party.openNewTable")}</span>
            <Icon name="arrow" />
          </Link>
        </section>
      </main>
    );
  if (!state) return <TableLoading label={t("party.findingTable")} />;
  if (state.status === "lobby")
    return (
      <>
        <PartyLobby state={state} roomId={roomId} extras={extras} />
        <AudienceCheers cheers={cheers} />
      </>
    );
  // P7: the screen may lock seats; phones still do all the playing.
  return (
    <>
      <Simulator
        state={state}
        events={events}
        myPlayerId={null}
        messages={reactions}
        paused={state.paused}
        screen
        previewPawnId={
          preview && preview.eventSequence === state.eventSequence && preview.playerId === state.turnPlayerId
            ? preview.pawnId
            : null
        }
        readOnly
        onRoll={() => {}}
        onMove={() => {}}
      />
      <PartyLock roomId={roomId} locked={!!state.partyLocked} />
      <AudienceOverlay state={state} extras={extras} roomId={roomId} />
      <AudienceCheers cheers={cheers} />
    </>
  );
}

/** Audience reactions (P6) rise up the side of the screen with the sender's name. */
function AudienceCheers({ cheers }: { cheers: AudienceReaction[] }) {
  const { t } = useI18n();
  if (cheers.length === 0) return null;
  return (
    <ul className="party-cheers" aria-label={t("party.audienceReactionsAria")}>
      {cheers.map((c) => (
        <li key={c.id} className={isPhrase(c.text) ? "is-phrase" : ""}>
          <span>{c.text}</span>
          <small>{c.name}</small>
        </li>
      ))}
    </ul>
  );
}

/**
 * The audience on the TV (P6): during the game, a QR code in the corner
 * for late arrivals and how many are watching; at the end, the leading
 * moment of the match and who called the winner.
 */
function AudienceOverlay({
  state,
  extras,
  roomId,
}: {
  state: GameRoomState;
  extras: PartyExtras | null;
  roomId: string;
}) {
  const { t } = useI18n();
  if (state.status === "in_game")
    return (
      <aside className="party-audience-join" aria-label={t("party.joinAudienceAria")}>
        <QrCode value={webUrl(`/room?id=${roomId}`)} label={t("party.qrJoinAudience")} />
        <p>
          <strong>{t("party.joinAudience")}</strong>
          <small>
            {extras?.audience.length ? t("party.watchingPrefix", { count: extras.audience.length }) : ""}
            {t("party.codeLabel", { code: state.code })}
          </small>
        </p>
      </aside>
    );
  if (state.status !== "summary" || !extras || extras.audience.length === 0) return null;
  const top = topMoment(extras);
  const round = extras.round;
  return (
    <aside className="party-audience-card" aria-label={t("party.theAudienceAria")}>
      {round && (
        <div className="party-screen-round">
          <span className="eyebrow">{round.closed ? t("party.theAnswer").toUpperCase() : t("party.everyoneAnswer").toUpperCase()}</span>
          <strong>{round.question}</strong>
          {round.closed ? (
            <p>
              {round.answer}
              {round.closest?.length
                ? t("party.screenClosest", { names: round.closest.map((c) => c.name).join(", ") })
                : t("party.screenNobody")}
            </p>
          ) : (
            <p>
              {round.guessCount === 1
                ? t("party.answersSoFarOne")
                : t("party.answersSoFarOther", { count: round.guessCount })}
            </p>
          )}
        </div>
      )}
      <span className="eyebrow">{t("party.momentOfMatch").toUpperCase()}</span>
      <strong>
        {top ? describeMoment(top.moment, state.players) : extras.moments.length ? t("party.audienceVoting") : t("party.noBigMoments")}
      </strong>
      {top && <small>{top.votes === 1 ? t("party.votesSoFarOne") : t("party.votesSoFarOther", { count: top.votes })}</small>}
      {extras.calledIt && extras.predictionCount > 0 && (
        <p>
          {extras.calledIt.length
            ? t("party.calledIt", { names: extras.calledIt.join(", ") })
            : t("party.nobodyCalledIt")}
        </p>
      )}
    </aside>
  );
}

export function PartyLobby({
  state,
  roomId,
  extras = null,
}: {
  state: GameRoomState;
  roomId: string;
  extras?: PartyExtras | null;
}) {
  const { t } = useI18n();
  const joinUrl = webUrl(`/room?id=${roomId}`);
  const domain = new URL(BRAND.url).host;
  const maxPlayers = state.maxPlayers ?? 4;
  const vip = state.players.find((p) => p.id === state.hostPlayerId);
  return (
    <main className="sim-entrance party-screen">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <section className="party-lobby" aria-labelledby="party-lobby-heading">
        <div className="party-join">
          <span className="eyebrow">
            {t("lobby.partyEyebrow").toUpperCase()} · {state.gameType === "ludo" ? t("entrance.ludo").toUpperCase() : t("entrance.snakes").toUpperCase()}
          </span>
          <h1 id="party-lobby-heading">
            {t("party.grabPhone1")}
            <br />
            <em>{t("party.grabPhoneEm")}</em>
          </h1>
          <ol className="party-steps">
            <li>{t("party.step1")}</li>
            <li>
              {t("party.step2Pre")}<strong>{domain}</strong>{t("party.step2Post")}
            </li>
            <li>{t("party.step3")}</li>
          </ol>
          <p className="party-code" aria-label={t("party.roomCodeAria", { code: state.code.split("").join(" ") })}>
            {state.code}
          </p>
        </div>
        <div className="party-qr">
          <QrCode value={joinUrl} label={t("party.joinTableQr")} />
        </div>
        <ul className="party-seats" aria-label={t("party.playersAtTableAria")}>
          {Array.from({ length: maxPlayers }, (_, seat) => {
            const player = state.players.find((p) => p.seatIndex === seat);
            return (
              <li key={seat} className={player ? "is-taken" : ""}>
                {player ? (
                  <>
                    <PlayerAvatar player={player} size={88} crowned={player.id === vip?.id} />
                    <strong>{player.displayName}</strong>
                    <small>
                      {player.id === vip?.id
                        ? t("party.picksGameStarts")
                        : player.isBot
                          ? t("party.computer")
                          : player.partyRemote
                            ? t("party.joiningElsewhere")
                            : t("party.ready")}
                    </small>
                    {extras && picksFor(extras, player.id) > 0 && (
                      <small className="party-seat-picks">
                        {picksFor(extras, player.id) === 1
                          ? t("party.picksToWinOne")
                          : t("party.picksToWinOther", { count: picksFor(extras, player.id) })}
                      </small>
                    )}
                  </>
                ) : (
                  <>
                    <span className="party-seat-empty" aria-hidden>
                      +
                    </span>
                    <small>{t("party.openSeat")}</small>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <p className="party-status" role="status" aria-live="polite">
          {vip
            ? t("party.waitingForVip", { name: vip.displayName })
            : t("party.waitingForFirst")}
          {extras && extras.audience.length > 0 &&
            t("party.audienceInfo", { count: extras.audience.length })}
        </p>
      </section>
    </main>
  );
}

export function PartyLock({ roomId, locked }: { roomId: string; locked: boolean }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  return <aside className="party-lock">
    <button type="button" disabled={pending} aria-pressed={locked} onClick={async () => {
      setPending(true); setError(false);
      try { await setPartyLocked(createClient(), roomId, !locked); }
      catch { setError(true); }
      finally { setPending(false); }
    }}>{pending ? t("actions.wait") : locked ? t("party.unlockSeats") : t("party.lockSeats")}</button>
    <small>{locked ? t("party.audienceCanJoin") : t("party.lockStaysOn")}</small>
    {error && <small role="alert">{t("party.lockError")}</small>}
  </aside>;
}
