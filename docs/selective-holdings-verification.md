# Selective holdings verification (plan + implementation notes)

Review doc: cost context, agreed approach, **Confirm Holdings** button behavior, API shape, and a before/after cost model.  
Related Cursor plan: `selective_enrichment_+_cost_model` (internal).

---

## 1. Why OpenAI spend spiked

From your **Usage → Spend categories** snapshot:

- **Web search tool calls** were the largest line item (on the order of **~$5+ on the busy day** in that view), ahead of **gpt-4o** input/output.
- In this codebase, **web search** is attached to:
  - **Per-holding enrichment**  -  `[lib/holding-enrichment.ts](../lib/holding-enrichment.ts)`: each non–cash-like row processed runs `**responses.create` with `web_search_preview`**, then a second `**gpt-4o**` JSON pass.
  - **Portfolio analysis**  -  `[app/api/generate-analysis/route.ts](../app/api/generate-analysis/route.ts)`: **one** research pass with `**web_search_preview`**, then one large JSON pass.

Statement extraction  -  `[lib/extract-statement-holdings.ts](../lib/extract-statement-holdings.ts)`  -  uses **multimodal `gpt-4o`** per file (separate from web search, still real cost).

**Today:** after **Extract holdings**, `[app/page.tsx](../app/page.tsx)` automatically calls `**runHoldingsVerification`** → `**POST /api/enrich-holdings**` with **every** row, so cost scales ~**linearly with position count**.

---

## 2. Product nuance (current gating)

In `[app/page.tsx](../app/page.tsx)`, `enrichmentSatisfied` requires each non–cash row to have completed enrichment without `enrichmentNeedsReview`.

However, `**canRunDeepAnalysis`** includes `(reviewCount === 0 || enrichmentSatisfied)`. When `**reviewCount === 0**`, the first part of that OR is **true**, so **enrichment does not actually block** deep analysis for the common case where every line is ≥75 confidence and not `review`. That means automatic full enrichment has often been **extra spend** while the UI copy still sounds like universal verification.

**Goal:** Make enrichment **explicit**, **scoped to uncertain rows**, and align **copy** with behavior.

---

## 3. Plan summary


| Area         | Change                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Triggers** | Remove auto `**runHoldingsVerification`** after extract; remove auto run when reopening a draft that “needs enrichment”.                                |
| **Scope**    | Only send holdings that **need advisor-side AI help** (see eligibility below); skip **cash-like** rows (same as server today).                          |
| **API**      | Extend `**POST /api/enrich-holdings`** to accept **which indices** to enrich; return **patches by index** so the client can merge without reorder bugs. |
| **UI**       | Add a **Confirm Holdings** action: **“Verify uncertain holdings (AI)”** with count, loading state, errors.                                              |
| **Copy**     | Stop implying every non-cash line always runs; describe optional verification for **low confidence / review / flagged** rows.                           |


---

## 4. Implementation: eligibility filter

**Include** a row in the batch sent to enrichment when **all** are true:

1. **Not** cash-like  -  use existing `[isCashLikeHolding](../lib/asset-classes.ts)` (same idea as server skip in `enrichOneHolding`).
2. At least one of:
  - `**confidence < 75`** OR `**status === "review"**` (matches existing `**reviewCount**` logic in `page.tsx`), and/or  
  - `**enrichmentNeedsReview === true**` (recommended so a prior flagged enrich can be retried without forcing low confidence).

**Result:** `R` = count of included rows; historically enrichment processed `**N¬c`** ≈ non–cash-like count  -  **cost ratio ≈ `R / N¬c`** on the enrichment step.

---

## 5. Implementation: API contract (proposed)

**Request** (JSON):

```json
{
  "holdings": [ /* full current row objects, unchanged */ ],
  "enrichIndices": [3, 7, 12]
}
```

- `**enrichIndices**`: optional. If **omitted**, preserve **legacy behavior**: enrich **all** rows in `holdings` (safety for any stray callers; can remove later).
- Server reads `**holdings[i]`** for each `i` in `enrichIndices` in order.

**Response** (recommended shape):

```json
{
  "patches": [
    { "index": 3, "holding": { /* merged/enriched row */ } },
    { "index": 7, "holding": { } }
  ]
}
```

Client: `setHoldings(prev => prev.map((h, i) => patchByIndex.get(i) ?? h))` (with defensive copy/validation).

**File:** `[app/api/enrich-holdings/route.ts](../app/api/enrich-holdings/route.ts)`  
**Core logic:** still `[enrichOneHolding](../lib/holding-enrichment.ts)`  -  no structural change required beyond **fewer invocations**.

---

## 6. Implementation: client behavior

