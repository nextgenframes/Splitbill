import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { CookieOptions } from "@supabase/ssr";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

export function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

export function getSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
}

export function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

export function hasSupabaseEnv() {
  return Boolean(getSupabaseUrl()) && Boolean(getSupabaseAnonKey());
}

export function hasSupabaseServiceRoleEnv() {
  return Boolean(getSupabaseUrl()) && Boolean(getSupabaseServiceRoleKey());
}

export function getSupabaseServiceRoleStatus() {
  const key = getSupabaseServiceRoleKey();
  const keyKind = getSupabaseKeyKind(key);
  const jwtRole = keyKind === "jwt" ? getJwtRoleClaim(key) : null;
  const isPrivileged = keyKind === "sb_secret" || (keyKind === "jwt" && jwtRole === "service_role");

  return {
    present: Boolean(key),
    keyKind,
    jwtRole,
    isPrivileged
  };
}

export function createSupabaseBrowserClient() {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  assertLooksLikeSupabaseUrl(url);
  assertHttpsInProduction(url);
  return createBrowserClient(url, key);
}

export function createSupabaseServerClient(cookieStore: ReadonlyRequestCookies) {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  assertLooksLikeSupabaseUrl(url);
  assertHttpsInProduction(url);

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      }
    }
  });
}

export function createSupabaseAdminClient() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) return null;
  if (!getSupabaseServiceRoleStatus().isPrivileged) return null;
  assertLooksLikeSupabaseUrl(url);
  assertHttpsInProduction(url);

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function getSupabaseKeyKind(key: string) {
  if (!key) return "missing";
  if (key.startsWith("sb_secret_")) return "sb_secret";
  if (key.startsWith("sb_publishable_")) return "sb_publishable";
  if (key.startsWith("eyJ")) return "jwt";
  return "unknown";
}

function getJwtRoleClaim(token: string) {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(normalized, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return typeof parsed.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

function assertLooksLikeSupabaseUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
  }

  const host = parsed.host.toLowerCase();
  const ok =
    host.endsWith(".supabase.co") ||
    host.endsWith(".supabase.in") ||
    host === "localhost:54321" ||
    host === "127.0.0.1:54321";

  if (!ok) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL does not look like a Supabase project URL (got ${parsed.origin})`
    );
  }
}

function assertHttpsInProduction(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (isLocal) return;

  if (parsed.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must start with https://");
  }
}
