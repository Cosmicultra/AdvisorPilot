"use client";

/**
 * Task list filter bar — three rows of controls:
 *
 *   1. Status tabs (Active · Done · All · Cancelled) with live counts
 *   2. Due-date chips (Any · Today · This week · Overdue)
 *   3. Search + sort dropdown
 *
 * Pure — all values come from / go back through props. The hosting
 * component owns the filter state in a single TaskFilters object.
 *
 * Spec: docs/crm/20-technical-specs.md §7.1.
 */

import { Search, X } from "lucide-react";
import {
  forwardRef,
  type ForwardedRef,
  type Ref,
} from "react";
import type {
  TaskDueFilter,
  TaskFilterTab,
  TaskFilters,
  TaskSort,
  TaskTabCounts,
} from "@/lib/crm/task-list";

const DUE_OPTIONS: { id: TaskDueFilter; label: string }[] = [
  { id: "any", label: "Any due" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "overdue", label: "Overdue" },
];

const SORT_OPTIONS: { id: TaskSort; label: string }[] = [
  { id: "due_asc", label: "Due (soonest first)" },
  { id: "due_desc", label: "Due (latest first)" },
  { id: "priority", label: "Priority" },
  { id: "created_desc", label: "Recently created" },
  { id: "title_asc", label: "Title (A→Z)" },
];

export interface TaskFilterBarProps {
  filters: TaskFilters;
  counts: TaskTabCounts;
  onChange(next: Partial<TaskFilters>): void;
  searchInputRef?: Ref<HTMLInputElement>;
}

export const TaskFilterBar = forwardRef<HTMLDivElement, TaskFilterBarProps>(
  function TaskFilterBar(
    { filters, counts, onChange, searchInputRef },
    ref: ForwardedRef<HTMLDivElement>,
  ) {
    return (
      <div ref={ref} className="flex flex-col gap-2.5">
        <StatusTabs
          tab={filters.tab}
          counts={counts}
          onChange={(tab) => onChange({ tab })}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DueChips
            value={filters.due}
            onChange={(due) => onChange({ due })}
          />
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <SearchInput
              ref={searchInputRef}
              value={filters.search}
              onChange={(search) => onChange({ search })}
            />
            <SortSelect
              value={filters.sort}
              onChange={(sort) => onChange({ sort })}
            />
          </div>
        </div>
      </div>
    );
  },
);

// ─── Status tabs ──────────────────────────────────────────────────────────

function StatusTabs({
  tab,
  counts,
  onChange,
}: {
  tab: TaskFilterTab;
  counts: TaskTabCounts;
  onChange(next: TaskFilterTab): void;
}) {
  const items: { id: TaskFilterTab; label: string; count: number }[] = [
    { id: "active", label: "Active", count: counts.active },
    { id: "done", label: "Done", count: counts.done },
    { id: "all", label: "All", count: counts.all },
    { id: "cancelled", label: "Cancelled", count: counts.cancelled },
  ];
  return (
    <div
      role="tablist"
      aria-label="Task status"
      className="flex flex-wrap items-center gap-1"
      style={{ borderBottom: "1px solid var(--ap-border)" }}
    >
      {items.map((opt) => {
        const active = opt.id === tab;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors hover:text-[var(--ap-navy)]"
            style={{
              color: active ? "var(--ap-royal)" : "var(--ap-gray)",
              borderBottom: active
                ? "2px solid var(--ap-royal)"
                : "2px solid transparent",
              marginBottom: "-1px",
            }}
          >
            {opt.label}
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
              style={{
                backgroundColor: active
                  ? "var(--ap-royal)"
                  : "rgba(12, 25, 41, 0.06)",
                color: active ? "#FFFFFF" : "var(--ap-gray)",
              }}
            >
              {opt.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Due-date chips ───────────────────────────────────────────────────────

function DueChips({
  value,
  onChange,
}: {
  value: TaskDueFilter;
  onChange(next: TaskDueFilter): void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {DUE_OPTIONS.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={active}
            className="px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide transition-colors"
            style={{
              backgroundColor: active ? "var(--ap-navy)" : "rgba(12, 25, 41, 0.04)",
              color: active ? "#FFFFFF" : "var(--ap-gray)",
              border: `1px solid ${active ? "var(--ap-navy)" : "var(--ap-border)"}`,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Search ──────────────────────────────────────────────────────────────

const SearchInput = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange(next: string): void;
  }
>(function SearchInput({ value, onChange }, ref) {
  return (
    <label
      className="flex h-7 items-center gap-1.5 bg-white px-2"
      style={{ border: "1px solid var(--ap-border)" }}
    >
      <Search size={11} strokeWidth={1.75} style={{ color: "var(--ap-gray)" }} />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search tasks…"
        aria-label="Search tasks by title or description"
        className="w-44 bg-transparent text-[12px] outline-none placeholder:text-slate-400"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="text-slate-400 hover:text-slate-600"
        >
          <X size={11} strokeWidth={1.75} />
        </button>
      ) : null}
    </label>
  );
});

// ─── Sort dropdown ────────────────────────────────────────────────────────

function SortSelect({
  value,
  onChange,
}: {
  value: TaskSort;
  onChange(next: TaskSort): void;
}) {
  return (
    <label
      className="flex h-7 items-center bg-white px-2 text-[12px]"
      style={{ border: "1px solid var(--ap-border)", color: "var(--ap-navy)" }}
    >
      <span className="sr-only">Sort by</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TaskSort)}
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
