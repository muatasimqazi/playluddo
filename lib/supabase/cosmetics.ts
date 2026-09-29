import type { SupabaseClient } from "@supabase/supabase-js";

export type CosmeticType = "board" | "piece" | "dice" | "room" | "reaction";

/** A catalog cosmetic with this player's own state (F3.5). */
export interface Cosmetic {
  id: string;
  type: CosmeticType;
  name: string;
  description: string;
  owned: boolean;
  equipped: boolean;
  /** How to earn it, for locked items; null for free defaults. */
  requirement: string | null;
}

/** The equipped cosmetic id per type, as it rides in the room state. */
export type EquippedCosmetics = Partial<Record<CosmeticType, string>>;

export async function getMyCosmetics(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_my_cosmetics");
  if (error) throw new Error(error.message);
  return data as Cosmetic[];
}

/** Equips an owned cosmetic (one per type). Throws if it isn't earned yet. */
export async function equipCosmetic(client: SupabaseClient, cosmeticId: string) {
  const { error } = await client.rpc("equip_cosmetic", { p_cosmetic_id: cosmeticId });
  if (error) throw new Error(error.message);
}
