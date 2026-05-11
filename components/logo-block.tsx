"use client";

import { useState } from "react";

export function LogoBlock({
  compact = false,
  variant = "default",
  size = "default",
}: {
  compact?: boolean;
  variant?: "default" | "nav";
  /** Larger image and type for marketing header */
  size?: "default" | "large";
}) {
  const [broken, setBroken] = useState(false);
  const isNav = variant === "nav";
  const isLarge = size === "large";
  const titleCls = isLarge
    ? `font-serif text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl md:text-[2.125rem] lg:text-[2.45rem] ${isNav ? "!text-white" : ""}`
    : `font-serif text-2xl font-bold tracking-tight md:text-[1.7rem] ${isNav ? "text-white" : "text-slate-950"}`;
  const tagCls = isLarge
    ? `text-sm sm:text-base ${isNav ? "text-slate-400" : "text-slate-500"}`
    : `text-sm ${isNav ? "text-slate-400" : "text-slate-500"}`;
  const wordBreak = isNav ? "hidden md:block" : compact ? "" : isLarge ? "block min-w-0" : "hidden sm:block";

  const imgClassName = [
    "block shrink-0 rounded-none object-contain",
    isNav ? "opacity-[0.96]" : "drop-shadow-[0_8px_18px_rgba(14,116,235,0.18)]",
    isLarge
      ? "h-12 w-auto sm:h-14 md:h-[4.25rem] lg:h-[4.75rem]"
      : "h-12 w-auto md:h-[4.05rem]",
  ].join(" ");

  if (broken) {
    return (
      <div className={`flex items-center ${isLarge ? "gap-3 sm:gap-4" : "gap-3"}`}>
        <div
          className={`ap-icon-tile flex shrink-0 items-center justify-center rounded-none font-bold ${
            isLarge
              ? "h-14 w-14 text-xl sm:h-16 sm:w-16 sm:text-2xl md:h-[4.25rem] md:w-[4.25rem] md:text-[1.65rem]"
              : "h-14 w-14 text-lg md:h-16 md:w-16 md:text-xl"
          }`}
        >
          AP
        </div>
        {!compact && (
          <div className={wordBreak}>
            <p className={titleCls}>
              Advisor
              <span className={isNav ? "text-[#7eb8f5]" : "text-[var(--ap-royal)]"}>Pilot</span>
            </p>
            <p className={tagCls}>Portfolio review assistant</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`flex w-fit max-w-full items-center ${isLarge ? "gap-3 sm:gap-4" : "min-w-0 gap-3"}`}>
      {/* Native img: predictable sizing next to text in flex headers (Next/Image can collapse with min-w-0 ancestors). */}
      <img
        src="/logo.png"
        alt="AdvisorPilot logo"
        width={160}
        height={160}
        decoding="async"
        className={imgClassName}
        onError={() => setBroken(true)}
      />
      {!compact && (
        <div className={wordBreak}>
          <p className={titleCls}>
            Advisor<span className={isNav ? "text-[#7eb8f5]" : "text-[var(--ap-royal)]"}>Pilot</span>
          </p>
          <p className={tagCls}>Portfolio review assistant</p>
        </div>
      )}
    </div>
  );
}
