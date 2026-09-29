import type { Metadata } from "next";
import { Suspense } from "react";
import { PartyScreen } from "@/components/party/PartyScreen";
import { TableLoading } from "@/components/simulator/TableLoading";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Party Mode – ${BRAND.name}`,
  description: `Put the ${BRAND.name} table on a TV and play from your phones.`,
  alternates: { canonical: "/screen" },
};

// A query parameter (?id=), not a path segment, like /room: the static app
// build can't pre-render paths for rooms created at runtime.
export default function ScreenPage() {
  return (
    <Suspense fallback={<TableLoading label="Setting up the screen…" />}>
      <PartyScreen />
    </Suspense>
  );
}
