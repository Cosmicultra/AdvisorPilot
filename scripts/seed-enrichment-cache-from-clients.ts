/**
 * Seed advisorpilot_security_enrichment_cache from saved client holdings in Supabase.
 *
 * PowerShell: paste only the command line — do not paste npm banner lines or lines starting with '>'.
 *   npx --yes tsx scripts/seed-enrichment-cache-from-clients.ts --dry-run --email=you@firm.com,partner@firm.com
 *
 * Options:
 *   --dry-run              Print counts only; no Supabase writes.
 *   --email=a,b            Limit to these owner_email values (comma-separated).
 *   --all-advisors         Scan every row in advisorpilot_clients (use carefully).
 *   --include-unenriched   Also seed tickers from holdings that never ran AI enrichment (weaker data).
 *   --list-advisors        Print owner_email values that appear in advisorpilot_clients (then exit).
 *   --email-contains=x     Match owner_email ILIKE %x% (useful if domain spelling differs).
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SEED_CACHE_OWNER_EMAILS   Alternative to --email (comma-separated).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { collectSeedRowsFromHoldings, holdingHasSavedAiEnrichment } from "../lib/enrichment-cache-seed";
import { normalizeHoldingsForUi } from "../lib/saved-review-normalize";
import { isCashLikeHolding } from "../lib/asset-classes";

function loadEnvFiles() {
  for (const name of [".env.local", ".env"]) {
    const p = join(process.cwd(), name);
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      const eq = s.indexOf("=");
      if (eq <= 0) continue;
      const key = s.slice(0, eq).trim();
      let val = s.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
    break;
  }
}

function parseCsvEmails(raw: string): string[] {
  const parts = raw.split(/[,;]+/).map((e) => e.trim()).filter(Boolean);
  const variants: string[] = [];
  for (const p of parts) {
    variants.push(p);
    if (p !== p.toLowerCase()) variants.push(p.toLowerCase());
  }
  return [...new Set(variants)];
}

function parseArgEmails(argv: string[]): string[] {
  const out: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--email=")) {
      out.push(...parseCsvEmails(a.slice("--email=".length)));
    }
  }
  return [...new Set(out)];
}

function parseEmailContains(argv: string[]): string | null {
  const raw = argv.find((x) => x.startsWith("--email-contains="));
  if (!raw) return null;
  const v = raw.slice("--email-contains=".length).trim();
  return v || null;
}

/** Strip ILIKE wildcards so user input cannot broaden the pattern. */
function sanitizeEmailContainsForIlike(s: string): string {
  return s.replace(/\\/g, "").replace(/%/g, "").replace(/_/g, "").trim();
}

