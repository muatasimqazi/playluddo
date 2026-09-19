export const AVATARS = [
  { id: "fox", label: "Avery", portrait: "/avatars/avery.webp", primary: "#d94c32", secondary: "#7f2f28" },
  { id: "panda", label: "Kai", portrait: "/avatars/kai.webp", primary: "#28765c", secondary: "#183e34" },
  { id: "lion", label: "Malik", portrait: "/avatars/malik.webp", primary: "#e5ad35", secondary: "#76521f" },
  { id: "owl", label: "Maya", portrait: "/avatars/maya.webp", primary: "#3275d2", secondary: "#214277" },
  { id: "koala", label: "Theo", portrait: "/avatars/theo.webp", primary: "#3d76c5", secondary: "#263f6c" },
  { id: "tiger", label: "Sofia", portrait: "/avatars/sofia.webp", primary: "#e4b432", secondary: "#786121" },
  { id: "frog", label: "Omar", portrait: "/avatars/omar.webp", primary: "#cf4438", secondary: "#712b2b" },
  { id: "bear", label: "Nia", portrait: "/avatars/nia.webp", primary: "#31845b", secondary: "#1d4f3a" },
] as const;

export type AvatarId = (typeof AVATARS)[number]["id"];

export function avatarDefinition(id?: string) {
  return AVATARS.find((avatar) => avatar.id === id);
}

export function avatarForSeat(avatarId: string | undefined, seatIndex: number) {
  return avatarDefinition(avatarId) ?? AVATARS[seatIndex % AVATARS.length];
}
