"use client";

/**
 * Filter chips + search + sort for the reports list. Stateless — owns
 * none of its values; the parent (`<ReportsContent />`) holds the filter
 * state and re-fetches on change.
 *
 * Two chips groups:
 *   - Status: Draft / Published / All / Archived
 *   - Source: All / AI / You wrote / Imported
 *
 * Search is a debounced text input over the title. Sort is a small select.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a.
 */

import { Search } from "lucide-react";
import type { ReportSource, ReportStatus } from "@/lib/crm/types";

export type StatusFilter = ReportStatus | "all" | "active";
export type SourceFilter = "all" | ReportSource;
export type SortKey = "created_desc" | "created_asc" | "title_asc" | "updated_desc";

export interface ReportFilterBarProps {
  status: StatusFilter;
  source: SourceFilter;
  sort: SortKey;
  search: string;
  resultCount: number;
  onStatusChange(next: StatusFilter): void;
  onSourceChange(next: SourceFilter): void;
  onSortChange(next: SortKey): void;
  onSearchChange(next: string): void;
}

const STATUS_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "draft", label: "Draft" },
  { id: "published", label: "Published" },
  { id: "archived", label: "Archived" },
  { id: "all", label: "All" },
];

const SOURCE_OPTIONS: { id: SourceFilter; label: string }[] = [
  { id: "all", label: "Any source" },
  { id: "ai_generated", label: "AI" },
  { id: "advisor_authored", label: "You wrote" },
  { id: "imported", label: "Imported" },
];

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "created_desc", label: "Newest first" },
  { id: "created_asc", label: "Oldest first" },
  { id: "updated_desc", label: "Recently updated" },
  { id: "title_asc", label: "Title (A→Z)" },
];

export function ReportFilterBar({
  status,
  source,
  sort,
  search,
  resultCount,
  onStatusChange,
  onSourceChange,
  onSortChange,
  onSearchChange,
}: ReportFilterBarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ChipGroup
          options={STATUS_OPTIONS}
          value={status}
          onChange={onStatusChange}
        />
        <span
          className="text-[11px] uppercase tracking-wide"
          style={{ color: "var(--ap-gray)" }}
        >
          {resultCount} {resultCount === 1 ? "report" : "reports"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ChipGroup
          options={SOURCE_OPTIONS}
          value={source}
          onChange={onSourceChange}
          variant="muted"
        />
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <SearchInput value={search} onChange={onSearchChange} />
          <SortSelect value={sort} onChange={onSortChange} />
        </div>
      </div>
    </div>
  );
}

function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  variant = "default",
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange(next: T): void;
  variant?: "default" | "muted";
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((option) => {
        const active = option.id === value;
        const activeBg = variant === "muted" ? "var(--ap-navy)" : "var(--ap-royal)";
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={active}
            className="px-2.5 py-1 text-[11.5px] font-medium uppercase tracking-wide transition-colors"
            style={{
              backgroundColor: active ? activeBg : "rgba(12, 25, 41, 0.04)",
              color: active ? "#FFFFFF" : "var(--ap-gray)",
              border: `1px solid ${active ? activeBg : "var(--ap-border)"}`,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange(next: string): void;
}) {
  return (
    <label
      className="flex h-7 items-center gap-1.5 bg-white px-2"
      style={{ border: "1px solid var(--ap-border)" }}
    >
      <Search size={12} strokeWidth={1.75} style={{ color: "var(--ap-gray)" }} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search titles…"
        aria-label="Search reports by title"
        className="w-44 bg-transparent text-[12px] outline-none placeholder:text-slate-400"
      />
    </label>
  );
}

function SortSelect({
  value,
  onChange,
}: {
  value: SortKey;
  onChange(next: SortKey): void;
}) {
  return (
    <label
      className="flex h-7 items-center bg-white px-2 text-[12px]"
      style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
    >
      <span className="sr-only">Sort by</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
        className="bg-transparent outline-none"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Translate the UI's filter state into URL query params for /api/reports.
 *
 *   - `active` (default) → no `status` param (server default = draft + published, hides archived)
 *   - `all` → `status=all`
 *   - anything else → `status=<value>`
 *
 * Exported so the consumer can build a stable URL without duplicating the mapping.
 */
export function reportFiltersToQuery({
  status,
  source,
  sort,
  search,
}: {
  status: StatusFilter;
  source: SourceFilter;
  sort: SortKey;
  search: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (status !== "active") params.set("status", status);
  if (source !== "all") params.set("source", source);
  if (sort !== "created_desc") params.set("sort", sort);
  if (search.trim()) params.set("search", search.trim());
  return params;
}
