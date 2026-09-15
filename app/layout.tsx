import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// "Modern Boardroom" design system (designs/modern_boardroom/DESIGN.md):
// Plus Jakarta Sans for its geometric clarity and tall x-height, mirroring
// native SF Pro rendering across mobile densities.
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Let's Play Luddo",
  description: "Fast online Ludo matches with friends and rivals.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plusJakartaSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
