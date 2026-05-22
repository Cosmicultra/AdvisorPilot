"use client";

/**
 * Embeds the entire legacy `<LegacyAppShell />` inside a CRM route. Used
 * for surfaces (Intake, Workflow tabs) where Phase 3 hasn't extracted the
 * JSX into its own component yet — embedding keeps the existing legacy
 * functionality 100% intact while letting the CRM rail stay on the left.
 *
 * Strategy: render the legacy shell as-is, then use scoped CSS overrides
 * (the legacy's own `.ap-top-nav` + `.ap-app-bg` classes) to hide the
 * legacy's top nav (the CRM rail + top header replace it) and let the
 * CRM's background show through.
 *
 * This component intentionally makes ZERO changes to legacy-app-shell.tsx.
 * That file remains the source of truth for the workflow; we just project
 * its render tree into a different chrome.
 *
 * Side-effect note: the legacy shell mounts <VoiceAgent /> as a leaf at
 * the bottom of its render tree. Embedding here means voice works on this
 * route — that's a feature, not a bug. Voice tools manipulate the legacy
 * shell's local state and stay scoped to it.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Wizard step rail orientation
 * ─────────────────────────────────────────────────────────────────────
 *
 * The legacy `<WizardStepRail />` is a HORIZONTAL bar on top of the
 * main content. Inside the CRM frame, that creates a visually
 * inconsistent triad — primary nav (vertical rail) + wizard nav
 * (horizontal bar) + main content — and squanders the vertical real
 * estate that the rail-style sub-nav pattern uses everywhere else in
 * the CRM.
 *
 * We re-skin it into a VERTICAL left-side sub-rail using nothing but
 * CSS overrides scoped to `.ap-legacy-embed`. Crucially we change ZERO
 * lines inside `legacy-app-shell.tsx` — the same render tree, projected
 * into a different visual layout. This means:
 *
 *   - All step-navigation logic (setStep, intent params, voice
 *     navigation, etc.) keeps working exactly as before.
 *   - The legacy app at `/app` (which is NOT inside `.ap-legacy-embed`)
 *     keeps its original horizontal top-bar wizard rail. The CSS here
 *     only fires inside the embed.
 *   - Hot-reload / future legacy edits don't drift the navigation
 *     visual; both the horizontal (legacy) and vertical (CRM-embedded)
 *     forms render from the same DOM.
 *
 * Layout primitive: flexbox row on `.ap-app-bg` (CRM Roster model).
 * The wizard rail is a fixed-width left pane; only the main content
 * column scrolls. Other children of `.ap-app-bg` are either:
 *   - non-layout (`<style>`)
 *   - `display:none` already (legacy `.ap-top-nav` header)
 *   - portaled (the various dialogs)
 *   - or `position:fixed` (the VoiceAgent button)
 * — so none of them interfere with the two-column flex.
 */

import LegacyAppShell from "@/app/app/legacy-app-shell";

