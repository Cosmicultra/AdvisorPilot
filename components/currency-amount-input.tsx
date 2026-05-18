"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  countMoneyDigitsBefore,
  formatMoneyInputDisplay,
  moneyCursorAfterDigits,
  parseMoneyInputRaw,
} from "@/lib/money-input";

type Props = {
  value: string;
  onChange: (raw: string) => void;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
};

/** Dollar amount field: "$" prefix, comma grouping while typing, stores digits-only in parent state. */
export function CurrencyAmountInput({
  value,
  onChange,
  className,
  inputClassName,
  placeholder,
  id,
  disabled,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cursorDigitsRef = useRef<number | null>(null);
  const display = formatMoneyInputDisplay(value);

  useLayoutEffect(() => {
    const el = inputRef.current;
    const digits = cursorDigitsRef.current;
    if (!el || digits === null) return;
    const pos = moneyCursorAfterDigits(display, digits);
    el.setSelectionRange(pos, pos);
    cursorDigitsRef.current = null;
  }, [display]);

  return (
    <div
      className={cn(
        "flex h-12 items-center overflow-hidden rounded-none border border-input bg-white focus-within:ring-2 focus-within:ring-[#0f6fde]",
        className
      )}
    >
      <span className="shrink-0 pl-3 text-base font-medium text-slate-600 md:text-lg">$</span>
      <input
        ref={inputRef}
        id={id}
        type="text"
        autoComplete="off"
        disabled={disabled}
        className={cn(
          "h-full min-w-0 flex-1 border-0 bg-transparent px-1 pr-3 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          inputClassName
        )}
        value={display}
        onChange={(e) => {
          const el = e.target;
          cursorDigitsRef.current = countMoneyDigitsBefore(el.value, el.selectionStart ?? el.value.length);
          onChange(parseMoneyInputRaw(el.value));
        }}
        placeholder={placeholder}
      />
    </div>
  );
}
