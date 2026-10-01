"use client";

import { PartySafety } from "@/components/party/PartySafety";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { GameRoomState, Pawn } from "@/lib/board/types";
import { COLORS } from "@/lib/presentation/board";
import {
  controllerPhase,
  describeMove,
  forcedMovePawnId,
  partyWaitEndsAt,
  clock,
  pieceSteps,
  pieceWhere,
  placementOf,
  routeLength,
  type MovePreview,
} from "@/lib/presentation/controller";
import { REACTION_EMOJI_ROWS, REACTION_PHRASES, REVENGE } from "@/lib/realtime/reactions";
import { hapticTap } from "@/lib/hooks/useCoarsePointer";
import { useCountdown } from "@/lib/hooks/useCountdown";
import { useWakeLock } from "@/lib/hooks/useWakeLock";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { Icon } from "@/components/simulator/Icon";
import { CastButton } from "@/components/cast/CastButton";
import type { Cast } from "@/lib/hooks/useCast";
import { useI18n, type Translator } from "@/lib/i18n";
import { useShakeToRoll } from "./useShakeToRoll";
import { PartyRound } from "@/components/party/PartyRound";
import type { PartyRound as PartyRoundData } from "@/lib/supabase/rpc";

/**
 * A Party Mode phone (docs/COMPETITIVE_ROADMAP.md Section 6, P3): the table
 * is on the shared screen, so the phone shows only what its player needs.
 * On your turn the whole phone is the Roll button; then your pieces, with
 * where each legal move lands; otherwise whose turn it is and reactions.
 */
