"use client";

/**
 * Inline stage dropdown — PATCHes /api/clients/[id] on change so the advisor
 * can update lifecycle stage without opening Edit Client.
 */

import { useEffect, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import { CLIENT_STAGE_HEADER_SELECT_OPTIONS } from "@/lib/crm/stage";
import type { ClientDetail, ClientStage } from "@/lib/crm/types";
import { stageChipStyle, stageTextColor } from "./stage-chip-style";

type HeaderStage = (typeof CLIENT_STAGE_HEADER_SELECT_OPTIONS)[number];

function isHeaderStage(value: string | null): value is HeaderStage {
  return (
    value !== null &&
    (CLIENT_STAGE_HEADER_SELECT_OPTIONS as readonly string[]).includes(value)
  );
}

export type ClientStageSelectProps = {
  clientId: string;
  /** Effective stage (persisted or computed) shown in the control. */
  stage: ClientStage | null;
  onUpdated(client: ClientDetail): void;
  /** `meta` matches profile-header email/owner line; `chip` uses colored stage chips. */
  variant?: "meta" | "chip";
};

export function ClientStageSelect({
  clientId,
  stage,
  onUpdated,
  variant = "chip",
}: ClientStageSelectProps) {
  const [value, setValue] = useState(() => toSelectValue(stage));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(toSelectValue(stage));
  }, [stage]);

  const handleChange = async (nextRaw: string) => {
    if (!isHeaderStage(nextRaw)) return;

    const prev = value;
    setValue(nextRaw);
    setSaving(true);
    setError(null);

    const patchStage = nextRaw;

    try {
      const res = await advisorFetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: patchStage }),
      });

      if (res.status === 401) {
        setValue(prev);
        setError("Session expired");
        setSaving(false);
        return;
      }

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.client) {
        setValue(prev);
        setError(json?.error ?? "Failed to update stage");
        setSaving(false);
        return;
      }

      onUpdated(json.client as ClientDetail);
      setSaving(false);
    } catch {
      setValue(prev);
      setError("Failed to update stage");
      setSaving(false);
    }
  };

  const isMeta = variant === "meta";
  const selectTextColor = isHeaderStage(value)
    ? stageTextColor(value)
    : "var(--ap-gray)";
  const chipStyle = isHeaderStage(value)
    ? stageChipStyle(value)
    : {
        backgroundColor: "rgba(12, 25, 41, 0.04)",
        color: "var(--ap-gray)",
      };

  return (
    <div className={`flex flex-col gap-0.5 ${isMeta ? "ml-1" : ""}`}>
      <select
        value={value}
        onChange={(e) => void handleChange(e.target.value)}
        disabled={saving}
        aria-label="Client lifecycle stage"
        title="Lifecycle stage"
        className={
          isMeta
            ? "cursor-pointer border-0 bg-transparent py-0 pl-0 pr-0 text-[11.5px] leading-normal focus:outline-none disabled:cursor-wait disabled:opacity-70"
            : "cursor-pointer px-2 py-1 text-[11.5px] font-medium uppercase tracking-wide focus:outline-none disabled:cursor-wait disabled:opacity-70"
        }
        style={
          isMeta
            ? { color: selectTextColor }
            : {
                ...chipStyle,
                border: "1px solid var(--ap-border)",
                minWidth: "7.5rem",
              }
        }
      >
        {!value ? (
          <option value="" disabled style={{ color: "var(--ap-gray)" }}>
            Stage
          </option>
        ) : null}
        {CLIENT_STAGE_HEADER_SELECT_OPTIONS.map((s) => (
          <option key={s} value={s} style={{ color: stageTextColor(s) }}>
            {s}
          </option>
        ))}
      </select>
      {error ? (
        <span
          className={isMeta ? "text-[11.5px]" : "text-[10px]"}
          style={{ color: "#9B1C1C" }}
          role="alert"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}

function toSelectValue(stage: ClientStage | null): HeaderStage | "" {
  return isHeaderStage(stage) ? stage : "";
}
