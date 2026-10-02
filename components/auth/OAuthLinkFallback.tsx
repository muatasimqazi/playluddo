"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { resumeFailedOAuthLink } from "@/lib/supabase/linkAccount";
import { webUrlHere } from "@/lib/native";

/**
 * Web only, mounted once in app/layout.tsx. A guest's Google or Apple sign-in
 * first tries linking to the guest (lib/supabase/linkAccount.ts); if the
 * provider account already has a Luddo House account, the redirect comes back
 * refused, and this signs in to that account instead.
 */
export function OAuthLinkFallback() {
  useEffect(() => {
    void resumeFailedOAuthLink(createClient(), webUrlHere()).catch(() => {});
  }, []);
  return null;
}
