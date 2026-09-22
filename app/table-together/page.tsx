"use client";

import dynamic from "next/dynamic";
import { TableLoading } from "@/components/simulator/TableLoading";
// Eagerly loaded here, not just inside the TableTogether -> Simulator chain
// below, so the loading fallback's own styling (the die animation) is
// available immediately instead of arriving with the same lazy chunk it's
// standing in for.
import "@/components/simulator/simulator.css";

const TableTogether = dynamic(
  () => import("@/components/simulator/TableTogether"),
  { ssr: false, loading: () => <TableLoading label="Setting up your offline table…" /> },
);

export default function TableTogetherPage() {
  return <TableTogether />;
}
