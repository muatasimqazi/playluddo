import { create } from "zustand";
import type { GameRoomState } from "../board/types";
import type { MatchEventRow } from "../realtime/room-channel";

interface RoomStore {
  roomState: GameRoomState | null;
  events: MatchEventRow[];
  myPlayerId: string | null;
  connectionToken: string | null;
  /** Set once a duplicate session (a newer claim_seat call) has replaced this tab's control of its seat. */
  sessionReplaced: boolean;
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
  setRoomState: (state) => set({ roomState: state }),
  setEvents: (events) => set({ events }),
  setIdentity: (playerId, connectionToken) => set({ myPlayerId: playerId, connectionToken }),
  setSessionReplaced: () => set({ sessionReplaced: true }),
  reset: () =>
    set({
      roomState: null,
      events: [],
      myPlayerId: null,
      connectionToken: null,
      sessionReplaced: false,
    }),
}));
