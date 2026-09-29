"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { ReplayView } from "@/components/replay/ReplayView";
import { TableLoading } from "@/components/simulator/TableLoading";

function Replay() {
  const matchId = useSearchParams().get("match");
  if (!matchId)
    return (
      <div className="replay-message" role="alert">
        <p>No match to replay.</p>
        <Link href="/" className="sim-primary">
          Back to the apartment
        </Link>
      </div>
    );
  return <ReplayView matchId={matchId} />;
}

export default function ReplayPage() {
  return (
    <Suspense fallback={<TableLoading label="Loading the replay" />}>
      <Replay />
    </Suspense>
  );
}
