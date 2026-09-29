import { encode } from "uqr";

/**
 * A QR code drawn as SVG squares (no injected markup), dark on light with
 * the quiet zone scanners need. Sized by its container.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = encode(value);
  const margin = 2;
  const cells: string[] = [];
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) cells.push(`M${x + margin},${y + margin}h1v1h-1z`);
    }),
  );
  const extent = size + margin * 2;
  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${extent} ${extent}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={extent} height={extent} fill="#fff" />
      <path d={cells.join("")} fill="#111" />
    </svg>
  );
}
