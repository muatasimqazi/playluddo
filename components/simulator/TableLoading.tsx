/**
 * Shared `loading` fallback for every `next/dynamic(..., { ssr: false })`
 * import of the 3D table (Simulator, SimulatorScene, PracticeTable,
 * TableTogether). A real CSS 3D transform, not WebGL — using three.js to
 * draw the "three.js is still loading" screen would be circular, and a
 * spinner alone leaves the rest of the page looking finished while
 * nothing is actually interactive yet, which is exactly the "click and
 * nothing happens" gap this exists to close.
 */

// Standard 1-6 pip layout on a 3x3 grid, row/col both 1-indexed.
const PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[2, 2]],
  2: [
    [1, 1],
    [3, 3],
  ],
  3: [
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  4: [
    [1, 1],
    [1, 3],
    [3, 1],
    [3, 3],
  ],
  5: [
    [1, 1],
    [1, 3],
    [2, 2],
    [3, 1],
    [3, 3],
  ],
  6: [
    [1, 1],
    [2, 1],
    [3, 1],
    [1, 3],
    [2, 3],
    [3, 3],
  ],
};
const FACES = [
  { value: 1, className: "tld-face-front" },
  { value: 6, className: "tld-face-back" },
  { value: 2, className: "tld-face-right" },
  { value: 5, className: "tld-face-left" },
  { value: 3, className: "tld-face-top" },
  { value: 4, className: "tld-face-bottom" },
] as const;

/**
 * `progress` adds a loading bar under the die: a number (0-100) fills it
 * and shows the percent, `null` runs it indeterminate (for the code-chunk
 * download, which reports no progress), and leaving it out hides it.
 */
export function TableLoading({
  label = "Setting the table…",
  progress,
  className = "",
}: {
  label?: string;
  progress?: number | null;
  className?: string;
}) {
  const percent = progress == null ? null : Math.round(progress);
  return (
    <div className={`table-loading ${className}`} role="status" aria-live="polite">
      <div className="table-loading-die">
        <span className="tld-cube">
          {FACES.map((face) => (
            <span key={face.value} className={`tld-face ${face.className}`}>
              {PIP_LAYOUTS[face.value].map(([row, col], i) => (
                <i key={i} style={{ gridRow: row, gridColumn: col }} />
              ))}
            </span>
          ))}
        </span>
      </div>
      <p>{label}</p>
      {progress !== undefined && (
        <div className="table-loading-progress">
          <div
            className={`table-loading-bar ${percent === null ? "is-indeterminate" : ""}`}
            role="progressbar"
            aria-label="Loading the table"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
          >
            <span style={percent === null ? undefined : { width: `${percent}%` }} />
          </div>
          <span className="table-loading-percent">
            {percent === null ? "Loading" : `${percent}%`}
          </span>
        </div>
      )}
    </div>
  );
}
