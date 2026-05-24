"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase";

export function createClient() {
  return createSupabaseBrowserClient();
}
