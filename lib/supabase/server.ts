import { cookies } from "next/headers";
import { hasSupabaseEnv, createSupabaseServerClient } from "@/lib/supabase";

export async function createClient() {
  if (!hasSupabaseEnv()) return null;

  const cookieStore = await cookies();
  return createSupabaseServerClient(cookieStore);
}