async function printAdvisorEmails(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.from("advisorpilot_clients").select("owner_email");
  if (error) {
    console.error("Could not list advisors:", error.message);
    process.exit(1);
  }
  const counts = new Map<string, number>();
  for (const row of data || []) {
    const em = String((row as { owner_email?: unknown }).owner_email || "").trim();
    if (!em) continue;
    counts.set(em, (counts.get(em) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`Distinct owner_email in advisorpilot_clients (${sorted.length}):\n`);
  for (const [email, n] of sorted) {
    console.log(`  ${n}\t${email}`);
  }
  if (sorted.length === 0) {
    console.log("(none — table empty or no owner_email set.)");
  }
}

async function main() {
  loadEnvFiles();

  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const allAdvisors = argv.includes("--all-advisors");
  const includeUnenriched = argv.includes("--include-unenriched");
  const listAdvisors = argv.includes("--list-advisors");
  const emailContainsRaw = parseEmailContains(argv);

  let emails = parseArgEmails(argv);
  if (emails.length === 0 && process.env.SEED_CACHE_OWNER_EMAILS?.trim()) {
    emails = parseCsvEmails(process.env.SEED_CACHE_OWNER_EMAILS);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  if (listAdvisors) {
    await printAdvisorEmails(supabase);
    return;
  }

  if (!allAdvisors && emails.length === 0 && !emailContainsRaw) {
    console.error(
      "Specify advisor emails: --email=you@x.com,partner@y.com\n" +
        "Or set SEED_CACHE_OWNER_EMAILS.\n" +
        "Or pass --all-advisors to scan every client row.\n" +
        "Or --email-contains=substring for a fuzzy match.\n" +
        "Or --list-advisors to print emails stored on client rows."
    );
    process.exit(1);
  }

  let rows: { id: unknown; owner_email: unknown; holdings: unknown }[] = [];

  if (emailContainsRaw) {
    const needle = sanitizeEmailContainsForIlike(emailContainsRaw);
    if (!needle) {
      console.error("--email-contains value is empty after sanitizing.");
      process.exit(1);
    }
    const { data, error } = await supabase
      .from("advisorpilot_clients")
      .select("id,owner_email,holdings")
      .ilike("owner_email", `%${needle}%`);
    if (error) {
      console.error("Supabase query failed:", error.message);
      process.exit(1);
    }
    rows = Array.isArray(data) ? data : [];
  } else if (!allAdvisors && emails.length > 0) {
    const seen = new Set<string>();
    for (const e of emails) {
      const variants = [...new Set([e, e.trim(), e.toLowerCase()])];
      for (const v of variants) {
        if (!v) continue;
        const { data, error } = await supabase
          .from("advisorpilot_clients")
          .select("id,owner_email,holdings")
          .eq("owner_email", v);
        if (error) {
          console.error("Supabase query failed:", error.message);
          process.exit(1);
        }
        for (const r of data || []) {
          const id = String((r as { id?: unknown }).id ?? "");
          if (!id || seen.has(id)) continue;
          seen.add(id);
          rows.push(r as { id: unknown; owner_email: unknown; holdings: unknown });
        }
      }
    }
  } else {
    const { data: clients, error } = await supabase
      .from("advisorpilot_clients")
      .select("id,owner_email,holdings");
    if (error) {
      console.error("Supabase query failed:", error.message);
      process.exit(1);
    }
    rows = Array.isArray(clients) ? clients : [];
  }

  if (
    rows.length === 0 &&
    !allAdvisors &&
    emails.length > 0 &&
    !emailContainsRaw &&
    !dryRun
  ) {
    console.error(
      "\nNo advisorpilot_clients rows matched owner_email for:\n  " +
        emails.join("\n  ") +
        "\n\nTypos are common (e.g. wealth vs welath). Try:\n" +
        "  npm run seed:enrichment-cache -- --list-advisors\n" +
        "  npm run seed:enrichment-cache -- --dry-run --email-contains=assured\n"
    );
    process.exit(2);
  }

  if (rows.length === 0 && emails.length > 0 && !emailContainsRaw && dryRun) {
    console.warn(
      "\nWarning: 0 clients matched. Check spelling of owner_email vs Supabase.\n" +
        "  npm run seed:enrichment-cache -- --list-advisors\n" +
        "  npm run seed:enrichment-cache -- --dry-run --email-contains=chris\n"
    );
  }
  const allHoldings = rows.flatMap((r) => normalizeHoldingsForUi(r?.holdings));

  const seeds = collectSeedRowsFromHoldings(allHoldings, { includeUnenriched });

  console.log(`Clients scanned: ${rows.length}`);
  console.log(`Holdings rows loaded: ${allHoldings.length}`);
  console.log(`Unique cache keys to upsert: ${seeds.length}`);
  console.log(`Include unenriched: ${includeUnenriched}`);

  if (allHoldings.length > 0 && seeds.length === 0 && !includeUnenriched) {
    const withAi = allHoldings.filter((h) => holdingHasSavedAiEnrichment(h)).length;
    const cashLike = allHoldings.filter((h) =>
      isCashLikeHolding(h.assetClass, h.suggested, h.rawName)
    ).length;
    console.warn(
      `\nNo cache rows to upsert: default mode only uses holdings that already ran AI verification.\n` +
        `Your data: ${withAi}/${allHoldings.length} lines have enrichment saved (${cashLike} cash-like skipped).\n` +
        `Re-run with --include-unenriched to seed ticker + asset class from every non-cash line:\n` +
        `  npm run seed:enrichment-cache -- --dry-run --email=YOUR_EMAIL --include-unenriched\n`
    );
  }

  if (dryRun) {
    const sample = seeds.slice(0, 15).map((s) => `${s.lookup_key} → ${s.payload.enrichmentMappedAssetClass}`);
    console.log("Sample:\n", sample.join("\n "));
    return;
  }

  const batchSize = 40;
  for (let i = 0; i < seeds.length; i += batchSize) {
    const batch = seeds.slice(i, i + batchSize).map((s) => ({
      lookup_key: s.lookup_key,
      payload: s.payload,
      updated_at: new Date().toISOString(),
    }));

    const { error: upErr } = await supabase
      .from("advisorpilot_security_enrichment_cache")
      .upsert(batch, { onConflict: "lookup_key" });

    if (upErr) {
      console.error("Upsert failed:", upErr.message);
      process.exit(1);
    }
    console.log(`Upserted ${Math.min(i + batchSize, seeds.length)} / ${seeds.length}`);
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
