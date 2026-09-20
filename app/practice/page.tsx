"use client";
import dynamic from "next/dynamic";
import { TableLoading } from "@/components/simulator/TableLoading";
// Eagerly loaded here, not just inside the PracticeTable -> Simulator chain
// below, so the loading fallback's own styling (the die animation) is
// available immediately instead of arriving with the same lazy chunk it's
// standing in for.
import "@/components/simulator/simulator.css";

const PracticeTable = dynamic(
  () => import("@/components/simulator/PracticeTable"),
  { ssr: false, loading: () => <TableLoading label="Setting the table…" /> },
);
export default function PracticePage() {
  return <PracticeTable />;
}