export function PartyController({
  state,
  myPlayerId,
  pending,
  error,
  connection,
  sessionReplaced,
  onRoll,
  onMove,
  onReact,
  onReclaim,
  onRematch,
  onAutoRoll,
  onPause,
  onPreview,
  round,
  onGuess,
  cast,
}: {
  state: GameRoomState;
  myPlayerId: string | null;
  pending: boolean;
  error: string | null;
  connection: "connected" | "connecting" | "reconnecting";
  sessionReplaced: boolean;
  onRoll: () => void;
  onMove: (pawnId: string) => void;
  onReact: (text: string) => Promise<unknown>;
  onReclaim: () => void;
  onRematch: () => void;
  onAutoRoll: (enabled: boolean) => void;
  onPause: (paused: boolean) => void;
  /** Shows the picked piece on the shared screen before it's confirmed. */
  onPreview?: (pawnId: string) => void;
  /** The between-game round, once the screen has opened it (P8). */
  round?: PartyRoundData | null;
  onGuess?: (guess: number) => Promise<unknown>;
  /** Put the table on a TV from this phone, when there's one to cast to. */
  cast?: Cast;
}) {
  const { t } = useI18n();
  useWakeLock();
  const me = state.players.find((p) => p.id === myPlayerId);
  const phase = me ? controllerPhase(state, me) : "ended";
  const offline = connection !== "connected" || sessionReplaced;
  const canAct = !pending && !offline;

  // A buzz and a flash of your colour when your turn starts.
  const [flash, setFlash] = useState(0);
  const yourTurn = phase === "roll" || phase === "move";
  const wasYourTurn = useRef(yourTurn);
  useEffect(() => {
    if (yourTurn && !wasYourTurn.current) {
      hapticTap([40, 60, 40]);
      setFlash((n) => n + 1);
    }
    wasYourTurn.current = yourTurn;
  }, [yourTurn]);

  // The same beat as the full table before playing a move that's no choice.
  const forced = phase === "move" ? forcedMovePawnId(state.legalMoves) : null;
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  });
  useEffect(() => {
    if (!forced || !canAct) return;
    const timer = setTimeout(() => onMoveRef.current(forced), 550);
    return () => clearTimeout(timer);
  }, [forced, canAct]);

  const shake = useShakeToRoll(phase === "roll" && canAct, onRoll);
  const secondsLeft = useCountdown(yourTurn ? state.turnDeadlineAt : null);
  const waitLeft = useCountdown(partyWaitEndsAt(state));

  // Back after a computer took the seat (P5): take it back without asking,
  // once per return. The phone is at the table, so its player is too.
  const reclaimed = useRef(false);
  const onReclaimRef = useRef(onReclaim);
  useEffect(() => {
    onReclaimRef.current = onReclaim;
  });
  useEffect(() => {
    if (phase !== "reclaim") {
      reclaimed.current = false;
      return;
    }
    if (reclaimed.current || !canAct) return;
    reclaimed.current = true;
    onReclaimRef.current();
  }, [phase, canAct]);

  if (!me)
    return (
      <main className="party-pad">
        <section className="party-pad-card">
          <h1>{t("party.notAtTable")}</h1>
          <p>{t("party.watchOnScreen")}</p>
        </section>
      </main>
    );

  const turnPlayer = state.players.find((p) => p.id === state.turnPlayerId);
  const mine = state.pawns.filter((p) => p.color === me.color).sort((a, b) => a.index - b.index);
  const previews = new Map(
    phase === "move" ? state.legalMoves.map((m) => [m.pawnId, describeMove(state, m)] as const) : [],
  );
  const style = { "--seat": COLORS[me.color] } as CSSProperties;

  return (
    <main className="party-pad" style={style} data-phase={phase}>
      {flash > 0 && <div key={flash} className="party-pad-flash" aria-hidden />}
      <header className="party-pad-header">
        <PlayerAvatar player={me} size={40} crowned={state.hostPlayerId === me.id} />
        <div>
          <strong>{me.displayName}</strong>
          <small>{t("party.colorPieces", { color: capitalize(t(`colors.${me.color}`)) })}</small>
        </div>
        {shake.available && phase !== "ended" && (
          <button
            type="button"
            className={`party-pad-toggle${shake.enabled ? " is-on" : ""}`}
            aria-pressed={shake.enabled}
            onClick={() => void shake.toggle()}
          >
            {t("party.shakeToRoll")}
          </button>
        )}
        <CastButton cast={cast} className="party-pad-toggle" />
      </header>

      {offline && (
        <p className="party-pad-banner" role="status">
          {sessionReplaced ? t("party.seatOpenElsewhere") : t("party.reconnecting")}
        </p>
      )}
      {error && (
        <p className="party-pad-banner is-error" role="alert">
          {error}
        </p>
      )}

      {phase === "roll" && (
        <button
          type="button"
          className="party-pad-roll"
          disabled={!canAct}
          onClick={() => {
            hapticTap(16);
            onRoll();
          }}
        >
          <Icon name="dice" size={64} />
          <span>{pending ? t("party.rolling") : t("party.roll")}</span>
          <small>
            {pending
              ? t("party.watchScreenShort")
              : `${secondsLeft !== null ? `${secondsLeft}s · ` : ""}${shake.enabled ? t("party.rollTapShake") : t("party.rollTap")}`}
          </small>
        </button>
      )}

      {phase !== "roll" && (
        <section className="party-pad-status" aria-live="polite">
          <Status
            phase={phase}
            state={state}
            meId={me.id}
            turnName={turnPlayer?.displayName}
            forced={!!forced}
            secondsLeft={secondsLeft}
            waitLeft={waitLeft}
          />
          {phase === "auto_roll" && (
            <button type="button" className="party-pad-secondary" disabled={!canAct} onClick={() => onAutoRoll(false)}>
              {t("party.turnOffAutoRoll")}
            </button>
          )}
          {phase === "reclaim" && (
            <button type="button" className="party-pad-primary" disabled={!canAct} onClick={onReclaim}>
              {t("party.takeSeatBack")}
            </button>
          )}
          {phase === "paused" && state.hostPlayerId === me.id && state.pausedForPlayerId !== me.id && (
            <button type="button" className="party-pad-primary" disabled={!canAct} onClick={() => onPause(false)}>
              {state.pausedForPlayerId ? t("party.carryOnWithout") : t("party.resumeGame")}
            </button>
          )}
          {phase === "ended" && state.status === "summary" && (
            <button
              type="button"
              className="party-pad-primary"
              disabled={!canAct || me.rematchReady}
              onClick={onRematch}
            >
              {me.rematchReady ? t("party.readyWaiting") : t("lobby.playAgainLabel")}
            </button>
          )}
        </section>
      )}

      {phase !== "ended" && (
        <Pieces
          state={state}
          pieces={mine}
          previews={previews}
          choosing={phase === "move" && !forced && canAct}
          onMove={onMove}
          onPreview={onPreview}
        />
      )}

      {phase === "ended" && round && onGuess && (
        <PartyRound round={round} onGuess={onGuess} disabled={offline} />
      )}

      {!yourTurn && <Reactions onReact={onReact} disabled={offline} />}
      <PartySafety state={state} myPlayerId={myPlayerId} />
    </main>
  );
}

