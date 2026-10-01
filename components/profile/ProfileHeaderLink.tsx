"use client";

import Link from "next/link";
import { Icon } from "@/components/simulator/Icon";
import { useI18n } from "@/lib/i18n";

/**
 * The header's way to your own profile page, next to Leaderboard and
 * Tournaments (a circle on phones, like them). Guests land on the page's
 * "sign in to start a profile" note.
 */
export function ProfileHeaderLink() {
  const { t } = useI18n();
  return (
    <Link className="profile-trigger leaderboard-trigger" href="/profile">
      <Icon name="user" />
      <small>{t("common.profile")}</small>
    </Link>
  );
}
