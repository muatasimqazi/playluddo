import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Required for the static-export Capacitor build (next.config.ts,
// output: "export") — this image has no per-request data, so it's
// always safe to render once at build time.
export const dynamic = "force-static";

const COLORS = ["#d27766", "#8fae90", "#82a0c4", "#d8bd78"];

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8f9fa",
          fontFamily: "sans-serif",
        }}
      >
        {/* A subtle roof silhouette above the four bases */}
        <div
          style={{
            display: "flex",
            width: 180,
            height: 70,
            background: "#4a4a42",
            opacity: 0.85,
            clipPath: "polygon(90px 0px, 0px 70px, 180px 70px)",
          }}
        />
        {/* The four Ludo colors, standing in for the four players/rooms */}
        <div style={{ display: "flex", gap: 14, marginTop: 22 }}>
          {COLORS.map((color) => (
            <div
              key={color}
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: color,
              }}
            />
          ))}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 40,
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: -1,
            color: "#1f2419",
          }}
        >
          {BRAND.name}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 12,
            fontSize: 30,
            fontWeight: 500,
            color: "#6b6f63",
          }}
        >
          {`${BRAND.tagline}. Play ${BRAND.gameName} online with friends.`}
        </div>
      </div>
    ),
    size,
  );
}
