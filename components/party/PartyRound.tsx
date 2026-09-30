"use client";

import { useState } from "react";
import { useCountdown } from "@/lib/hooks/useCountdown";
import { hapticTap } from "@/lib/hooks/useCoarsePointer";
import { clock } from "@/lib/presentation/controller";
import { useI18n } from "@/lib/i18n";
import type { PartyRound as Round } from "@/lib/supabase/rpc";

/**
 * The between-game round on a phone (docs/COMPETITIVE_ROADMAP.md P8): one
 * question about the game that just ended, with a minute to answer. Purely
 * social — the answer was settled before anyone guessed.
 */
export function PartyRound({
  round,
  onGuess,
  disabled = false,
}: {
  round: Round;
  onGuess: (guess: number) => Promise<unknown>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secondsLeft = useCountdown(round.closed ? null : round.closesAt);
  const guess = Number(value);
  const valid = value !== "" && Number.isInteger(guess) && guess >= 0 && guess <= 999;

  async function send() {
    if (!valid || sending || disabled) return;
    setSending(true);
    setError(null);
    hapticTap(12);
    try {
      await onGuess(guess);
      setValue("");
    } catch {
      setError(t("party.roundSendError"));
    } finally {
      setSending(false);
    }
  }

  if (round.closed) {
    const won = round.closest?.some((c) => c.guess === round.myGuess) ?? false;
    return (
      <section className="party-pad-round" aria-labelledby="round-heading">
        <h2 id="round-heading">{round.question}</h2>
        <p className="party-pad-round-answer">{round.answer}</p>
        {round.myGuess !== null && <p>{t("party.youSaid", { guess: round.myGuess })}</p>}
        <p>
          {!round.closest?.length
            ? t("party.nobodyAnswered")
            : won
              ? t("party.closestJudged")
              : t("party.closestList", { list: round.closest.map((c) => `${c.name} (${c.guess})`).join(", ") })}
        </p>
      </section>
    );
  }

  return (
    <section className="party-pad-round" aria-labelledby="round-heading">
      <span className="eyebrow">{t("party.whileYoureHere").toUpperCase()}</span>
      <h2 id="round-heading">{round.question}</h2>
      <p>
        {secondsLeft !== null ? t("party.timeLeft", { time: clock(secondsLeft) }) : t("party.closing")} ·{" "}
        {round.guessCount === 1
          ? t("party.answersSoFarOne")
          : t("party.answersSoFarOther", { count: round.guessCount })}
      </p>
      <div className="party-pad-round-entry">
        <label>
          <input
            aria-label={t("party.yourAnswerAria")}
            type="number"
            inputMode="numeric"
            min={0}
            max={999}
            value={value}
            disabled={sending || disabled}
            placeholder={round.myGuess !== null ? String(round.myGuess) : "0"}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <button type="button" className="party-pad-primary" disabled={!valid || sending || disabled} onClick={() => void send()}>
          {round.myGuess !== null ? t("party.changeIt") : t("party.answer")}
        </button>
      </div>
      {round.myGuess !== null && !sending && <p>{t("party.yourAnswer", { guess: round.myGuess })}</p>}
      {error && (
        <p role="alert" className="party-pad-round-error">
          {error}
        </p>
      )}
    </section>
  );
}
