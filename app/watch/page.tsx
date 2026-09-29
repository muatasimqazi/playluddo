"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { WatchView } from "@/components/watch/WatchView";
import { TableLoading } from "@/components/simulator/TableLoading";

function Watch() {
  const roomId = useSearchParams().get("room");
  if (!roomId)
    return (
      <div className="replay-message" role="alert">
        <p>No table to watch.</p>
        <Link href="/" className="sim-primary">
          Back to the apartment
        </Link>
      </div>
    );
  return <WatchView roomId={roomId} />;
}

export default function WatchPage() {
  return (
    <Suspense fallback={<TableLoading label="Joining the table…" />}>
      <Watch />
    </Suspense>
  );
}
