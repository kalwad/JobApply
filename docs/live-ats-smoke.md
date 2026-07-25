# Live ATS supervised smoke test (Stage 1)

**Status:** checklist prepared — not yet performed. Do not claim live ATS verification until each platform row below is completed by a human supervisor.

Automated tests cover only local sanitized fixtures under `fixtures/`. Public-site interaction must **never** submit an application.

## Prerequisites

1. JobApply backend on `127.0.0.1:8085` (`JOBAPPLY_SLIM_MODE=true`)
2. Unpacked Chrome extension loaded from `extension/`
3. Profile + custom Q&A saved in Settings
4. Ollama (recommended) or an explicitly acknowledged cloud provider
5. One public application URL each for Workday, Greenhouse, and Lever

## Per-platform checklist

Copy a row into notes. Stop before submission. Sanitize all notes — no personal data, emails, phone numbers, or resume text.

| Field | Workday | Greenhouse | Lever |
|---|---|---|---|
| Date / tester | | | |
| URL (path only; strip query tokens) | | | |
| Platform identified correctly? | | | |
| Fields detected (count / notable labels) | | | |
| Fields correctly filled | | | |
| Fields incorrectly filled | | | |
| Existing fields preserved | | | |
| Review overlay shown; Cancel/Approve result | | | |
| Conditional fields behaved as expected | | | |
| Submit control refused / not auto-clicked | | | |
| Console or service-worker errors | | | |
| Sanitized notes | | | |

## Procedure

1. Open the public application page (do not use production credentials you cannot afford to expose).
2. Trigger JobApply fill (badge, popup, or shortcut).
3. Confirm review-before-fill lists proposed values.
4. Spot-check nonempty protection and radio/checkbox preservation.
5. Confirm EEO/demographic fields are skipped unless you explicitly enabled `fill_eeo`.
6. Approve fill for empty safe fields only.
7. Confirm the final Submit / Submit Application control was not activated.
8. Close the tab without submitting, or manually discard the draft if the ATS autosaves.

## Sign-off

- [ ] Workday supervised smoke completed (no submit)
- [ ] Greenhouse supervised smoke completed (no submit)
- [ ] Lever supervised smoke completed (no submit)

When all three are checked, Stage 1 live verification may be reported as done.
