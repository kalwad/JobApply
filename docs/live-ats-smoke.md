# Live ATS supervised smoke test (Stage 1)

**Status:** Greenhouse **PASSED** (with known limitation) → next: Lever → Workday.  
Automated tests cover only synthetic fixtures under `fixtures/`. Do **not** claim live ATS verification until each platform below is completed.  
**PR #1:** do not merge until all three platforms pass supervised smoke. Do not resume Stages 2–6.  
**Phone-country:** Stage 1 keeps manual-review skip ([Issue #2](https://github.com/kalwad/JobApply/issues/2)). Do not re-automate in PR #1.

Public-site interaction must **never** submit an application. Stop before the final submit page.

## Prerequisites

1. Branch `stage1/slim-autofill` (confirm `git merge-base --is-ancestor 250266c HEAD`)
2. Backend: `uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8085` (restart after pulls)
3. Open http://127.0.0.1:8085 → Settings: set **First / Middle / Last** explicitly (not only Full Name), saved Q&A, Ollama health OK
4. Chrome: Load unpacked from this repo’s `extension/` → **Reload** after every pull → hard-refresh the application tab
5. Extension popup server URL: `http://localhost:8085` (required by host permissions; backend stays on `127.0.0.1`)
6. One public application URL each for Greenhouse, Lever, Workday

### Greenhouse phone-country diagnostic (before claiming pass)

1. Manually set phone country to **United States (+1)** on the live form.
2. Trigger JobApply → review → Fill approved fields (do **not** submit).
3. Watch whether the phone-country control stays +1 or flips (e.g. to +355) when the number is filled.
4. Expected Stage 1 behavior: JobApply **skips** the phone-country control (manual), fills the national number, leaves an existing +1 selection alone.

## Test order

1. **Greenhouse** (simplest first signal)
2. **Lever**
3. **Workday** (last — custom dropdowns, conditional fields, multi-step)

On each site:

1. Manually enter one correct value into an otherwise empty field (e.g. email).
2. Trigger JobApply → confirm review overlay before any change.
3. Click **Cancel** → confirm absolutely nothing changed.
4. Trigger again → inspect every proposed value.
5. Click **Fill approved fields**.
6. Confirm: manual value preserved; safe empties filled; EEO untouched; submit not activated.
7. Close without submitting (or discard ATS draft if autosaved).

### Workday extras

- Country/state dropdowns and searchable comboboxes
- Dynamic sponsorship questions after Save and Continue
- Education/employment repeat sections, address fields
- Multi-step navigation: you may manually use non-final Next/Continue, then re-trigger JobApply
- JobApply must **not** auto-advance pages
- Stop before the actual final submission page

### Short-answer / Ollama (at least one application)

- Saved Q&A reused when the question clearly matches
- New Ollama draft appears in **review before insertion**
- Respects visible character limits
- Does not invent employers, skills, metrics, or experience

## Per-platform results (sanitize — no PII)

### Greenhouse

```
Platform: Greenhouse
Status: PASSED (supervised live)
Date: 2026-07-24
Git HEAD: 25b72dc+ / 1d635de+
Preservation run: United States (+1) selected before JobApply; remained +1 after national number fill
First/middle/last names: correct (Tanish / Ashok / Kalwad)
Address country: United States (as applicable)
Work authorization: Yes/No path — not a country name
Phone national number: correct
Phone country: manual; not autofilled; no +355
Known limitations: Phone-country selector requires manual selection in Stage 1.
EEO note: demographic self-ID (race/gender/veteran/disability) — user did not report changes; Stage 1 must leave these alone unless fill_eeo is enabled.
Next: Lever supervised smoke
```

### Lever

```
Platform: Lever
Date:
Job path/domain:
Platform correctly detected:
Fields detected:
Fields correctly filled:
Fields missed:
Fields filled incorrectly:
Existing fields preserved:
Cancel changed nothing:
Radio behavior:
Checkbox behavior:
Dropdown behavior:
Conditional fields:
Saved Q&A behavior:
Ollama-generated answer behavior:
EEO fields untouched:
Final submit untouched:
Console/service-worker errors:
Known limitations:
```

### Workday

```
Platform: Workday
Date:
Job path/domain:
Platform correctly detected:
Fields detected:
Fields correctly filled:
Fields missed:
Fields filled incorrectly:
Existing fields preserved:
Cancel changed nothing:
Radio behavior:
Checkbox behavior:
Dropdown behavior:
Conditional fields:
Saved Q&A behavior:
Ollama-generated answer behavior:
EEO fields untouched:
Final submit untouched:
Console/service-worker errors:
Known limitations:
```

## What counts as a Stage 1 merge blocker

- Populated field overwritten without permission
- Wrong radio selected
- Legal attestation checked automatically
- Unexpected EEO answer
- Generated response inserted without review
- Extension activates a submit control
- Workday validation error from incorrect DOM changes
- Extension claims filled when it did not
- Silent failure without skipped/failed identification

Missed fields are less severe than incorrect ones — record them for adapter work; treat destructive/misleading behavior as a blocker.

## Screenshots

Do **not** commit screenshots with email, phone, address, résumé text, account data, or application tokens. Keep personal captures outside the repo or redact first.

## Sign-off

- [ ] Greenhouse supervised smoke completed (no submit)
- [ ] Lever supervised smoke completed (no submit)
- [ ] Workday supervised smoke completed (no submit)
- [ ] Short-answer / Ollama review path exercised on at least one site

When all are checked, ask Cursor to sanitize results into this file, update the acceptance report + PR description, re-run checks, and merge PR #1 with a **normal merge commit** (not squash).
