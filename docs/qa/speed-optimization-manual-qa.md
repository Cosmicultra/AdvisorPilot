# Speed optimization — manual QA checklist

Baseline recorded before speed work (Phase 0). Re-run after each phase for Google **and** email/password sign-in.

| Area | Google | Email/password | Notes |
|------|--------|----------------|-------|
| Login → `/app` or `/app/crm` | [ ] | [ ] | |
| Open client in roster | [ ] | [ ] | |
| Overview tab (cards load) | [ ] | [ ] | |
| Legacy workflow: intake → upload → confirm → analysis | [ ] | [ ] | |
| Email client snapshot | [ ] | [ ] | |
| Roth report + roth analysis | [ ] | [ ] | |
| Nova chat + one text message | [ ] | [ ] | |
| Nova voice mode toggle | [ ] | [ ] | |

**Baseline:** `npm test` — 986 passed (2 skipped). Run `npm run build` before merge.
