import type { SupabaseClient } from "@supabase/supabase-js";

/** The bucket profile photos are uploaded to, one folder per user id. */
export const AVATAR_BUCKET = "avatar-photos";

/**
 * Removes every profile photo an account uploaded. Deleting the auth user
 * doesn't touch Storage, so account deletion and the under-13 purge both call
 * this first. Throws if Storage refuses, so the caller can keep the account
 * and try again rather than leave the photos behind.
 */
export async function removeAvatarPhotos(admin: SupabaseClient, userId: string) {
  const photos = await admin.storage.from(AVATAR_BUCKET).list(userId);
  if (photos.error) throw photos.error;
  if (!photos.data?.length) return;
  const { error } = await admin.storage
    .from(AVATAR_BUCKET)
    .remove(photos.data.map((file) => `${userId}/${file.name}`));
  if (error) throw error;
}
