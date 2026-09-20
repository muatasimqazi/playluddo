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
export type PhotoAvatarStyle = "natural" | "warm" | "cool" | "mono";

export interface PhotoAvatar {
  style: PhotoAvatarStyle;
  portrait: string;
}

export function photoAvatar(id?: string): PhotoAvatar | null {
  const match = id?.match(/^photo:(natural|warm|cool|mono):(.+)$/);
  return match
    ? { style: match[1] as PhotoAvatarStyle, portrait: match[2] }
    : null;
}

export function makePhotoAvatar(url: string, style: PhotoAvatarStyle) {
  return `photo:${style}:${url}`;
}

export function avatarDefinition(id?: string) {
  return AVATARS.find((avatar) => avatar.id === id);
}

export function avatarForSeat(avatarId: string | undefined, seatIndex: number) {
  const photo = photoAvatar(avatarId);
  if (photo)
    return {
      id: avatarId!,
      label: "Custom photo avatar",
      portrait: photo.portrait,
      primary: "#dcca9f",
      secondary: "#526247",
    };
  return avatarDefinition(avatarId) ?? AVATARS[seatIndex % AVATARS.length];
}
