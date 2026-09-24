"use client";
import dynamic from "next/dynamic";
import { TableLoading } from "@/components/simulator/TableLoading";
import { usePreloadBoardScene } from "@/lib/presentation/preloadScene";
// Eagerly loaded here, not just inside the PracticeTable -> Simulator chain
// below, so the loading fallback's own styling (the die animation) is
// available immediately instead of arriving with the same lazy chunk it's
// standing in for.
import "@/components/simulator/simulator.css";

const PracticeTable = dynamic(
  () => import("@/components/simulator/PracticeTable"),
  { ssr: false, loading: () => <TableLoading label="Setting up your offline table…" /> },
);
export default function PracticePage() {
  // Covers landing here directly (bookmark, deep link) without a prior
  // visit to the entrance page having warmed this already.
  usePreloadBoardScene();
  return <PracticeTable />;
}
