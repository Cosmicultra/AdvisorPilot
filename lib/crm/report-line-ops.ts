/**
 * Pure helpers for line-level report edits.
 *
 * The `manage_report` tool's line-level operations (`get_lines`,
 * `insert_lines`, `replace_lines`, `delete_lines`) live in
 * `lib/llm/chat/tools/manage-report.ts`. The string manipulation +
 * range validation logic is extracted here so it's unit-testable
 * without the DB / visibility-gate layer.
 *
 * Line numbering convention: 1-indexed (matches editor / chat UX).
 * Range semantics: inclusive on both ends — `startLine=3, endLine=5`
 * selects lines 3, 4, AND 5 (3 rows total).
 *
 * Newline normalization: we split + rejoin with `\n`. CR / CRLF input
 * is normalized to LF as a side effect — that's fine for markdown
 * (every renderer handles LF natively).
 *
 * Spec: docs/crm/70-orchestrator-tools.md §7.1 (line-level operations).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Max total content size after a write op (matches the column cap). */
export const MAX_CONTENT_LENGTH = 200_000;

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split content into a 1-indexed line array. Index 0 is unused so
 * `lines[startLine]` reads the correct row without arithmetic.
 *
 * `\r\n` and `\r` are normalized to `\n` first so the line index matches
 * what the model + advisor see.
 */
export function splitLines(content: string): string[] {
  const normalized = content.replace(/\r\n?/g, "\n");
  // Sentinel at index 0 so callers can use 1-indexed slicing.
  const out = ["\0SENTINEL\0"];
  out.push(...normalized.split("\n"));
  return out;
}

/** Rejoin lines back into a single content string (sentinel-aware). */
export function joinLines(lines1Indexed: string[]): string {
  return lines1Indexed.slice(1).join("\n");
}

/**
 * Numbered slice for `get_lines`. Returns one record per line with the
 * 1-indexed line number AND the raw text. Suitable for the model to
 * read + reason about ("the typo is on line 14").
 */
export interface NumberedLine {
  line: number;
  text: string;
}

export function getLines(
  content: string,
  startLine?: number,
  endLine?: number,
): NumberedLine[] {
  const lines = splitLines(content);
  const totalLines = lines.length - 1;
  const start = clamp(startLine ?? 1, 1, Math.max(1, totalLines));
  const end = clamp(endLine ?? totalLines, start, totalLines);
  const out: NumberedLine[] = [];
  for (let i = start; i <= end; i += 1) {
    out.push({ line: i, text: lines[i] ?? "" });
  }
  return out;
}

/**
 * Insert `newContent` (which may itself contain multiple lines) BEFORE
 * the existing `atLine`. After the insert the original line previously
 * at `atLine` is at `atLine + (number of inserted lines)`.
 *
 * Special case: `atLine` = N + 1 (where N is current line count) appends
 * to the end. Anything beyond is rejected with `outOfRange`.
 */
export interface InsertResult {
  ok: true;
  /** The full updated content. */
  content: string;
  /** Line index of the first inserted line in the NEW content. */
  insertedAtLine: number;
  /** How many lines `newContent` contributed. */
  insertedLineCount: number;
}

export interface RangeError {
  ok: false;
  error: string;
}

export function insertLines(
  content: string,
  atLine: number,
  newContent: string,
): InsertResult | RangeError {
  const lines = splitLines(content);
  const totalLines = lines.length - 1;
  if (!Number.isInteger(atLine) || atLine < 1) {
    return { ok: false, error: "`atLine` must be an integer ≥ 1." };
  }
  if (atLine > totalLines + 1) {
    return {
      ok: false,
      error: `\`atLine\` ${atLine} is beyond the end of the document (last line is ${totalLines}, append at ${totalLines + 1}).`,
    };
  }
  const newLines = newContent.replace(/\r\n?/g, "\n").split("\n");
  const before = lines.slice(1, atLine); // [1..atLine-1]
  const after = lines.slice(atLine); // [atLine..end]
  const joined = [...before, ...newLines, ...after].join("\n");
  if (joined.length > MAX_CONTENT_LENGTH) {
    return {
      ok: false,
      error: `Insert would exceed the ${MAX_CONTENT_LENGTH.toLocaleString()}-char cap (${joined.length.toLocaleString()} chars).`,
    };
  }
  return {
    ok: true,
    content: joined,
    insertedAtLine: atLine,
    insertedLineCount: newLines.length,
  };
}

/**
 * Replace the inclusive range `[startLine..endLine]` with `newContent`.
 * If `newContent` contains fewer/more lines than the original range,
 * subsequent line numbers shift accordingly.
 */
export interface ReplaceResult {
  ok: true;
  content: string;
  removedLineCount: number;
  insertedLineCount: number;
}

export function replaceLines(
  content: string,
  startLine: number,
  endLine: number,
  newContent: string,
): ReplaceResult | RangeError {
  const v = validateRange(content, startLine, endLine);
  if (!v.ok) return v;

  const newLines = newContent.replace(/\r\n?/g, "\n").split("\n");
  const before = v.lines.slice(1, startLine);
  const after = v.lines.slice(endLine + 1);
  const joined = [...before, ...newLines, ...after].join("\n");

  if (joined.length > MAX_CONTENT_LENGTH) {
    return {
      ok: false,
      error: `Replace would exceed the ${MAX_CONTENT_LENGTH.toLocaleString()}-char cap (${joined.length.toLocaleString()} chars).`,
    };
  }
  return {
    ok: true,
    content: joined,
    removedLineCount: endLine - startLine + 1,
    insertedLineCount: newLines.length,
  };
}

/** Delete the inclusive range `[startLine..endLine]`. */
export interface DeleteResult {
  ok: true;
  content: string;
  removedLineCount: number;
}

export function deleteLines(
  content: string,
  startLine: number,
  endLine: number,
): DeleteResult | RangeError {
  const v = validateRange(content, startLine, endLine);
  if (!v.ok) return v;
  const before = v.lines.slice(1, startLine);
  const after = v.lines.slice(endLine + 1);
  return {
    ok: true,
    content: [...before, ...after].join("\n"),
    removedLineCount: endLine - startLine + 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

interface ValidatedRange {
  ok: true;
  lines: string[];
}

function validateRange(
  content: string,
  startLine: number,
  endLine: number,
): ValidatedRange | RangeError {
  const lines = splitLines(content);
  const totalLines = lines.length - 1;
  if (!Number.isInteger(startLine) || startLine < 1) {
    return { ok: false, error: "`startLine` must be an integer ≥ 1." };
  }
  if (!Number.isInteger(endLine) || endLine < startLine) {
    return { ok: false, error: "`endLine` must be an integer ≥ `startLine`." };
  }
  if (startLine > totalLines || endLine > totalLines) {
    return {
      ok: false,
      error: `Range [${startLine}..${endLine}] is out of bounds (document has ${totalLines} lines).`,
    };
  }
  return { ok: true, lines };
}
