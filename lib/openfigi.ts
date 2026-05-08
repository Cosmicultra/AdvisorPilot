export type OpenFigiMappingSuccess = {
  figi: string;
  name?: string;
  ticker?: string;
  securityType?: string;
  securityDescription?: string;
  exchangeCode?: string;
};

export type OpenFigiMappingResult = OpenFigiMappingSuccess & {
  skipped?: boolean;
  reason?: string;
};

type FigiApiRow = {
  figi?: string;
  name?: string;
  ticker?: string;
  securityType?: string;
  securityDescription?: string;
  exchCode?: string;
};

const OPENFIGI_URL = "https://api.openfigi.com/v3/mapping";

function firstHit(rows: FigiApiRow[] | undefined): FigiApiRow | undefined {
  return rows?.find((r) => r.figi);
}

async function postMapping(
  jobs: Record<string, string>[],
  apiKey: string | undefined
): Promise<{ ok: true; rows: FigiApiRow[] } | { ok: false; reason: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["X-OPENFIGI-APIKEY"] = apiKey;

  const res = await fetch(OPENFIGI_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(jobs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, reason: `OpenFIGI HTTP ${res.status}: ${text.slice(0, 200)}` };
  }

  const parsed: unknown = await res.json();
  if (!Array.isArray(parsed)) {
    return { ok: false, reason: "openfigi unexpected response" };
  }

  const merged: FigiApiRow[] = [];
  for (const item of parsed) {
    const slot = item as { data?: FigiApiRow[]; warning?: string };
    const hit = firstHit(slot.data);
    if (hit) merged.push(hit);
  }

  return { ok: true, rows: merged };
}

/**
 * Resolve a CUSIP or US ticker via OpenFIGI (free tier; optional API key for rate limits).
 */
export async function mapHoldingToOpenFigi(params: {
  cusip: string;
  ticker: string;
  apiKey?: string;
}): Promise<OpenFigiMappingResult> {
  const cusip = String(params.cusip || "").trim().toUpperCase();
  const ticker = String(params.ticker || "").trim().toUpperCase();
  const apiKey = params.apiKey;

  if (!cusip && !ticker) {
    return { figi: "", skipped: true, reason: "no_cusip_or_ticker" };
  }

  const jobs: Record<string, string>[] = [];
  if (/^[0-9A-Z]{9}$/.test(cusip)) {
    jobs.push({ idType: "ID_CUSIP", idValue: cusip });
  } else if (cusip && /^[A-Z]{1,6}$/.test(cusip)) {
    jobs.push({ idType: "TICKER", idValue: cusip, exchCode: "US" });
  }

  if (ticker && /^[A-Z0-9]{1,6}$/.test(ticker)) {
    const dup = jobs.some((j) => j.idValue === ticker);
    if (!dup) jobs.push({ idType: "TICKER", idValue: ticker, exchCode: "US" });
  }

  if (jobs.length === 0) {
    return { figi: "", skipped: true, reason: "no_mappable_id" };
  }

  const body = await postMapping(jobs, apiKey);
  if (!body.ok) {
    return { figi: "", skipped: true, reason: body.reason };
  }

  const firstRow = body.rows[0];
  if (!firstRow?.figi) {
    return { figi: "", skipped: true, reason: "no_figi_match" };
  }

  return {
    figi: firstRow.figi,
    name: firstRow.name,
    ticker: firstRow.ticker,
    securityType: firstRow.securityType,
    securityDescription: firstRow.securityDescription,
    exchangeCode: firstRow.exchCode,
  };
}
