# JobApply Stage 1–6 Smoke & Invariants

Smoke checks and extension safety invariants for JobApply Application Copilot.

## Backend smoke

```bash
cd /path/to/jobapply
uv run pytest tests/test_facts.py tests/test_answers_engine.py tests/test_resume_engine.py -q
```

## Extension invariants (Stages 3 & 6)

Run adapter core + fixture extraction tests:

```bash
cd extension
pnpm install
pnpm exec vitest run tests/ats-core.test.js tests/fixtures-extract.test.js
```

Or via pytest wrapper:

```bash
uv run pytest tests/e2e/test_extension_invariants.py -q
```

## Documented invariants

1. **Review-before-fill** — Autofill shows a review step unless `__jaSkipReview` is set in tests.
2. **Nonempty protection** — Existing field values are not overwritten unless `overwriteExistingFields` is enabled in extension storage.
3. **Submit refusal** — Fill logic refuses to interact with submit/application controls.
4. **Sensitive skip** — EEO / submit / phone-guard skips appear in fill reports as `skippedSensitive`.
5. **Grounded answers** — `/api/answers/generate` prefers saved Q&A and verified facts; AI answers flag `needsReview` when citing unsupported numbers/employers.
6. **Resume gaps** — `/api/resume/tailor` returns explicit skill gaps; unsupported requirements are never invented.
7. **Fact verification** — Imported resume facts remain `verified=false` until user confirms in Fact Bank UI.
8. **Adapter contract** — `ats-core.js` wraps legacy adapters with `detect/getFormRoot/getFieldMap`; fixtures under `fixtures/{workday,greenhouse,lever}/` must extract labeled applicant fields.

## Slim mode routers (always mounted)

- `/api/facts/*`
- `/api/answers/*`
- `/api/resume/tailor`
- `/api/autofill/*` (existing)

## Manual extension check

1. Start JobApply: `uv run uvicorn app.main:app --port 8085`
2. Load unpacked extension from `extension/`
3. Open a fixture HTML file in the browser (or a real Workday/Greenhouse/Lever form)
4. Trigger autofill — overlay should show fill report summary after completion
