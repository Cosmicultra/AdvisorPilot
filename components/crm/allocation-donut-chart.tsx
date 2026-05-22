"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DonutSleeveSlice, InteractiveAllocationSleeve } from "@/lib/allocation-display";
import { buildDonutSegmentPaths } from "@/lib/donut-segment-path";

export type { AllocationDonutSegment } from "@/lib/allocation-display";

const CX = 95;
const CY = 95;
const RADIUS = 72;
const STROKE = 22;

/** Reserved below subtitle so current + proposed cards stay the same height. */
const DONUT_FOOTER_MIN_H = "min-h-[148px]";
const DONUT_SUBTITLE_MIN_H = "min-h-[2.5rem]";

type DonutSvgProps = {
  sleeves: DonutSleeveSlice[];
  interactive?: boolean;
  activeSleeveKey?: string | null;
  onSegmentClick?: (sleeveKey: string) => void;
  ariaLabel: string;
};

function AllocationDonutSvg({
  sleeves,
  interactive = false,
  activeSleeveKey,
  onSegmentClick,
  ariaLabel,
}: DonutSvgProps) {
  const segmentPaths = useMemo(
    () => buildDonutSegmentPaths(CX, CY, RADIUS, STROKE, sleeves.map((s) => s.value)),
    [sleeves]
  );

  return (
    <svg
      width="190"
      height="190"
      viewBox="0 0 190 190"
      className="shrink-0"
      role="img"
      aria-label={ariaLabel}
    >
      <circle cx={CX} cy={CY} r={RADIUS} fill="transparent" stroke="#e5e7eb" strokeWidth={STROKE} />
      {sleeves.map((item, index) => {
        const path = segmentPaths[index];
        if (!path?.d) return null;
        const isActive = activeSleeveKey === item.sleeveKey;
        const dimmed = Boolean(activeSleeveKey && !isActive);
        return (
          <path
            key={item.sleeveKey}
            d={path.d}
            fill={item.color}
            stroke="#ffffff"
            strokeWidth={isActive ? 2 : 1}
            className={interactive ? "cursor-pointer transition-opacity" : undefined}
            style={{ opacity: dimmed ? 0.45 : 1 }}
            onClick={
              interactive && onSegmentClick
                ? () => onSegmentClick(item.sleeveKey)
                : undefined
            }
            aria-label={interactive ? `${item.label} allocation segment` : undefined}
            role={interactive ? "button" : undefined}
          />
        );
      })}
      <circle cx={CX} cy={CY} r="45" fill="#ffffff" className="pointer-events-none" />
      <text
        x={CX}
        y={CY - 7}
        textAnchor="middle"
        className="pointer-events-none fill-slate-500 text-xs font-medium"
      >
        Total
      </text>
      <text
        x={CX}
        y={CY + 15}
        textAnchor="middle"
        className="pointer-events-none fill-slate-950 text-xl font-bold"
      >
        100%
      </text>
    </svg>
  );
}

export type AllocationDonutChartProps = {
  sleeves: InteractiveAllocationSleeve[];
  subtitle?: string;
  activeSleeveKey?: string | null;
  onSleeveSelect?: (sleeveKey: string | null) => void;
};