function Status({
  phase,
  state,
  meId,
  turnName,
  forced,
  secondsLeft,
  waitLeft,
}: {
  phase: ReturnType<typeof controllerPhase>;
  state: GameRoomState;
  meId: string;
  turnName?: string;
  forced: boolean;
  secondsLeft: number | null;
  waitLeft: number | null;
}) {
  const { t } = useI18n();
  const die = state.activeDiceValue;
  switch (phase) {
    case "move":
      return (
        <>
          <p className="party-pad-die" aria-label={t("party.youRolledAria", { die: die ?? 0 })}>
            {die}
          </p>
          <h1>{forced ? t("party.movingPiece") : t("party.pickPiece")}</h1>
          {!forced && secondsLeft !== null && <p>{t("party.secondsLeftShort", { seconds: secondsLeft })}</p>}
        </>
      );
    case "resolving":
      return <h1>{t("party.watchScreenEllipsis")}</h1>;
    case "auto_roll":
      return <h1>{t("party.autoRollOn")}</h1>;
    case "waiting":
      return (
        <>
          <h1>{turnName ? t("party.turnOf", { name: turnName }) : t("party.waiting")}</h1>
          {die !== null && state.turnPhase !== "awaiting_roll" && <p>{t("party.theyRolled", { die })}</p>}
        </>
      );
    case "paused": {
      const waitingFor = state.players.find((p) => p.id === state.pausedForPlayerId);
      if (!waitingFor) return <h1>{t("party.gamePaused")}</h1>;
      if (waitingFor.id === meId)
        return (
          <>
            <h1>{t("account.welcomeBack")}</h1>
            <p>{t("party.pickingUp")}</p>
          </>
        );
      return (
        <>
          <h1>{t("party.waitingForPhone", { name: waitingFor.displayName })}</h1>
          {waitLeft !== null && <p>{t("party.computerTakesTurn", { time: clock(waitLeft) })}</p>}
        </>
      );
    }
    case "reclaim":
      return (
        <>
          <h1>{t("party.computerHoldingSeat")}</h1>
          <p>{t("party.takeBackToPlay")}</p>
        </>
      );
    case "ended": {
      if (state.status === "abandoned") return <h1>{t("party.gameEndedEarly")}</h1>;
      const place = placementOf(state, meId);
      const winner = state.players.find((p) => p.id === state.winnerIds[0]);
      return (
        <>
          <h1>{place === 1 ? t("party.youWon") : place ? t("party.youCame", { place: ordinal(t, place) }) : t("party.someoneWins", { name: winner?.displayName ?? t("common.player") })}</h1>
          <p>{t("party.fullResults")}</p>
        </>
      );
    }
    default:
      return null;
  }
}

