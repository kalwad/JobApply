# Live ATS supervised smoke test (Stage 1)

**Status:** checklist prepared — awaiting human supervised runs.  
Automated tests cover only synthetic fixtures under `fixtures/`. Do **not** claim live ATS verification until each platform below is completed.

Public-site interaction must **never** submit an application. Stop before the final submit page.

## Prerequisites

1. Branch `stage1/slim-autofill` @ `cf3e729` (or later acceptance-gap commit)
2. Backend: `uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8085`
3. Open http://127.0.0.1:8085 → Settings: complete profile, saved Q&A, Ollama health OK
4. Chrome (prefer a separate profile): Load unpacked `extension/`
5. Extension popup server URL: `http://localhost:8085` (required by host permissions; backend stays on `127.0.0.1`)
6. One public application URL each for Greenhouse, Lever, Workday

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