/** Interactive current-allocation donut with account breakdown popup. */
export function AllocationDonutChart({
  sleeves,
  subtitle,
  activeSleeveKey: activeSleeveKeyProp,
  onSleeveSelect,
}: AllocationDonutChartProps) {
  const [activeSleeveKeyInternal, setActiveSleeveKeyInternal] = useState<string | null>(null);
  const activeSleeveKey = activeSleeveKeyProp ?? activeSleeveKeyInternal;
  const setActiveSleeveKey = onSleeveSelect ?? setActiveSleeveKeyInternal;
  const chartRef = useRef<HTMLDivElement>(null);

  const totalPct = sleeves.reduce((sum, item) => sum + item.value, 0);
  const activeSleeve = sleeves.find((s) => s.sleeveKey === activeSleeveKey) ?? null;

  const closePopup = useCallback(() => setActiveSleeveKey(null), [setActiveSleeveKey]);

  useEffect(() => {
    if (!activeSleeveKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePopup();
    };
    const onPointerDown = (e: MouseEvent) => {
      if (chartRef.current && !chartRef.current.contains(e.target as Node)) {
        closePopup();
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [activeSleeveKey, closePopup]);

  if (sleeves.length === 0 || totalPct <= 0) {
    return (
      <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
        No holdings to chart yet.
      </p>
    );
  }

  return (
    <motion.div
      ref={chartRef}
      className="relative flex w-full flex-col items-center gap-3"
    >
      <AllocationDonutSvg
        sleeves={sleeves}
        interactive
        activeSleeveKey={activeSleeveKey}
        onSegmentClick={(key) => setActiveSleeveKey(activeSleeveKey === key ? null : key)}
        ariaLabel="Current allocation donut chart. Click a segment for account detail."
      />
      <p
        className={`text-center text-[12px] leading-snug ${DONUT_SUBTITLE_MIN_H}`}
        style={{ color: "var(--ap-gray)" }}
      >
        {subtitle ?? "\u00A0"}
      </p>
      <motion.div
        className={`flex w-full max-w-[280px] flex-col items-center justify-start ${DONUT_FOOTER_MIN_H}`}
      >
        {activeSleeve ? (
          <SleeveBreakdownPopup sleeve={activeSleeve} onClose={closePopup} />
        ) : (
          <p className="text-center text-[11px]" style={{ color: "var(--ap-gray)" }}>
            Click a segment to see accounts in that sleeve
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}

export type StaticAllocationDonutChartProps = {
  sleeves: DonutSleeveSlice[];
  subtitle?: string;
};

/** Static proposed-allocation donut (Analysis calibration mix). */
export function StaticAllocationDonutChart({ sleeves, subtitle }: StaticAllocationDonutChartProps) {
  const totalPct = sleeves.reduce((sum, item) => sum + item.value, 0);
  if (sleeves.length === 0 || totalPct <= 0) {
    return (
      <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
        Proposed mix unavailable.
      </p>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <AllocationDonutSvg
        sleeves={sleeves}
        ariaLabel="Proposed allocation donut chart"
      />
      <p
        className={`text-center text-[12px] leading-snug ${DONUT_SUBTITLE_MIN_H}`}
        style={{ color: "var(--ap-gray)" }}
      >
        {subtitle ?? "\u00A0"}
      </p>
      <div className={`w-full ${DONUT_FOOTER_MIN_H}`} aria-hidden />
    </div>
  );
}

function SleeveBreakdownPopup({
  sleeve,
  onClose,
}: {
  sleeve: InteractiveAllocationSleeve;
  onClose: () => void;
}) {
  return (
    <div
      className="w-full max-w-[280px]"
      style={{
        backgroundColor: "#FFFFFF",
        border: `2px solid ${sleeve.color}`,
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
      }}
      role="dialog"
      aria-label={`${sleeve.label} accounts`}
    >
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="flex items-center justify-between gap-2 px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--ap-border)", backgroundColor: "#f8fafc" }}
      >
        <h4
          className="font-display text-[14px] font-semibold"
          style={{ color: "var(--ap-navy)" }}
        >
          {sleeve.label}
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] font-medium underline-offset-2 hover:underline"
          style={{ color: "var(--ap-gray)" }}
        >
          Close
        </button>
      </motion.div>
      <ul className="max-h-48 overflow-y-auto px-4 py-3">
        {sleeve.accounts.length === 0 ? (
          <li className="text-[12px]" style={{ color: "var(--ap-gray)" }}>
            No accounts tagged in this sleeve yet.
          </li>
        ) : (
          sleeve.accounts.map((row) => (
            <li
              key={`${row.accountLabel}-${row.pctOfSleeve}`}
              className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
              style={{ borderColor: "var(--ap-border)" }}
            >
              <span className="text-[12.5px] font-medium" style={{ color: "var(--ap-navy)" }}>
                {row.accountLabel}
              </span>
              <span
                className="shrink-0 font-mono text-[12px] font-semibold tabular-nums"
                style={{ color: "var(--ap-navy)" }}
              >
                {row.pctOfSleeve}%
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}


function formatLegendPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}%`;
}

/** Sleeve legend â€” separate box below each donut card. */
export function AllocationSleeveLegend({
  sleeves,
  onSelectSleeve,
  activeSleeveKey,
  showPercent = false,
}: {
  sleeves: DonutSleeveSlice[];
  onSelectSleeve?: (sleeveKey: string) => void;
  activeSleeveKey?: string | null;
  showPercent?: boolean;
}) {
  if (sleeves.length === 0) return null;

  return (
    <div
      className="min-h-[52px] px-4 py-3"
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid var(--ap-border)",
      }}
    >
      <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2">
        {sleeves.map((item) => {
          const active = activeSleeveKey === item.sleeveKey;
          const interactive = Boolean(onSelectSleeve);
          const content = (
            <>
              <span
                aria-hidden
                className="h-3 w-3 shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-[12px] font-medium">
                {showPercent ? `${item.label} ${formatLegendPercent(item.value)}` : item.label}
              </span>
            </>
          );
          return (
            <li key={item.sleeveKey}>
              {interactive ? (
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-sm px-1 py-0.5 transition-colors"
                  style={{
                    color: "var(--ap-navy)",
                    backgroundColor: active ? "rgba(15, 23, 42, 0.06)" : "transparent",
                  }}
                  onClick={() => onSelectSleeve?.(item.sleeveKey)}
                >
                  {content}
                </button>
              ) : (
                <span className="flex items-center gap-2" style={{ color: "var(--ap-navy)" }}>
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
