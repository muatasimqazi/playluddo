"use client";

import { PartySafety } from "@/components/party/PartySafety";

import { useState } from "react";
import Link from "next/link";
import { usePartyHeartbeat } from "@/lib/hooks/usePartyHeartbeat";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fillBot,
  setPlayerColor,
  setRoomGame,
  setRoomMaxPlayers,
  setRoomRules,
  setTeamUp,
  startMatch,
} from "@/lib/supabase/rpc";
import { resolveRoomRules } from "@/lib/board/rules";
import {
  describeRules,
  PRESET_LABELS,
  presetOf,
  RULE_PRESETS,
  rulesAllowed,
  teamUpCompatible,
  type PresetName,
} from "@/lib/board/presets";
import { useRoomStore } from "@/lib/store/room-store";
import { COLORS } from "@/lib/presentation/board";
import { Icon } from "@/components/simulator/Icon";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { TurnReminderPrompt } from "@/components/lobby/TurnReminderPrompt";
import type { Cast } from "@/lib/hooks/useCast";
import { CastButton, canCast } from "@/components/cast/CastButton";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { PlayerProfileButton } from "@/components/profile/PlayerProfileButton";
import type { PlayerColor } from "@/lib/board/types";
import type { VoiceChat } from "@/lib/hooks/useVoiceChat";
import { BRAND } from "@/lib/brand";
import { webUrl } from "@/lib/native";
import { errorCode, track, trackError } from "@/lib/analytics";
import type { ErrorArea } from "@/lib/analytics/events";
import "@/components/simulator/simulator.css";

const SEAT_COLORS: PlayerColor[] = ["red", "green", "yellow", "blue", "orange", "black"];

