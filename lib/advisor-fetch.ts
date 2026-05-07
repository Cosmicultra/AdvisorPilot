/**
 * Authenticated browser fetch for advisor APIs (NextAuth cookies + optional Supabase Bearer).
 * Retries once after refreshing the Supabase session when an email/password token expires.
 */

export const AP_SUPABASE_AT = "ap_supabase_at";
export const AP_SUPABASE_RT = "ap_supabase_rt";

export type AdvisorFetchInit = RequestInit & {
  /** Invoked when the refresh token is missing/invalid after a 401 on a Bearer-backed request. */
  onEmailSessionExpired?: () => void;
};

function mergeHeaders(base: HeadersInit | undefined): Headers {
  return new Headers(base ?? undefined);
}

export async function advisorFetch(input: RequestInfo | URL, init?: AdvisorFetchInit): Promise<Response> {
  const { onEmailSessionExpired, ...baseInit } = init ?? {};

  if (typeof window === "undefined") {
    const headers = mergeHeaders(baseInit.headers);
    return fetch(input, { ...baseInit, headers, credentials: "include" });
  }

  const headers = mergeHeaders(baseInit.headers);
  const accessBefore = sessionStorage.getItem(AP_SUPABASE_AT);
  if (accessBefore) headers.set("Authorization", `Bearer ${accessBefore}`);

  const doFetch = (h: Headers) =>
    fetch(input, {
      ...baseInit,
      headers: h,
      credentials: "include",
    });

  let res = await doFetch(headers);

  if (res.status !== 401 || !accessBefore) return res;

  const rt = sessionStorage.getItem(AP_SUPABASE_RT);
  if (!rt) {
    sessionStorage.removeItem(AP_SUPABASE_AT);
    onEmailSessionExpired?.();
    return res;
  }

  let refreshJson: { access_token?: string; refresh_token?: string } = {};
  try {
    const refreshRes = await fetch("/api/auth/email-refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    });
    refreshJson = refreshRes.ok ? await refreshRes.json().catch(() => ({})) : {};
    if (!refreshRes.ok || !refreshJson.access_token) {
      sessionStorage.removeItem(AP_SUPABASE_AT);
      sessionStorage.removeItem(AP_SUPABASE_RT);
      onEmailSessionExpired?.();
      return res;
    }
  } catch {
    sessionStorage.removeItem(AP_SUPABASE_AT);
    sessionStorage.removeItem(AP_SUPABASE_RT);
    onEmailSessionExpired?.();
    return res;
  }

  sessionStorage.setItem(AP_SUPABASE_AT, refreshJson.access_token);
  if (refreshJson.refresh_token) sessionStorage.setItem(AP_SUPABASE_RT, refreshJson.refresh_token);

  headers.set("Authorization", `Bearer ${refreshJson.access_token}`);
  res = await doFetch(headers);
  return res;
}
