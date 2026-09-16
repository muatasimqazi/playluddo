import { create } from "zustand";
import type { GameRoomState } from "../board/types";
import type { MatchEventRow } from "../realtime/room-channel";
import type { TableMessage } from "../realtime/table-messages";

interface RoomStore {
  roomState: GameRoomState | null;
  events: MatchEventRow[];
  myPlayerId: string | null;
  connectionToken: string | null;
  /** Set once a duplicate session (a newer claim_seat call) has replaced this tab's control of its seat. */
  sessionReplaced: boolean;
  connection: "connected" | "connecting" | "reconnecting";
  messages: TableMessage[];
  setConnection: (status: "connected" | "connecting" | "reconnecting") => void;
  addMessage: (message: TableMessage) => void;
  setRoomState: (state: GameRoomState) => void;
  setEvents: (events: MatchEventRow[]) => void;
  setIdentity: (playerId: string, connectionToken: string) => void;
  setSessionReplaced: () => void;
  reset: () => void;
}

export const useRoomStore = create<RoomStore>((set) => ({
  roomState: null,
  events: [],
  myPlayerId: null,
  connectionToken: null,
  sessionReplaced: false,
  connection: "connecting",
  messages: [],
  setConnection: (connection) => set({ connection }),
  addMessage: (message) =>
    set((s) => ({
      messages: s.messages.some((m) => m.id === message.id)
        ? s.messages
        : [...s.messages, message]
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
            .slice(-60),
    })),
  setRoomState: (state) =>
    set((s) =>
      s.roomState &&
      s.roomState.roomId === state.roomId &&
      s.roomState.eventSequence > state.eventSequence
        ? s
        : { roomState: state },
    ),
  setEvents: (events) =>
    set((s) =>
      (s.events.at(-1)?.sequence ?? -1) > (events.at(-1)?.sequence ?? -1)
        ? s
        : { events },
    ),
  setIdentity: (playerId, connectionToken) =>
    set({ myPlayerId: playerId, connectionToken }),
  setSessionReplaced: () => set({ sessionReplaced: true }),
  reset: () =>
    set({
      roomState: null,
      events: [],
      myPlayerId: null,
      connectionToken: null,
      sessionReplaced: false,
      connection: "connecting",
      messages: [],
    }),
}));