export function RoomLobby({
  client,
  roomId,
  voice,
  cast,
}: {
  client: SupabaseClient;
  roomId: string;
  voice?: VoiceChat;
  /** Cast to TV, owned by the room page so it outlives lobby -> game. */
  cast?: Cast;
}) {
  const state = useRoomStore((s) => s.roomState);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteFeedback, setInviteFeedback] = useState<
    "code" | "link" | "shared" | null
  >(null);
  const occupiedCount = state?.players.length ?? 1;
  const isParty = state?.isParty ?? false;
  const meRemote = !!state?.players.find((p) => p.id === myPlayerId)?.partyRemote;
  // Mirrors MatchArena: a party seat in the room with the TV is a controller.
  const livingRoom = isParty && !meRemote;
  usePartyHeartbeat(client, roomId, isParty);
  if (!state) return null;
  const maxPlayers = state.maxPlayers ?? 4;
  const rules = resolveRoomRules(state.rules);
  const preset = presetOf(rules);
  const teamUp = rules.teamUp === true;
  // Team Up needs a full four-player Luddo table, and it can only run on the
  // one ruleset its engine covers. Both are enforced by the server; the panel
  // mirrors them so a host isn't offered a choice that would be refused.
  const teamUpEligible = state.gameType === "ludo" && maxPlayers === 4;
  // For 2 players, the seats aren't a fixed {0,1} range — the second seat
  // is whichever base sits diagonally across the board from the first
  // (mirrors the SQL engine's (seat + 2) % 4 pairing). The host is always
  // seated immediately on creation, so their current seat + its diagonal
  // is always exactly the pair that matters for the seats grid/bot-fill.
  const hostSeatIndex =
    state.players.find((p) => p.id === state.hostPlayerId)?.seatIndex ?? 0;
  const relevantSeats: number[] =
    maxPlayers !== 2
      ? Array.from({ length: maxPlayers }, (_, i) => i)
      : hostSeatIndex % 2 === 0
        ? [0, 2]
        : [1, 3];
  // What *I* can pick for my own base: any of the 4 for a 2-player room
  // until someone other than me has actually taken the other seat, then
  // it's locked to that seat's diagonal, same as the server enforces.
  const myChoiceSeats: number[] =
    maxPlayers === 2 && !state.players.some((p) => p.id !== myPlayerId)
      ? [0, 1, 2, 3]
      : relevantSeats;
  const me = state.players.find((player) => player.id === myPlayerId);
  const host = state.hostPlayerId
    ? state.hostPlayerId === myPlayerId
    : state.players.find((p) => p.seatIndex === 0)?.id === myPlayerId;
  async function run(fn: () => Promise<unknown>, area?: ErrorArea) {
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (area) trackError(area, errorCode(e));
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }
  function showInviteFeedback(value: "code" | "link" | "shared") {
    setInviteFeedback(value);
    setTimeout(() => setInviteFeedback(null), 2000);
  }
  async function copyInvite(value: string, kind: "code" | "link") {
    try {
      await navigator.clipboard.writeText(value);
      track("share", { method: "copy", content_type: kind === "code" ? "room_code" : "room_invite" });
      showInviteFeedback(kind);
    } catch {
      setError("Could not copy the invite. Select the room code above instead.");
    }
  }
  async function shareInvite() {
    const url = webUrl(`/room?id=${roomId}`);
    if (!navigator.share) {
      await copyInvite(url, "link");
      return;
    }
    try {
      await navigator.share({
        title: `Join my ${BRAND.gameName} table on ${BRAND.name}`,
        text: `Join my ${BRAND.gameName} game on ${BRAND.name} — room code ${state!.code}.`,
        url,
      });
      // Resolves only once something was shared; a cancel rejects with AbortError.
      track("share", { method: "share_sheet", content_type: "room_invite" });
      showInviteFeedback("shared");
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      setError("Could not open sharing. Copy the room link instead.");
    }
  }
  return (
    <main className="sim-entrance room-lobby-page">
      {/* The entrance's static photo, not the live 3D table: nothing here is
          interactive in 3D, so rendering WebGL behind a form only cost GPU
          and battery. The room page still warms the 3D assets in idle time
          (usePreloadBoardScene) so the game starts fast once it begins. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <header className="entrance-header">
        <Link href="/" className="sim-brand">
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            LUDDO<small>House</small>
          </span>
        </Link>
        <div className="entrance-header-actions">
          <span>THE EVENING IS JUST BEGINNING.</span>
          <LanguageSwitcher className="profile-trigger" />
        </div>
      </header>
      <section className="entrance-content room-lobby">
        {/* A living-room phone in Party Mode joined from the TV's QR code:
            the TV already shows the code and the table, so this phone is a
            controller waiting for the game, not a private table to invite to. */}
        {livingRoom ? (
          <>
            <span className="eyebrow">{host ? "PARTY TABLE · YOU’RE THE VIP" : "PARTY TABLE"}</span>
            <h1>
              You’re in.
              <br />
              <em>Look at the TV.</em>
            </h1>
            <p>
              {host
                ? "Pick the game and the rules, then start it when everyone’s at the table."
                : "Your phone is your controller. The game starts when the VIP is ready."}
            </p>
            {/* No TV showing the table yet? Put it on one from here. */}
            {canCast(cast) && (
              <div className="lobby-invite-actions">
                <CastButton cast={cast} />
              </div>
            )}
          </>
        ) : (
          <>
            <span className="eyebrow">YOUR PRIVATE TABLE</span>
            <h1>
              Good company.
              <br />
              <em>Great game.</em>
            </h1>
            <p>
              Share your room code and bring everyone together. There’s a seat
              waiting.
            </p>
          </>
        )}
        {!livingRoom && (
          <div className="lobby-code">
            <div>
              <span className="eyebrow">INVITE YOUR FRIENDS</span>
              <strong>{state.code}</strong>
            </div>
            <div className="lobby-invite-actions">
              <button onClick={() => void shareInvite()} title="Share room invite">
                <Icon name={inviteFeedback === "shared" ? "check" : "share"} />
                {inviteFeedback === "shared" ? "Shared" : "Share"}
              </button>
              <button
                onClick={() => void copyInvite(webUrl(`/room?id=${roomId}`), "link")}
                title="Copy room link"
              >
                <Icon name={inviteFeedback === "link" ? "check" : "link"} />
                {inviteFeedback === "link" ? "Copied" : "Link"}
              </button>
              <button onClick={() => void copyInvite(state.code, "code")} title="Copy room code">
                <Icon name={inviteFeedback === "code" ? "check" : "copy"} />
                {inviteFeedback === "code" ? "Copied" : "Code"}
              </button>
              <CastButton cast={cast} />
            </div>
          </div>
        )}
        <div className="lobby-game">
          <div>
            <span className="eyebrow">ON THE TABLE</span>
            <strong>
              {state.gameType === "ludo" ? "Luddo" : "Snakes & Ladders"}
            </strong>
          </div>
          {host ? (
            <button
              // Snakes & Ladders is 2-4 players; 5-6 is the Ludo hexagon (F5.2).
              disabled={pending || teamUp || (state.gameType === "ludo" && maxPlayers > 4)}
              title={
                teamUp
                  ? "Turn Team Up off to switch to Snakes & Ladders"
                  : state.gameType === "ludo" && maxPlayers > 4
                    ? "Snakes & Ladders is up to four players"
                    : undefined
              }
              onClick={() =>
                void run(async () => {
                  const next = await setRoomGame(
                    client,
                    roomId,
                    state.gameType === "ludo" ? "snakes_and_ladders" : "ludo",
                  );
                  useRoomStore.getState().setRoomState(next);
                })
              }
            >
              <Icon name="rotate" /> Flip board
            </button>
          ) : (
            <small>{isParty ? "The VIP chooses the board" : "The host chooses the board"}</small>
          )}
        </div>
        <p className="lobby-game-rules">
          {state.gameType === "ludo"
            ? describeRules(rules, "ludo")
            : "One piece each. Climb ladders, slide down snakes. Reach 100 with an exact roll."}{" "}
          {/* A new tab, so the table and your seat stay put. */}
          <Link
            className="lobby-how-to"
            href={`/how-to-play?homeRoll=${rules.bonusRollOnFinish ? "on" : "off"}#${
              state.gameType === "ludo" ? "ludo" : "snakes-and-ladders"
            }`}
            target="_blank"
            rel="noreferrer"
          >
            How to play
          </Link>
        </p>
        {host && state.gameType === "ludo" && (
          <div className="lobby-rules-panel">
            <div className="lobby-house-rule lobby-rules-head">
              <span>
                <span className="eyebrow">GAME RULES</span>
                <strong>{preset ? PRESET_LABELS[preset].name : "House rules"}</strong>
                <small>{describeRules(rules, "ludo")}</small>
              </span>
            </div>
            <div className="lobby-preset-choices">
              {(Object.keys(RULE_PRESETS) as PresetName[]).map((name) => {
                // While Team Up is on, a preset that isn't one it can run on
                // (Quick, Master) is greyed out — the server would refuse it.
                const presetBlocked = teamUp && !teamUpCompatible({ ...rules, ...RULE_PRESETS[name] });
                return (
                <button
                  key={name}
                  type="button"
                  className={`lobby-preset${preset === name ? " is-selected" : ""}`}
                  aria-pressed={preset === name}
                  disabled={pending || presetBlocked}
                  title={presetBlocked ? "Turn Team Up off to choose this" : undefined}
                  onClick={() =>
                    void run(async () => {
                      const next = await setRoomRules(client, roomId, { ...rules, ...RULE_PRESETS[name] });
                      useRoomStore.getState().setRoomState(next);
                    })
                  }
                >
                  <strong>{PRESET_LABELS[name].name}</strong>
                  <small>{PRESET_LABELS[name].note}</small>
                </button>
                );
              })}
            </div>
            {/* Team Up (F2.5): partners sit opposite (red+yellow, green+blue),
                a side wins when all eight of its pawns are home, and once your
                own four are home you roll for your partner. It needs a
                four-player table and its own fixed ruleset. */}
            <label
              className={`lobby-player-count lobby-house-rule${
                teamUpEligible && (teamUp || teamUpCompatible(rules)) ? "" : " is-disabled"
              }`}
              title={
                !teamUpEligible
                  ? "Team Up needs a four-player Luddo table"
                  : !teamUp && !teamUpCompatible(rules)
                    ? "Start from Classic or Family to turn Team Up on"
                    : undefined
              }
            >
              <span>
                <span className="eyebrow">TEAM UP · 2 v 2</span>
                <strong>Play as partners</strong>
                <small>
                  Red &amp; yellow against green &amp; blue. A side wins when all
                  eight of its pieces are home.
                </small>
              </span>
              <input
                type="checkbox"
                checked={teamUp}
                disabled={
                  pending || !teamUpEligible || (!teamUp && !teamUpCompatible(rules))
                }
                onChange={(event) =>
                  void run(async () => {
                    const next = await setTeamUp(client, roomId, event.target.checked);
                    useRoomStore.getState().setRoomState(next);
                  })
                }
              />
            </label>
            {/* Single changes to Classic (decision 14): each is offered only
                when the resulting combination is one the server allows, so a
                choice that isn't on the list is greyed out rather than
                refused after the fact. */}
            {([
              ["blockades", "Blockades", "Two of your pieces on a square stop everyone else"],
              ["bonusRollOnFinish", "Extra roll for getting a piece home", "A six or a capture always earns another roll"],
            ] as const).map(([key, title, note]) => {
              const candidate = { ...rules, [key]: !rules[key] };
              const canToggle = rulesAllowed(candidate) && (!teamUp || teamUpCompatible(candidate));
              return (
                <label
                  key={key}
                  className={`lobby-player-count lobby-house-rule${canToggle ? "" : " is-disabled"}`}
                  title={canToggle ? undefined : "Start from Classic to change this"}
                >
                  <span>
                    <strong>{title}</strong>
                    <small>{note}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={rules[key]}
                    disabled={pending || !canToggle}
                    onChange={() =>
                      void run(async () => {
                        const next = await setRoomRules(client, roomId, candidate);
                        useRoomStore.getState().setRoomState(next);
                      })
                    }
                  />
                </label>
              );
            })}
            <div className="lobby-player-count lobby-house-rule lobby-length">
              <span>
                <span className="eyebrow">TURN TIMER</span>
                <strong>{rules.turnSeconds} seconds a turn</strong>
                <small>How long each player has to roll and move</small>
              </span>
              <div className="lobby-length-choices">
                {[10, 15, 30].map((seconds) => {
                  const candidate = { ...rules, turnSeconds: seconds };
                  const canPick = rulesAllowed(candidate) && (!teamUp || teamUpCompatible(candidate));
                  return (
                    <button
                      key={seconds}
                      type="button"
                      className={rules.turnSeconds === seconds ? "is-selected" : ""}
                      aria-pressed={rules.turnSeconds === seconds}
                      disabled={pending || !canPick}
                      title={canPick ? undefined : "Start from Classic to change this"}
                      onClick={() =>
                        void run(async () => {
                          const next = await setRoomRules(client, roomId, candidate);
                          useRoomStore.getState().setRoomState(next);
                        })
                      }
                    >
                      {seconds}s
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {host && (
          <div className="lobby-player-count lobby-house-rule lobby-length">
            <span>
              <span className="eyebrow">MATCH CLOCK</span>
              <strong>{rules.matchMinutes ? `${rules.matchMinutes} minutes` : "No clock"}</strong>
              <small>
                {rules.matchMinutes
                  ? "When time is up, whoever got furthest wins"
                  : "The match runs until someone wins"}
              </small>
            </span>
            <div className="lobby-length-choices">
              {[0, 5, 10].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className={rules.matchMinutes === minutes ? "is-selected" : ""}
                  aria-pressed={rules.matchMinutes === minutes}
                  disabled={pending || (teamUp && minutes !== 0)}
                  title={teamUp && minutes !== 0 ? "Turn Team Up off to add a clock" : undefined}
                  onClick={() =>
                    void run(async () => {
                      const next = await setRoomRules(client, roomId, { ...rules, matchMinutes: minutes });
                      useRoomStore.getState().setRoomState(next);
                    })
                  }
                >
                  {minutes ? `${minutes} min` : "Off"}
                </button>
              ))}
            </div>
          </div>
        )}
        {host && state.gameType === "snakes_and_ladders" && (
          <div className="lobby-player-count lobby-house-rule lobby-length">
            <span>
              <span className="eyebrow">BOARD</span>
              <strong>{rules.snakesBoard === 1 ? "Second board" : "Original board"}</strong>
              <small>Two printed boards, each with its own snakes and ladders</small>
            </span>
            <div className="lobby-length-choices">
              {[0, 1].map((board) => (
                <button
                  key={board}
                  type="button"
                  className={rules.snakesBoard === board ? "is-selected" : ""}
                  aria-pressed={rules.snakesBoard === board}
                  disabled={pending}
                  onClick={() =>
                    void run(async () => {
                      const next = await setRoomRules(client, roomId, { ...rules, snakesBoard: board });
                      useRoomStore.getState().setRoomState(next);
                    })
                  }
                >
                  {board === 0 ? "Original" : "Second"}
                </button>
              ))}
            </div>
          </div>
        )}
        {host && state.gameType === "snakes_and_ladders" &&
          ([
            ["snakesAnyRollToStart", "Any roll to start", "Your piece joins the board on any roll, not just a six"],
            ["snakesBounceBack", "Bounce back off 100", "Overshooting 100 bounces back instead of staying put"],
          ] as const).map(([key, title, note]) => (
            <label key={key} className="lobby-player-count lobby-house-rule">
              <span>
                <span className="eyebrow">HOUSE RULE</span>
                <strong>{title}</strong>
                <small>{note}</small>
              </span>
              <input
                type="checkbox"
                checked={rules[key]}
                disabled={pending}
                onChange={(event) =>
                  void run(async () => {
                    const next = await setRoomRules(client, roomId, {
                      ...rules,
                      [key]: event.target.checked,
                    });
                    useRoomStore.getState().setRoomState(next);
                  })
                }
              />
            </label>
          ))}
        {me && !me.isBot && (
          <div className="lobby-color-choice">
            <span>
              <span className="eyebrow">YOUR BASE</span>
              <strong>Choose your color</strong>
            </span>
            <div>
              {myChoiceSeats.map((seat) => {
                const color = SEAT_COLORS[seat];
                const occupant = state.players.find(
                  (player) => player.color === color,
                );
                const selected = me.color === color;
                return (
                  <button
                    key={color}
                    type="button"
                    className={selected ? "is-selected" : ""}
                    disabled={pending || (!!occupant && !selected)}
                    aria-label={
                      occupant && !selected
                        ? `${color} base taken by ${occupant.displayName}`
                        : `Choose ${color} base`
                    }
                    aria-pressed={selected}
                    title={
                      occupant && !selected
                        ? `Taken by ${occupant.displayName}`
                        : `${color} base`
                    }
                    onClick={() =>
                      void run(async () => {
                        const next = await setPlayerColor(client, roomId, color);
                        useRoomStore.getState().setRoomState(next);
                      })
                    }
                  >
                    <i style={{ background: COLORS[color] }} />
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {host && (
          <label className="lobby-player-count">
            <span>
              <span className="eyebrow">TABLE SIZE</span>
              <strong>How many players?</strong>
              <small>
                {teamUp
                  ? "Team Up is always four players — two against two"
                  : state.gameType === "snakes_and_ladders"
                    ? "Snakes & Ladders is up to four players"
                    : maxPlayers > 4
                      ? "Five or six players play on a hexagonal board"
                      : "Empty selected seats become computers"}
              </small>
            </span>
            <select
              value={maxPlayers}
              disabled={pending || teamUp}
              onChange={(event) =>
                void run(async () => {
                  const next = await setRoomMaxPlayers(
                    client,
                    roomId,
                    Number(event.target.value),
                  );
                  useRoomStore.getState().setRoomState(next);
                })
              }
            >
              {[2, 3, 4, 5, 6].map((count) => (
                <option
                  key={count}
                  value={count}
                  disabled={
                    count < occupiedCount ||
                    (state.gameType === "snakes_and_ladders" && count > 4)
                  }
                >
                  {count} players
                </option>
              ))}
            </select>
          </label>
        )}
        {voice && (!isParty || meRemote) && (
          <div className="lobby-voice">
            <button
              className={voice.joined ? "is-active" : ""}
              disabled={voice.connecting}
              onClick={() => (voice.joined ? voice.toggleMute() : voice.join())}
            >
              <Icon name={voice.joined && !voice.muted ? "mic" : "mic-off"} />
              {voice.connecting
                ? "Joining…"
                : voice.joined
                  ? voice.muted
                    ? "Unmute"
                    : "Mute"
                  : "Join audio"}
            </button>
            <button
              className={voice.cameraOn ? "is-active" : ""}
              disabled={voice.cameraStarting || (!voice.cameraOn && !voice.videoAvailable)}
              title={
                voice.videoAvailable || voice.cameraOn
                  ? undefined
                  : "Video isn't available at this table"
              }
              onClick={voice.startVideo}
            >
              <Icon name="camera" />
              {voice.cameraStarting
                ? "Starting…"
                : voice.cameraOn
                  ? "Stop video"
                  : !voice.videoAvailable
                    ? "Video unavailable"
                    : "Start video"}
            </button>
            {voice.joined && (
              <button className="leave-voice" onClick={voice.leave}>
                <Icon name="phone-off" />
                Leave audio
              </button>
            )}
            {voice.error && (
              <span className="lobby-voice-error">{voice.error}</span>
            )}
          </div>
        )}
        <div className="lobby-seats">
          {relevantSeats.map((seat) => {
            const color = SEAT_COLORS[seat];
            const player = state.players.find((p) => p.seatIndex === seat);
            return (
              <div
                key={color}
                className={`lobby-seat ${player ? "occupied" : ""}`}
              >
                {player ? (
                  <PlayerProfileButton
                    playerId={player.id}
                    displayName={player.displayName}
                    isBot={player.isBot}
                  >
                    <PlayerAvatar
                      player={player}
                      size={44}
                      className="lobby-avatar"
                      level={player.isBot ? undefined : player.level}
                    />
                  </PlayerProfileButton>
                ) : (
                  <span className="lobby-avatar" style={{ borderColor: COLORS[color] }}>+</span>
                )}
                <span>
                  <strong>
                    {player
                      ? `${player.displayName}${player.id === myPlayerId ? " · You" : ""}`
                      : "An open seat"}
                  </strong>
                  <small>
                    {player
                      ? player.isBot
                        ? "Computer is ready"
                        : "Ready at the table"
                      : `${color} pieces`}
                  </small>
                </span>
                {!player && host && (
                  <button
                    disabled={pending}
                    onClick={() =>
                      void run(() => fillBot(client, roomId, seat))
                    }
                  >
                    Add computer
                  </button>
                )}
                {player?.inVoice && (
                  <span
                    className={`lobby-seat-mic ${voice?.speakingPlayerIds.has(player.id) ? "speaking" : ""}`}
                  >
                    <Icon name="mic" size={12} />
                  </span>
                )}
                {player && <Icon name="check" size={14} />}
              </div>
            );
          })}
        </div>
        {host ? (
          <button
            className="sim-primary"
            // Enabled even when the host is alone: the label offers "add a
            // computer", and the handler fills the open seats with bots before
            // starting, so a solo host can begin against computers.
            disabled={pending}
            onClick={() =>
              void run(async () => {
                const openSeats = relevantSeats.filter(
                  (seat) => !state.players.some((p) => p.seatIndex === seat),
                );
                const computersNeeded = maxPlayers - state.players.length;
                for (const seat of openSeats.slice(0, computersNeeded))
                  await fillBot(client, roomId, seat);
                await startMatch(client, roomId);
              }, "start")
            }
          >
            {pending
              ? "Preparing the table…"
              : state.players.length < 2
                ? "Invite a friend or add a computer"
                : state.players.length < maxPlayers
                  ? `Add ${maxPlayers - state.players.length} computer${maxPlayers - state.players.length === 1 ? "" : "s"} & play`
                  : "Everyone’s here. Let’s play."}
            <Icon name="arrow" />
          </button>
        ) : (
          <p className="lobby-wait">
            {isParty ? "The VIP will start the game shortly." : "Your host will start the match shortly."}
          </p>
        )}
        <TurnReminderPrompt client={client} />
        {error && (
          <p className="lobby-error" role="alert">
            {error}
          </p>
        )}
        {state.isParty && <PartySafety state={state} myPlayerId={myPlayerId} />}
      </section>
      <footer className="entrance-footer">
        <Link href="/">← BACK TO THE ENTRANCE</Link>
        <span>
          <i className="connection-dot" />
          {state.players.length} OF {maxPlayers} SEATS TAKEN
        </span>
      </footer>
    </main>
  );
}
