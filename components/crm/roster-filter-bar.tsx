"use client";

/**
 * Roster filter bar — search input on top, stage chips + sort dropdown
 * below. State lives in the parent <RosterList /> so the chips reflect
 * the URL search params and clicking re-syncs the URL.
 *
 * Spec: docs/crm/20-technical-specs.md §5.2.
 */

import { Search } from "lucide-react";
import { CLIENT_STAGE_HEADER_SELECT_OPTIONS } from "@/lib/crm/stage";
import type { ClientStage } from "@/lib/crm/types";

export type RosterSort =
  | "review-due-asc"
  | "aum-desc"
  | "name-asc"
  | "last-contact-desc";

export type RosterFilters = {
  search: string;
  stage: ClientStage | null;
  sort: RosterSort;
};

const SORT_LABELS: Record<RosterSort, string> = {
  "review-due-asc": "Sort · Review due",
  "aum-desc": "Sort · AUM (high → low)",
  "name-asc": "Sort · Name (A → Z)",
  "last-contact-desc": "Sort · Recent contact",
};

export type RosterFilterBarProps = {
  filters: RosterFilters;
  onChange(next: RosterFilters): void;
  resultCount: number;
};

export function RosterFilterBar({
  filters,
  onChange,
  resultCount,
}: RosterFilterBarProps) {
  return (
    <div
      className="flex flex-col gap-2 px-3 py-3"
      style={{
        borderBottom: "1px solid var(--ap-border)",
        backgroundColor: "#FFFFFF",
      }}
    >
      <label className="relative flex items-center">
        <Search
          size={14}
          strokeWidth={1.75}
          className="pointer-events-none absolute left-2.5"
          style={{ color: "var(--ap-gray)" }}
        />
        <input
          type="search"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Search clients"
          className="w-full bg-white py-1.5 pl-7 pr-2 text-[12.5px] focus:outline-none"
          style={{
            border: "1px solid var(--ap-border)",
            color: "var(--ap-navy)",
          }}
        />
      </label>

      <div className="flex flex-wrap items-center gap-1.5">
        {CLIENT_STAGE_HEADER_SELECT_OPTIONS.map((stage) => {
          const active = filters.stage === stage;
          return (
            <button
              key={stage}
              type="button"
              onClick={() =>
                onChange({
                  ...filters,
                  stage: active ? null : stage,
                })
              }
              className="px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide transition-colors"
              style={{
                backgroundColor: active
                  ? "var(--ap-royal)"
                  : "rgba(12, 25, 41, 0.04)",
                color: active ? "#FFFFFF" : "var(--ap-gray)",
                border: `1px solid ${
                  active ? "var(--ap-royal)" : "var(--ap-border)"
                }`,
              }}
            >
              {stage}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[11px] font-medium uppercase tracking-wide"
          style={{ color: "var(--ap-gray)" }}
        >
          {resultCount} {resultCount === 1 ? "client" : "clients"}
        </span>
        <select
          value={filters.sort}
          onChange={(e) =>
            onChange({ ...filters, sort: e.target.value as RosterSort })
          }
          className="bg-white px-1.5 py-1 text-[11.5px] focus:outline-none"
          style={{
            border: "1px solid var(--ap-border)",
            color: "var(--ap-navy)",
          }}
        >
          {(Object.keys(SORT_LABELS) as RosterSort[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
