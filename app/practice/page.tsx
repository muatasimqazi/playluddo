"use client";
import dynamic from "next/dynamic";
const PracticeTable = dynamic(
  () => import("@/components/simulator/PracticeTable"),
  { ssr: false },
);
export default function PracticePage() {
  return <PracticeTable />;
}
