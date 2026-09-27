import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import { BRAND } from "@/lib/brand";
import { NativeShell } from "@/components/NativeShell";
import "./globals.css";

// "Modern Boardroom" design system (designs/modern_boardroom/DESIGN.md):
// Plus Jakarta Sans for its geometric clarity and tall x-height, mirroring
// native SF Pro rendering across mobile densities.
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

const title = `${BRAND.name} – Play ${BRAND.gameName} Online with Friends`;
const description = `Play ${BRAND.gameName} online with friends and family on ${BRAND.name}. Create a private room, invite your friends, and enjoy multiplayer ${BRAND.gameName} online.`;

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.url),
  title,
  description,
  alternates: { canonical: "/" },
  applicationName: BRAND.name,
  openGraph: {
    title,
    description,
    url: "/",
    siteName: BRAND.name,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

// viewport-fit=cover lets env(safe-area-inset-*) resolve to real, non-zero
// values on notched/rounded-corner devices — simulator.css already relies
// on them.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const isAppBuild = !!process.env.CAPACITOR_BUILD;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: BRAND.name,
  alternateName: BRAND.tagline,
  description: BRAND.description,
  url: BRAND.url,
  applicationCategory: "GameApplication",
  genre: `${BRAND.gameName} board game`,
  operatingSystem: "Any",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plusJakartaSans.variable} h-full antialiased`}>
      {/* JSON-LD lives in <head>, not <body>: PostHog (instrumentation-client.ts)
          injects its loader <script> next to the body's existing scripts before
          React hydrates, and a React-rendered script there made every page
          report a hydration mismatch. */}
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <NativeShell />
      </body>
      {/* Web only: the app build (CAPACITOR_BUILD) leaves out Google
          Analytics' marketing tracking, keeping the App Store privacy label
          to the product analytics declared in ios/App/App/PrivacyInfo.xcprivacy. */}
      {!isAppBuild && (
        <>
          <Script
            src="https://www.googletagmanager.com/gtag/js?id=G-75GZQ69MCG"
            strategy="afterInteractive"
          />
          <Script id="google-analytics" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-75GZQ69MCG');`}
          </Script>
        </>
      )}
    </html>
  );
}
