/**
 * Dice skins (docs/COMPETITIVE_ROADMAP.md F3.5): how each earned dice
 * cosmetic draws the table's die. The die wears the skin of whoever is
 * rolling, so equipped dice are seen by everyone at the table. Every skin
 * stays neutral in colour — where the die rests already says whose turn it
 * is — and keeps strong pip contrast, so a roll reads at a glance (F5.5).
 */
export type DiceSkin = "classic" | "glass" | "wood" | "marble";

const DICE_COSMETIC_SKIN: Record<string, DiceSkin> = {
  dice_classic: "classic",
  dice_glass: "glass",
  dice_wood: "wood",
  dice_marble: "marble",
};

/** Every dice cosmetic the table can draw, in catalog order. */
export const DICE_COSMETICS = Object.keys(DICE_COSMETIC_SKIN);

/** The skin for an equipped dice cosmetic id; the classic die when none (or unknown). */
export function diceSkinFor(cosmeticId: string | undefined): DiceSkin {
  return (cosmeticId && DICE_COSMETIC_SKIN[cosmeticId]) || "classic";
}
