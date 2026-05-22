export function gmailSendNeedsGoogleReconnect(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const o = err as Record<string, unknown>;
  const response = o.response as
    | { status?: number; data?: { error?: string; error_description?: string } }
    | undefined;
  const status = response?.status;
  if (status === 401 || status === 403) return true;
  const dataErr = String(response?.data?.error || "");
  const dataDesc = String(response?.data?.error_description || "");
  if (/invalid_grant|unauthorized_client|invalid_token|insufficient/i.test(dataErr + dataDesc)) {
    return true;
  }
  const msg = String(o.message || err);
  if (
    /invalid_grant|invalid[_ ]token|Token has been expired|token expired|Invalid Credentials|UNAUTHENTICATED|Insufficient Permission|insufficient authentication scopes|no access token|401|403/i.test(
      msg
    )
  ) {
    return true;
  }
  const errCode = o.code;
  if (errCode === 401 || errCode === "401" || errCode === 403 || errCode === "403") {
    return true;
  }
  return false;
}