function Pieces({
  state,
  pieces,
  previews,
  choosing,
  onMove,
  onPreview,
}: {
  state: GameRoomState;
  pieces: Pawn[];
  previews: Map<string, MovePreview>;
  choosing: boolean;
  onMove: (pawnId: string) => void;
  onPreview?: (pawnId: string) => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  // A new roll or turn clears the choice.
  const choiceKey = `${state.eventSequence}`;
  const [lastKey, setLastKey] = useState(choiceKey);
  if (lastKey !== choiceKey) {
    setLastKey(choiceKey);
    setSelected(null);
  }
  const total = routeLength(state);
  const chosen = selected ? previews.get(selected) : undefined;
  return (
    <section className="party-pad-pieces" aria-label={t("party.yourPiecesAria")}>
      <ul>
        {pieces.map((pawn) => {
          const preview = previews.get(pawn.id);
          const legal = choosing && !!preview;
          const at = pieceSteps(state, pawn);
          const body = (
            <>
              <span className="party-pad-piece-name">
                {state.gameType === "snakes_and_ladders" ? t("party.yourPiece") : t("party.pieceN", { n: pawn.index + 1 })}
              </span>
              <span className="party-pad-route" aria-hidden>
                <span className="party-pad-route-fill" style={{ width: `${(at / total) * 100}%` }} />
                {preview && (
                  <span
                    className="party-pad-route-to"
                    style={{ left: `${(Math.min(preview.toSteps, total) / total) * 100}%` }}
                  />
                )}
              </span>
              <small>{legal ? preview.text : pieceWhere(state, pawn)}</small>
            </>
          );
          return (
            <li key={pawn.id}>
              {legal ? (
                <button
                  type="button"
                  className={`party-pad-piece is-legal${selected === pawn.id ? " is-selected" : ""}`}
                  aria-pressed={selected === pawn.id}
                  onClick={() => {
                    hapticTap(10);
                    setSelected(pawn.id);
                    if (selected !== pawn.id) onPreview?.(pawn.id);
                  }}
                >
                  {body}
                </button>
              ) : (
                <div className={`party-pad-piece${pawn.state === "finished" ? " is-home" : ""}`}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {choosing && (
        <button
          type="button"
          className="party-pad-primary party-pad-confirm"
          disabled={!chosen}
          onClick={() => {
            if (!chosen) return;
            hapticTap(16);
            onMove(chosen.pawnId);
          }}
        >
          {chosen
            ? state.gameType === "snakes_and_ladders"
              ? t("party.moveGeneric")
              : t("party.movePiece", { n: (state.pawns.find((p) => p.id === chosen.pawnId)?.index ?? 0) + 1 })
            : t("party.tapGlowing")}
        </button>
      )}
    </section>
  );
}

export function Reactions({ onReact, disabled }: { onReact: (text: string) => Promise<unknown>; disabled: boolean }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"emoji" | "phrases">("emoji");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  async function send(text: string) {
    if (sending || disabled) return;
    setSending(true);
    hapticTap(8);
    try {
      await onReact(text);
      setSent(text);
    } catch {
      setSent(null);
    } finally {
      // The server takes one reaction a second.
      setTimeout(() => setSending(false), 1000);
    }
  }
  return (
    <section className="party-pad-reactions" aria-label={t("party.reactionsAria")}>
      <div className="reaction-tabs" role="tablist" aria-label={t("party.reactionsAria")}>
        {(["emoji", "phrases"] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            role="tab"
            aria-selected={tab === tabKey}
            className={tab === tabKey ? "is-selected" : ""}
            onClick={() => setTab(tabKey)}
          >
            {tabKey === "emoji" ? t("party.emoji") : t("party.phrases")}
          </button>
        ))}
      </div>
      {tab === "emoji" ? (
        <div className="party-pad-emoji" role="tabpanel" aria-label={t("party.emoji")}>
          {REACTION_EMOJI_ROWS.flat().map((emoji) => (
            <button key={emoji} type="button" disabled={sending || disabled} onClick={() => void send(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      ) : (
        <div className="party-pad-phrases" role="tabpanel" aria-label={t("party.phrases")}>
          {REACTION_PHRASES.filter((phrase) => phrase !== REVENGE).map((phrase) => (
            <button key={phrase} type="button" disabled={sending || disabled} onClick={() => void send(phrase)}>
              {phrase}
            </button>
          ))}
        </div>
      )}
      <p className="party-pad-sent" role="status">
        {sent ? t("party.sentToScreen", { emoji: sent }) : " "}
      </p>
    </section>
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ordinal(t: Translator, n: number) {
  return n === 2 ? t("tournaments.place2") : n === 3 ? t("tournaments.place3") : t("profile.ordinalNth", { n });
}
