import { NextResponse } from "next/server";
import { getSupabaseServiceRoleStatus, getSupabaseUrl, hasSupabaseEnv, hasSupabaseServiceRoleEnv } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY" },
      { status: 400 }
    );
  }

  const url = getSupabaseUrl();
  const healthUrl = `${url.replace(/\/+$/, "")}/auth/v1/health`;
  const serviceRole = getSupabaseServiceRoleStatus();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(healthUrl, { signal: controller.signal, headers: { accept: "application/json" } });
    clearTimeout(timeout);

    const text = await resp.text();
    return NextResponse.json({
      ok: resp.ok,
      status: resp.status,
      healthUrl,
      serviceRolePresent: hasSupabaseServiceRoleEnv(),
      serviceRoleKind: serviceRole.keyKind,
      serviceRoleJwtRole: serviceRole.jwtRole,
      serviceRolePrivileged: serviceRole.isPrivileged,
      hint:
        resp.ok
          ? "Supabase reachable from server."
          : "Supabase returned non-OK. Check project URL, auth enabled, and network.",
      bodyPreview: text.slice(0, 180)
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        healthUrl,
        error: err instanceof Error ? err.message : "Fetch failed",
        hint:
          "If browser shows 'Failed to fetch', most common causes: wrong NEXT_PUBLIC_SUPABASE_URL (points to HTML), http vs https mismatch, env vars not applied (redeploy), adblock/VPN/proxy blocking supabase.co."
      },
      { status: 502 }
    );
  }
}
