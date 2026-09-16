import type { CSSProperties } from "react";
export type IconName =
  | "play"
  | "look"
  | "rotate"
  | "camera"
  | "sound"
  | "muted"
  | "chat"
  | "settings"
  | "expand"
  | "close"
  | "menu"
  | "dice"
  | "replay"
  | "arrow"
  | "home"
  | "check"
  | "users";
const paths: Record<IconName, React.ReactNode> = {
  play: (
    <>
      <path d="m9 5 10 7-10 7Z" />
    </>
  ),
  look: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  rotate: (
    <>
      <path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" />
    </>
  ),
  camera: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="3" />
      <path d="m8 6 2-3h4l2 3" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  sound: (
    <>
      <path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
    </>
  ),
  muted: (
    <>
      <path d="m11 4-6 5H2v6h3l6 5ZM16 9l6 6m0-6-6 6" />
    </>
  ),
  chat: (
    <>
      <path d="M21 11a8 8 0 0 1-8 8H5l-3 3V7a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4Z" />
      <path d="M7 9h9M7 13h6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="m9 3 1-1h4l1 3 3 1 3 2-1 3 1 3-2 3-3 1-1 3h-4l-1-3-3-1-2-3 1-3-1-3 3-2 3-1Z" />
    </>
  ),
  expand: (
    <>
      <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  dice: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8" cy="8" r=".8" />
      <circle cx="16" cy="16" r=".8" />
      <circle cx="12" cy="12" r=".8" />
    </>
  ),
  replay: (
    <>
      <path d="M3 9a9 9 0 1 1 0 7M3 3v6h6" />
      <path d="m10 8 6 4-6 4Z" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  home: (
    <>
      <path d="m3 10 9-7 9 7v11H3Z" />
      <path d="M9 21v-8h6v8" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5" />
    </>
  ),
};
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
