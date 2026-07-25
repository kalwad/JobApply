# Live ATS supervised smoke test (Stage 1)

**Status:** Greenhouse / Lever — **provisional** (must re-smoke on frozen HEAD) · Workday — **“My Information” page passed on the current local build** (steps 2–7 outstanding).  
**Frozen HEAD:** `7ffb7d2` (`7ffb7d2f84c4fa5830abca7c266bfef13f59a14f`) on `stage1/slim-autofill` — Workday state fix, City/Phone dedupe, review regressions, browser fixture green.  
Automated tests cover only synthetic fixtures under `fixtures/`. Do **not** claim full live ATS verification until Greenhouse, Lever, and Workday are all re-smoked on the **same frozen HEAD**.  
**PR #1:** do not merge until that same-HEAD live verification completes and the owner explicitly confirms. Do not resume Stages 2–6.  
**Phone-country:** Stage 1 keeps manual-review skip ([Issue #2](https://github.com/kalwad/JobApply/issues/2)). Do not re-automate in PR #1.  
**Stage 1.1 (documented, not in this freeze):** async AI review panel; structured Projects + dual placement; résumé binary storage + approved ATS file attach.

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
Status: PROVISIONAL (supervised live on older HEAD — must re-smoke on frozen HEAD)
Date: 2026-07-24
Git HEAD at test: 25b72dc+ / 1d635de+ (not final freeze)
Preservation run: United States (+1) selected before JobApply; remained +1 after national number fill
First/middle/last names: correct
Address country: United States (as applicable)
Work authorization: Yes/No path — not a country name
Phone national number: correct
Phone country: manual; not autofilled; no +355
Known limitations: Phone-country selector requires manual selection in Stage 1.
EEO note: demographic self-ID left alone (Stage 1 default).
Next: same-HEAD re-smoke after freeze
```

### Lever

```
Platform: Lever
Status: PROVISIONAL (supervised live on older HEAD — must re-smoke on frozen HEAD)
Date: 2026-07-25
Fields filled: Full name, Email, Phone — verified correct on page
Review-before-fill shown; post-fill overlay listed the same three fields
Submit: not activated (user closed without submitting)
Known limitations: Cancel-first protocol awkward when form starts blank (refresh clears Lever draft); Cancel appears on pre-fill review only, not post-fill summary.
Next: same-HEAD re-smoke after freeze
```

### Workday

```
Platform: Workday
Status: Workday “My Information” page passed on the current local build.
  Full Workday application (steps 2–7) NOT passed yet.
Date: 2026-07-25
Job path/domain: myworkdayjobs.com (role sanitized)
Platform correctly detected: yes
Step 1 (My Information) correctly filled:
  - Country / Territory: United States of America
  - First / Middle / Last: correct
  - Address line / City / State (Michigan) / Postal: correct
  - Email: preserved (nonempty; operator may prefer a non-relay address — edit that field only)
  - Phone device type: Mobile
  - Phone country: United States (+1) preserved (manual)
  - Phone number: correct national format
Manual before Continue:
  - Prior Workday employee Yes/No — answer truthfully (not autofilled from unrelated profile data)
Fields filled incorrectly: none reported on step 1
Dropdown behavior: stateProvince prompt → Michigan (after local fix; previously stuck on Select One)
phone-sms-opt-in: must not be proposed as phone number (regression covered)
Duplicate City/Phone proposals: watch/review dedupe on freeze build
Final submit untouched: yes (did not submit)
EEO / Voluntary Disclosures / Self Identify: not yet reached — leave untouched
Steps remaining (operator-driven; JobApply must not navigate):
  2 My Experience — résumé upload MANUAL; document misses; no wrong-section fills
  3–4 Application Questions — auth/sponsorship Yes/No only; salary/relocation/start/referral safe
  5–6 Voluntary Disclosures / Self Identify — EEO untouched; no attestations/signatures
  7 Review — inspect only; abandon draft; never Submit
Next: finish steps 2–7 on freeze HEAD, then same-HEAD Greenhouse + Lever re-smoke
```

## Stage 1.1 backlog (document only — not this freeze)

1. **Async review:** show deterministic + saved Q&A immediately; append Ollama drafts (“Generating N additional responses…”). Contact fields must not wait on AI timeout.
2. **Projects:** Settings CRUD + parse; if ATS has Projects, fill there; else append under Work Experience after real jobs (never overwrite).
3. **Résumé binary:** store uploaded PDF/DOCX; Settings file picker; extension `upload_file` only after review shows chosen filename. Until then ATS résumé remains manual.

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