export function LegacyEmbed() {
  return (
    <div className="ap-legacy-embed flex min-h-0 flex-1 flex-col overflow-hidden">
      <style>{`
        /* Hide the legacy top nav — the CRM rail + top header (when present)
           replace it. */
        .ap-legacy-embed .ap-top-nav { display: none !important; }

        /* Let the CRM's background show through the legacy's own gradient
           wrapper, AND turn it into a flex row so the wizard rail can sit
           on the left as a vertical sub-rail instead of a horizontal top
           bar.
           min-height: 100% (not auto, not min-h-screen) makes .ap-app-bg
           fill the LegacyEmbed's available height. Without this the
           container collapses to its content height and the wizard rail
           wrapper "ends" partway down the page — what the user reported
           as "doesn't scale all the way to the bottom".
           align-items: stretch (the flex default, made explicit) lets
           the rail and the main content column both stretch to that
           full height, giving us the CRM Roster's full-bleed-column
           feel. */
        /* Two-pane layout (same model as CRM Roster): wizard rail stays
           fixed-height; only the main form column scrolls. */
        .ap-legacy-embed .ap-app-bg {
          background: transparent !important;
          flex: 1 1 auto !important;
          min-height: 0 !important;
          height: 100% !important;
          max-height: 100% !important;
          display: flex !important;
          flex-direction: row !important;
          align-items: stretch !important;
          gap: 0 !important;
          overflow: hidden !important;
        }

        /* Override legacy min-h-screen so height chains from CRM shell. */
        .ap-legacy-embed > .ap-app-bg {
          min-height: 0 !important;
        }

        /* Wizard rail — full-height left pane (does not scroll with form). */
        .ap-legacy-embed .ap-wizard-rail {
          flex: 0 0 320px !important;
          width: 320px !important;
          max-width: 320px !important;
          align-self: stretch !important;
          display: flex !important;
          flex-direction: column !important;
          min-height: 0 !important;
          overflow: hidden !important;
          background-color: #ffffff !important;
          border-right: 1px solid var(--ap-border-strong, var(--ap-border)) !important;
          border-left: none !important;
          border-top: none !important;
          border-bottom: none !important;
        }

        /* Step list scrolls inside the rail only when steps exceed height. */
        .ap-legacy-embed .ap-wizard-rail-inner {
          flex: 1 1 auto !important;
          min-height: 0 !important;
          overflow-y: auto !important;
          display: flex !important;
          flex-direction: column !important;
          max-width: none !important;
          margin: 0 !important;
          padding: 0 !important;
          flex-wrap: nowrap !important;
          overflow-x: visible !important;
          gap: 0 !important;
        }

        /* Header strip → mirrors the RosterFilterBar's top container.
           Mounted on .ap-wizard-rail-inner (not .ap-wizard-rail) so it
           shares the sticky behavior with the step buttons — see note
           above. The wizard doesn't need search/filter/sort, but it
           needs the same visual rhythm so the wrappers match. A pseudo-
           element lets us inject this header without touching the
           legacy DOM (the wizard rail there has no header child today). */
        .ap-legacy-embed .ap-wizard-rail-inner::before {
          content: "Workflow";
          display: block;
          padding: 0.75rem 0.85rem;
          background-color: #ffffff;
          border-bottom: 1px solid var(--ap-border);
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--ap-gray);
          flex-shrink: 0;
        }

        /* Segment row → mirrors <ClientRow>: full-width clickable strip
           with a left index "tile" (analogue of the roster's initials
           avatar) + a stacked title block. Bottom border separates rows
           the same way the Roster separates clients. Mixed case (no
           upper-case transform), tighter line-height, more reading
           space than the legacy horizontal segment. */
        .ap-legacy-embed .ap-wizard-segment {
          display: flex !important;
          align-items: center !important;
          gap: 0.7rem !important;
          width: 100% !important;
          flex: 0 0 auto !important;
          min-width: 0 !important;
          min-height: 3.25rem !important;
          padding: 0.65rem 0.75rem !important;
          text-align: left !important;
          border-top: none !important;
          border-left: 3px solid transparent !important;
          border-bottom: 1px solid var(--ap-border) !important;
          background-color: transparent !important;
          color: var(--ap-navy) !important;
          font-family: inherit !important;
          font-size: 0.8125rem !important;       /* 13px — matches roster title */
          font-weight: 600 !important;
          letter-spacing: 0 !important;
          text-transform: none !important;       /* override legacy uppercase */
          line-height: 1.2 !important;
        }

        .ap-legacy-embed .ap-wizard-segment:hover {
          background-color: rgba(15, 111, 222, 0.04) !important;
        }

        /* Active state mirrors the selected <ClientRow>: pilot-light
           background, 3px royal left bar. The index tile (below) also
           flips to white-on-pilot-border, just like the roster avatar
           does on selection. */
        .ap-legacy-embed .ap-wizard-segment-active {
          border-left-color: var(--ap-royal) !important;
          border-top-color: transparent !important;
          background-color: var(--ap-pilot-light) !important;
        }

        /* Step icon → 28×28 tile to the left of the label, matching the
           Roster's avatar block (h-9 w-9 with initials, square corners,
           pilot-light bg, navy text, thin border). Slightly smaller
           (28px vs 36px) because the rail is narrower than the Roster.
           On active rows the tile flips to a white background — same
           inversion pattern <ClientRow> uses for its selected avatar. */
        .ap-legacy-embed .ap-wizard-segment-icon {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          width: 1.75rem !important;
          height: 1.75rem !important;
          margin: 0 !important;
          padding: 0 !important;
          background-color: var(--ap-pilot-light) !important;
          color: var(--ap-navy) !important;
          border: 1px solid var(--ap-border) !important;
          flex-shrink: 0 !important;
        }

        .ap-legacy-embed .ap-wizard-segment-active .ap-wizard-segment-icon {
          background-color: #ffffff !important;
          border-color: var(--ap-border-strong) !important;
          color: var(--ap-royal) !important;
        }

        /* Main content column — this is the only pane that scrolls. */
        .ap-legacy-embed .ap-app-bg > div.mx-auto {
          flex: 1 1 0 !important;
          min-width: 0 !important;
          min-height: 0 !important;
          max-width: none !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
        }

        /* ────────────────────────────────────────────────────────────
           Responsive collapse — tablet / narrow desktop (< 1024px):
           the wizard rail shrinks to a 60px icon-only column. Mirrors
           the primary AppRail's 60px footprint so the chrome reads as
           a uniform sidebar pair when the viewport is too narrow for
           the full labeled rail. The WORKFLOW header label is hidden
           (no room for it); the step button labels are clipped, the
           step icon tile stays and acts as the affordance.
           ──────────────────────────────────────────────────────────── */
        @media (max-width: 1023px) {
          .ap-legacy-embed .ap-wizard-rail {
            flex: 0 0 60px !important;
            width: 60px !important;
            max-width: 60px !important;
          }

          .ap-legacy-embed .ap-wizard-rail-inner::before {
            display: none !important;
          }

          /* Centered icon-only segment. font-size: 0 + color: transparent
             clips the label text without changing the DOM. Keep the
             icon tile visible. */
          .ap-legacy-embed .ap-wizard-segment {
            justify-content: center !important;
            padding: 0.65rem 0.35rem !important;
            gap: 0 !important;
            font-size: 0 !important;
            color: transparent !important;
          }

          .ap-legacy-embed .ap-wizard-segment-icon {
            color: var(--ap-navy) !important;
          }

          .ap-legacy-embed .ap-wizard-segment-active .ap-wizard-segment-icon {
            color: var(--ap-royal) !important;
          }
        }

        /* ────────────────────────────────────────────────────────────
           Responsive collapse — mobile (< 768px):
           the wizard rail leaves the left side and becomes a thin
           horizontal step strip pinned to the TOP of the form
           content (sticky, scrolls horizontally). Standard mobile
           wizard pattern — same flow used by Stripe checkout,
           TurboTax, Airbnb intake, etc. — keeps the step list
           always reachable without taking the visual weight of a
           full bottom bar or sidebar.

           Active state moves from a 3px LEFT bar (vertical column)
           to a 3px BOTTOM bar (horizontal tab-strip orientation)
           so the highlight remains aligned with the active tile's
           leading edge in the layout's flow direction.

           The "WORKFLOW" header hides — the step strip itself is
           the entire sub-nav surface on mobile, no label needed.
           ──────────────────────────────────────────────────────────── */
        @media (max-width: 767px) {
          .ap-legacy-embed .ap-app-bg {
            flex-direction: column !important;
          }

          /* Rail becomes a fixed 52px top strip; form scrolls below. */
          .ap-legacy-embed .ap-wizard-rail {
            position: static !important;
            width: 100% !important;
            max-width: none !important;
            height: 52px !important;
            min-height: 52px !important;
            max-height: 52px !important;
            flex: 0 0 auto !important;
            align-self: stretch !important;
            display: block !important;
            border-right: none !important;
            border-bottom: 1px solid var(--ap-border-strong, var(--ap-border)) !important;
            background-color: #ffffff !important;
            z-index: 20 !important;
            box-shadow: 0 2px 6px rgba(12, 25, 41, 0.04) !important;
          }

          .ap-legacy-embed .ap-wizard-rail-inner {
            position: static !important;
            top: auto !important;
            max-height: none !important;
            height: 100% !important;
            flex-direction: row !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            scrollbar-width: thin !important;
          }

          /* Hide the WORKFLOW header — the strip IS the sub-nav on
             mobile, no preamble label needed. */
          .ap-legacy-embed .ap-wizard-rail-inner::before {
            display: none !important;
          }

          /* Each segment: short label inline with the number tile.
             Active state uses a BOTTOM border (tab-style) instead of
             a LEFT bar, matching the horizontal strip orientation. */
          .ap-legacy-embed .ap-wizard-segment {
            flex: 0 0 auto !important;
            width: auto !important;
            min-width: 0 !important;
            height: 100% !important;
            min-height: 100% !important;
            flex-direction: row !important;
            align-items: center !important;
            gap: 0.4rem !important;
            padding: 0 0.85rem !important;
            border-left: none !important;
            border-bottom: 3px solid transparent !important;
            background-color: transparent !important;
            font-size: 0.7rem !important;
            font-weight: 600 !important;
            text-transform: none !important;
            color: var(--ap-navy) !important;
            text-align: left !important;
            white-space: nowrap !important;
          }

          .ap-legacy-embed .ap-wizard-segment:hover {
            background-color: rgba(15, 111, 222, 0.04) !important;
          }

          .ap-legacy-embed .ap-wizard-segment-active {
            border-left-color: transparent !important;
            border-bottom-color: var(--ap-royal) !important;
            background-color: var(--ap-pilot-light) !important;
          }

          .ap-legacy-embed .ap-wizard-segment-icon {
            width: 1.5rem !important;
            height: 1.5rem !important;
          }

          .ap-legacy-embed .ap-wizard-segment-icon svg {
            width: 0.95rem !important;
            height: 0.95rem !important;
          }
        }
      `}</style>
      <LegacyAppShell />
    </div>
  );
}
