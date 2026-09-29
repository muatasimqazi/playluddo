"use client";

import { useEffect, useState } from "react";
import type { GameRoomState } from "@/lib/board/types";
import { createClient } from "@/lib/supabase/client";
import { getPartyExtras, type PartyExtras } from "@/lib/supabase/rpc";
import { REPORT_REASONS, reportPlayer, type ReportReason } from "@/lib/supabase/moderation";

/** P7: players and audience can report names; only the current VIP removes audience. */
export function PartySafety({ state, myPlayerId }: { state: GameRoomState; myPlayerId: string | null }) {
  const [open, setOpen] = useState(false);
  const [extras, setExtras] = useState<PartyExtras | null>(null);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState<ReportReason>("other");
  const [details, setDetails] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getPartyExtras(createClient(), state.roomId).then((value) => {
      if (!cancelled) setExtras(value);
    }).catch(() => { if (!cancelled) setNotice("Couldn’t load everyone. Close this and try again."); });
    return () => { cancelled = true; };
  }, [open, state.roomId]);
  const audience = target.startsWith("audience:");
  const id = target.slice(target.indexOf(":") + 1);
  const vip = !!myPlayerId && myPlayerId === state.hostPlayerId;
  async function act(remove: boolean) {
    if (!target) return;
    setPending(true); setNotice("");
    try {
      const client = createClient();
      if (remove || audience) {
        const { error } = await client.rpc(remove ? "remove_party_audience" : "report_party_audience", {
          p_room_id: state.roomId, p_member_id: id,
          ...(!remove ? { p_reason: reason, p_details: details.trim() || null } : {}),
        });
        if (error) throw error;
      } else await reportPlayer(client, state.roomId, id, reason, details);
      setNotice(remove ? "Removed from this party table." : "Report sent. Thank you for letting us know.");
      setConfirmRemove(false);
      if (remove) {
        setExtras(await getPartyExtras(client, state.roomId));
        setTarget("");
      }
    } catch { setNotice("That didn’t go through. Try again in a moment."); }
    finally { setPending(false); }
  }
  return <section className="party-pad-safety" aria-label="Party safety">
    <button type="button" className="party-pad-secondary" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close safety controls" : "Report or manage people"}</button>
    {open && <div className="party-pad-safety-form">
      <label>Who is it?
        <select value={target} disabled={pending} onChange={(e) => { setTarget(e.target.value); setConfirmRemove(false); setNotice(""); }}>
          <option value="">Choose a person</option>
          {state.players.filter((p) => !p.isBot && p.id !== myPlayerId).map((p) => <option key={p.id} value={`player:${p.id}`}>{p.displayName} · player</option>)}
          {extras?.audienceMembers?.filter((p) => !p.isMe).map((p) => <option key={p.id} value={`audience:${p.id}`}>{p.name} · audience</option>)}
        </select>
      </label>
      <label>Reason
        <select value={reason} disabled={pending} onChange={(e) => setReason(e.target.value as ReportReason)}>
          {Object.entries(REPORT_REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>What happened? (optional)<textarea value={details} maxLength={500} disabled={pending} onChange={(e) => setDetails(e.target.value)} /></label>
      <button type="button" className="party-pad-primary" disabled={!target || pending} onClick={() => void act(false)}>Send report</button>
      {vip && audience && <>
        {confirmRemove && <p>This person won’t be able to rejoin this party table with this account.</p>}
        <button type="button" className="party-pad-secondary" disabled={pending} onClick={() => confirmRemove ? void act(true) : setConfirmRemove(true)}>{confirmRemove ? "Confirm removal" : "Remove from audience"}</button>
      </>}
      {notice && <p role="status">{notice}</p>}
    </div>}
  </section>;
}