**File:** `[app/page.tsx](../app/page.tsx)`

1. `**handleExtractHoldings`:** remove `void runHoldingsVerification(cleaned)` at end of successful extract.
2. `**openSavedReview`:** remove automatic `runHoldingsVerification(loaded)` for drafts; optional subtle callout if some rows are still eligible (same button).
3. **New helper:** e.g. `getEligibleEnrichmentIndices(holdings: Holding[]): number[]`.
4. **Refactor** `runHoldingsVerification`:
  - Either replace with `**runHoldingsVerificationForIndices(indices: number[])`**, or overload the same function.
  - POST body includes `**enrichIndices**`; apply `**patches**` to state.
5. **Abort / errors:** keep existing `**AbortController`** / `enrichError` patterns.

---

## 7. Implementation: Confirm Holdings button (UX spec)

**Placement:** Confirm Holdings step (`step === "confirm"`), near the existing verification / OpenFIGI explainer block (~lines 3137+ in `page.tsx`).

**Label (primary suggestion):**  
`Verify uncertain holdings (AI)`  

**Secondary line (dynamic):**  
`N positions need AI verification` or `No uncertain positions  -  manual review only` when `N = 0`.

**States:**


| State       | Behavior                                                                              |
| ----------- | ------------------------------------------------------------------------------------- |
| **Default** | Enabled if `eligibleIndices.length > 0`; disabled + short explanation if 0.           |
| **Loading** | Disable button; show “Verifying…” (reuse `isEnriching`).                              |
| **Success** | Merge patches; clear or show brief success; `duplicatesAcknowledged` logic unchanged. |
| **Error**   | Show `enrichError`; allow retry.                                                      |


**Optional:** If you want **advisor control**, add a checkbox “Include high-confidence rows” later  -  **out of scope** for the minimal cost fix.

---

## 8. Cost model (before vs after)

Per **one** end-to-end run: **upload → confirm → one deep analysis** (ignore voice intake, ignore extra regenerations).


| Symbol          | Meaning                                                       |
| --------------- | ------------------------------------------------------------- |
| `F`             | Number of statement files uploaded                            |
| `C_extract`     | Cost of one multimodal extract per file                       |
| `N¬c`           | Rows that *would* have been enriched before (≈ non–cash-like) |
| `C_enrich_line` | Cost of **one** holding’s enrich (web search + JSON `gpt-4o`) |
| `R`             | Rows actually enriched after the change (`R ≤ N¬c`)           |
| `C_analyze`     | One analysis run (web search + large JSON)                    |


**Before (auto enrich all non-cash processing):**

```text
C_before ≈ F × C_extract + N¬c × C_enrich_line + C_analyze
```

**After (button, only `R` uncertain rows):**

```text
C_after ≈ F × C_extract + R × C_enrich_line + C_analyze
```

**Enrichment spend ratio:** `R / N¬c`

**Examples:**

- `N¬c = 28`, `R = 5` → enrichment calls **~82%** lower than before on that step.
- User never clicks verify → `R = 0` → **no enrichment API cost** (extract + analyze still apply).

**Tie to your dashboard:** Web search fees scale roughly with **number of web-search tool invocations**; enrichment used to add **~one search per processed non-cash line** plus analysis’s **one** search. Cutting `R` cuts the **largest** bucket first.

---

## 9. Accuracy note (short)

Rows **not** sent to enrichment keep **extraction output** as-is. Residual risk is concentrated in **ambiguous** lines  -  which stay in the eligible set via **low confidence**, `**review`**, or `**enrichmentNeedsReview**`.

---

## 10. Implementation checklist

- `[app/api/enrich-holdings/route.ts](../app/api/enrich-holdings/route.ts)`: `enrichIndices` + `patches` response; legacy path if omitted.
- `[app/page.tsx](../app/page.tsx)`: remove auto verification after extract and on draft open; add eligibility helper + merge.
- Confirm step: **Verify uncertain holdings (AI)** button + updated copy.
- Re-check `**demoMode`** + `enrichmentSatisfied` messaging so demo vs production still make sense.
- Manual smoke: extract → optional verify → analysis; save draft → reopen → no surprise full enrich.

---

## 11. Files touched (expected)


| File                                                                      | Role                               |
| ------------------------------------------------------------------------- | ---------------------------------- |
| `[app/api/enrich-holdings/route.ts](../app/api/enrich-holdings/route.ts)` | Selective indices + patch response |
| `[app/page.tsx](../app/page.tsx)`                                         | Triggers, merge, button, copy      |
| `[lib/holding-enrichment.ts](../lib/holding-enrichment.ts)`               | Unchanged (called less often)      |


No new dependencies required for the minimal version.