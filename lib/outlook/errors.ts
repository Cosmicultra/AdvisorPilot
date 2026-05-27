export function outlookSendNeedsReconnect(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const o = err as Record<string, unknown>;
  const status = typeof o.status === "number" ? o.status : undefined;
  if (status === 401 || status === 403) return true;

  const msg = String(o.message || err);
  if (
    /invalid_grant|invalid[_ ]token|token expired|InvalidAuthenticationToken|interaction_required|Unauthorized|401|403|insufficient/i.test(
      msg
    )
  ) {
    return true;
  }

  const body = o.body;
  if (body && typeof body === "object") {
    const error = (body as { error?: { code?: string; message?: string } }).error;
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    if (/InvalidAuthenticationToken|interaction_required|Authorization_RequestDenied/i.test(code + message)) {
      return true;
    }
  }

  return false;
}
