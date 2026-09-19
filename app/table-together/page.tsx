"use client";

import dynamic from "next/dynamic";

const TableTogether = dynamic(
  () => import("@/components/simulator/TableTogether"),
  { ssr: false },
);

export default function TableTogetherPage() {
  return <TableTogether />;
}
