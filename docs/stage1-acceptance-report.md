# Stage 1 acceptance report

Branch: `stage1/slim-autofill`  
**Code freeze (extension/tests):** `7ffb7d2` — reload unpacked extension from this commit or newer tip of `stage1/slim-autofill`.  
Docs-only commits after `7ffb7d2` do not change autofill behavior.  
PR: https://github.com/kalwad/JobApply/pull/1 — **not approved for merge** until same-HEAD live ATS re-smoke completes and the owner explicitly confirms.

WIP / audit refs preserved: `grok/stage1-6-checkpoint`, `audit/stage1-6`, `baseline/untouched`, tag `baseline/careerpulse-upstream`.

## Current freeze

Record after each push of Stage 1 acceptance work:

| Item | Value |
|------|--------|
| Branch | `stage1/slim-autofill` |
| Code freeze | `7ffb7d2f84c4fa5830abca7c266bfef13f59a14f` |
| Branch tip | `git rev-parse origin/stage1/slim-autofill` |
| Workday live status | **My Information page passed on the current local build** — steps 2–7 not passed |
| Greenhouse / Lever live status | **Provisional** on older HEADs — must re-smoke on frozen HEAD |
| Merge | **Blocked** until owner confirms |

## Default branch verification (raw)

```text
$ gh api repos/kalwad/JobApply --jq .default_branch
main

$ git ls-remote --symref origin HEAD
ref: refs/heads/main	HEAD
```

## Commands run (freeze acceptance pass)

```bash
git rev-parse HEAD

(cd extension && pnpm exec vitest run)
# → 501 passed

uv run pytest tests/test_autofill_stage1.py tests/test_autofill_timeout.py \
  tests/test_config.py tests/test_profile_extended.py tests/test_resumes.py \
  tests/test_autofill_qa_ollama_stage1.py -q
# → passed

uv run pytest tests/browser/test_ats_fixtures.py -q
# → 7 passed (review Cancel/Approve × 3 ATS + Playwright dependency)

(cd app/static && pnpm exec vitest run tests/router.test.js tests/api.test.js tests/utils.test.js)
# → 64 passed
```

## Regression coverage added for freeze

| Case | Coverage |
|------|----------|
| Long review keeps Fill/Cancel visible | `extension/tests/content.test.js` review overlay |
| Collapsed → Expand control | same |
| `phone-sms-opt-in` ≠ phone number | `isPhoneField` + backend timeout suite |
| Michigan sticks after Workday popup | Workday state dropdown suite |
| Failed state reported not filled | `selection did not stick` test |
| Duplicate City/Phone → one proposal | `sanitizeMappings` dedupe |
| Contact-by-email ≠ Email text field | dedupe isolation test |
| Submit never clicked | existing `isSubmitControl` + browser sentinels |
| Greenhouse phone-country manual | existing widget + Stage 1 skip |

## Browser fixture evidence (synthetic local ATS fixtures)

Screenshots are labeled: **“Pre-fill review overlay on a synthetic local ATS browser fixture”**. They are **not** live Workday/Greenhouse/Lever verification.

See `docs/screenshots/` and CI artifact `stage1-browser-evidence`.

### Exact fill-report assertions (mocked analyze path)

| ATS | filled | alreadyCompleted (preserved) | skippedSensitive | needsReview | failed |
|---|---:|---:|---:|---:|---:|
| Workday | 5 | 2 | 4 | 1 | 0 |
| Greenhouse | 5 | 3 | 3 | 1 | 0 |
| Lever | 4 | 2 | 3 | 1 | 0 |

## Saved Q&A / Ollama (automated)

- API: `tests/test_autofill_qa_ollama_stage1.py` — Q&A persistence; deterministic email survives essay/AI path; salary does not receive “why company” answer.
- Extension: `fuzzyMatchQA` / `applyCustomQA` unit tests (review-before-insert remains in the live path).
- **Live** one saved-Q&A + one Ollama short-answer on a real application page remains operator-required before merge (see `docs/live-ats-smoke.md`).

## Stage 1.1 backlog (documented, not implemented on this freeze)

1. **Async review:** deterministic + saved Q&A immediately; Ollama appends (“Generating N additional responses…”).
2. **Projects:** Settings CRUD + dual placement (Projects section if present, else under Work Experience after real jobs).
3. **Résumé binary:** store PDF/DOCX; Settings file picker; approved ATS `upload_file` showing chosen filename. Until then ATS résumé upload stays manual.

## PII hygiene

- Working tree and commits use synthetic fixtures only (`555…`, `example.com`, `Testville`).
- Owner-approved history rewrite on unmerged `stage1/slim-autofill` replaced a real phone digit string previously present in test fixtures. Mapping documented in `docs/pii-history-rewrite.md`.
- Do not force-push `main`. Live smoke notes must stay sanitized (no street, relay email, phone, LinkedIn URL in docs).

## Resume analysis (pre-merge safety)

- `/api/resume/upload` returns a **draft only** — does not save search terms, seniority, ATS/heuristic scores, or profile rows until `POST /api/resume/draft/approve`.
- Employment dates validated deterministically against today’s date; June 2026–Present is valid in July 2026.
- Seniority enum includes intern→principal + unknown; senior+ clamped by professional years.
- UI label: **AI Resume Content Heuristic** (not a real ATS parse).
- Analyzer is **not** verified as trustworthy for automatic job-search targeting.

## Stage 1.1 (separate branch after PR #1)

Create `stage1.1/resume-assets-projects` for: original PDF/DOCX assets, ATS file attach with review, Projects model + dual placement, corrected async analysis jobs. **Not in PR #1.**

## Security / Stage 1 scope notes

- Default bind `127.0.0.1`; slim mode default on
- No Stage 2–6 modules on this branch
- Phone-country remains manual ([Issue #2](https://github.com/kalwad/JobApply/issues/2))

## Remaining manual live-ATS work (same frozen HEAD)

See `docs/live-ats-smoke.md`. Still required before merge:

- [ ] Finish Workday steps 2–7 to Review (no submit); then full Workday pass on freeze HEAD
- [ ] Quick Greenhouse re-smoke on freeze HEAD
- [ ] Quick Lever re-smoke on freeze HEAD
- [ ] One live saved-Q&A + one live Ollama short-answer review path
- [ ] Owner confirms merge (normal merge commit, not squash)

Do **not** resume Stages 2–6. Do **not** merge until explicitly confirmed.
