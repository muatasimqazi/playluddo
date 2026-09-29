"use client";

import { useSearchParams } from "next/navigation";

/**
 * On /how-to-play?homeRoll=off (or =on), names that table's house rule.
 * Without the parameter, the page describes the defaults and says nothing.
 */
export function TableRulesNote() {
  const homeRoll = useSearchParams().get("homeRoll");
  if (homeRoll !== "on" && homeRoll !== "off") return null;
  return (
    <p className="info-callout">
      <strong>At your table:</strong>{" "}
      {homeRoll === "on"
        ? "getting a piece home earns another roll, as below."
        : "the house rule is off, so getting a piece home doesn’t earn another roll. Everything else below applies."}
    </p>
  );
}
