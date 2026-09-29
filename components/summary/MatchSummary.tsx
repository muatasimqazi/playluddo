"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { acceptRematch, requestRematch } from "@/lib/supabase/rpc";
import { rankPlayers, resolveRoomRules, type PlayerProgress } from "@/lib/board/rules";
import type { PlayerColor } from "@/lib/board/types";
import { useRoomStore } from "@/lib/store/room-store";

/** Team Up (F2.5) sides: red+yellow versus green+blue. */
const sideOf = (color: PlayerColor): 0 | 1 =>
  color === "red" || color === "yellow" ? 0 : 1;
const SIDE_LABEL = ["Red & Yellow", "Green & Blue"] as const;

interface MatchSummaryProps {
  client: SupabaseClient;
  roomId: string;
}

export function MatchSummary({ client, roomId }: MatchSummaryProps) {
  const router = useRouter();
  const roomState = useRoomStore((s) => s.roomState);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ranking = useMemo(() => {
    if (!roomState) return [];
    if (
      roomState.status === "summary" &&
      roomState.winnerIds.length === roomState.players.length
    )
      return roomState.winnerIds;
    const progress: PlayerProgress[] = roomState.players.map((player) => {
      const pawns = roomState.pawns.filter((p) => p.color === player.color);
      return {
        id: player.id,
        pawnsFinished: pawns.filter((p) => p.state === "finished").length,
        totalProgress: pawns.reduce((sum, p) => sum + (p.pathIndex ?? 0), 0),
        turnOrder: player.seatIndex,
      };
    });
    return rankPlayers(progress);
  }, [roomState]);

  if (!roomState) return null;

  const playerById = new Map(roomState.players.map((p) => [p.id, p]));
  const myPlayer = playerById.get(myPlayerId ?? "") ?? null;
  const isAbandoned = roomState.status === "abandoned" || roomState.matchEndReason === "abandoned";
  const teamUp = resolveRoomRules(roomState.rules).teamUp === true;

  // Team Up standings: each side's eight pawns counted together, and the
  // winning side (the one holding the first placement) shown first.
  const winningSide = roomState.winnerIds[0]
    ? sideOf(playerById.get(roomState.winnerIds[0])?.color ?? "red")
    : 0;
  const teams = ([0, 1] as const)
    .map((side) => {
      const members = roomState.players.filter((p) => sideOf(p.color) === side);
      const finished = roomState.pawns.filter(
        (p) => sideOf(p.color) === side && p.state === "finished",
      ).length;
      const totalProgress = roomState.pawns
        .filter((p) => sideOf(p.color) === side)
        .reduce((sum, p) => sum + (p.pathIndex ?? 0), 0);
      return { side, members, finished, totalProgress };
    })
    .sort((a, b) =>
      isAbandoned
        ? b.finished - a.finished || b.totalProgress - a.totalProgress
        : a.side === winningSide
          ? -1
          : 1,
    );
  const winningTeam = teams[0];

  async function run(fn: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  const rematchAction = !myPlayer
    ? null
    : myPlayer.rematchReady
      ? { label: "Waiting for others…", disabled: true, onClick: () => {} }
      : roomState.players.some((p) => p.rematchReady)
        ? { label: "Accept Rematch", disabled: false, onClick: () => run(() => acceptRematch(client, roomId)) }
        : { label: "Request Rematch", disabled: false, onClick: () => run(() => requestRematch(client, roomId)) };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4">
      <div className="rounded-lg border border-hairline bg-surface p-4 text-center shadow-elevation-2">
        {!isAbandoned && playerById.get(roomState.winnerIds[0]) && (
          <div className="mb-2 flex justify-center">
            <PlayerAvatar
              player={playerById.get(roomState.winnerIds[0])!}
              size={72}
              crowned
            />
          </div>
        )}
        <p className="text-label-lg text-action">
          {isAbandoned ? "Match Abandoned" : teamUp ? "Team Victory!" : "Victory!"}
        </p>
        <h1 className="mt-1 text-headline-md tracking-tight text-foreground">
          {isAbandoned
            ? "No active players remained"
            : teamUp
              ? `${winningTeam.members.map((m) => m.displayName).join(" & ")} win as a team!`
              : `${playerById.get(roomState.winnerIds[0])?.displayName ?? "A player"} is the champion!`}
        </h1>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface p-3 shadow-elevation-1">
        <h2 className="text-label-md text-foreground">Final Standings</h2>
        {teamUp
          ? teams.map((team, index) => (
              <div key={team.side} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="w-5 text-body-sm font-semibold text-text-secondary">
                    {index + 1}
                  </span>
                  <div className="flex -space-x-1">
                    {team.members.map((member) => (
                      <PlayerAvatar
                        key={member.id}
                        player={member}
                        size={28}
                        placement={index === 0 ? 1 : undefined}
                      />
                    ))}
                  </div>
                  <span className="flex-1 truncate text-body-sm text-foreground">
                    {team.members.map((m) => m.displayName).join(" & ")}
                    {team.members.some((m) => m.id === myPlayerId) && " (You)"}
                  </span>
                  <span className="text-label-sm text-text-secondary">{team.finished}/8 home</span>
                </div>
                <span className="pl-7 text-label-sm text-text-secondary">{SIDE_LABEL[team.side]}</span>
              </div>
            ))
          : ranking.map((playerId, index) => {
              const player = playerById.get(playerId);
              if (!player) return null;
              const pawns = roomState.pawns.filter((p) => p.color === player.color);
              const finished = pawns.filter((p) => p.state === "finished").length;
              return (
                <div key={playerId} className="flex items-center gap-2">
                  <span className="w-5 text-body-sm font-semibold text-text-secondary">{index + 1}</span>
                  <PlayerAvatar
                    player={player}
                    size={28}
                    placement={index < 3 ? ((index + 1) as 1 | 2 | 3) : undefined}
                  />
                  <span className="flex-1 truncate text-body-sm text-foreground">
                    {player.displayName} {player.id === myPlayerId && "(You)"}
                  </span>
                  <span className="text-label-sm text-text-secondary">{finished}/4 home</span>
                </div>
              );
            })}
      </div>

      {!isAbandoned && rematchAction && (
        <button
          type="button"
          disabled={pending || rematchAction.disabled}
          onClick={rematchAction.onClick}
          className="h-12.5 rounded-md bg-action text-label-lg text-white shadow-elevation-2 transition-transform active:scale-97 disabled:opacity-50"
        >
          {rematchAction.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => router.push("/")}
        className="h-12.5 rounded-md border border-hairline bg-white text-label-lg text-foreground transition-transform active:scale-97"
      >
        Return to Lobby
      </button>

      {error && (
        <p role="alert" className="text-center text-body-sm text-quadrant-red">
          {error}
        </p>
      )}
    </div>
  );
}
