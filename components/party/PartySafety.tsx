"use client";

import { useEffect, useState } from "react";
import type { GameRoomState } from "@/lib/board/types";
import { createClient } from "@/lib/supabase/client";
import { getPartyExtras, type PartyExtras } from "@/lib/supabase/rpc";
import { REPORT_REASONS, reportPlayer, type ReportReason } from "@/lib/supabase/moderation";
import { useI18n } from "@/lib/i18n";

/** P7: players and audience can report names; only the current VIP removes audience. */
export function PartySafety({ state, myPlayerId }: { state: GameRoomState; myPlayerId: string | null }) {
  const { t } = useI18n();
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
    }).catch(() => { if (!cancelled) setNotice(t("party.safetyLoadError")); });
    return () => { cancelled = true; };
    // `t` only feeds the catch fallback; excluding it avoids reloading on locale change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setNotice(remove ? t("party.removedFromTable") : t("party.reportSent"));
      setConfirmRemove(false);
      if (remove) {
        setExtras(await getPartyExtras(client, state.roomId));
        setTarget("");
      }
    } catch { setNotice(t("party.actionFailedMoment")); }
    finally { setPending(false); }
  }
  return <section className="party-pad-safety" aria-label={t("party.safetyAria")}>
    <button type="button" className="party-pad-secondary" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t("party.closeSafety") : t("party.openSafety")}</button>
    {open && <div className="party-pad-safety-form">
      <label>{t("party.whoIsIt")}
        <select value={target} disabled={pending} onChange={(e) => { setTarget(e.target.value); setConfirmRemove(false); setNotice(""); }}>
          <option value="">{t("party.choosePerson")}</option>
          {state.players.filter((p) => !p.isBot && p.id !== myPlayerId).map((p) => <option key={p.id} value={`player:${p.id}`}>{p.displayName} · {t("party.suffixPlayer")}</option>)}
          {extras?.audienceMembers?.filter((p) => !p.isMe).map((p) => <option key={p.id} value={`audience:${p.id}`}>{p.name} · {t("party.suffixAudience")}</option>)}
        </select>
      </label>
      <label>{t("party.reason")}
        <select value={reason} disabled={pending} onChange={(e) => setReason(e.target.value as ReportReason)}>
          {Object.entries(REPORT_REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>{t("party.whatHappened")}<textarea value={details} maxLength={500} disabled={pending} onChange={(e) => setDetails(e.target.value)} /></label>
      <button type="button" className="party-pad-primary" disabled={!target || pending} onClick={() => void act(false)}>{t("party.sendReport")}</button>
      {vip && audience && <>
        {confirmRemove && <p>{t("party.removeConfirmNote")}</p>}
        <button type="button" className="party-pad-secondary" disabled={pending} onClick={() => confirmRemove ? void act(true) : setConfirmRemove(true)}>{confirmRemove ? t("party.confirmRemoval") : t("party.removeFromAudience")}</button>
      </>}
      {notice && <p role="status">{notice}</p>}
    </div>}
  </section>;
}
