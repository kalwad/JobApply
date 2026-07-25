# Stage 1 acceptance report

Branch: `stage1/slim-autofill` (from `origin/main` @ `c937e36`)  
PR: https://github.com/kalwad/JobApply/pull/1 — **not approved for merge** until live ATS checklist is done.

WIP / audit refs preserved: `grok/stage1-6-checkpoint`, `audit/stage1-6`, `baseline/untouched`, tag `baseline/careerpulse-upstream`.

## Default branch verification (raw)

```text
$ gh api repos/kalwad/JobApply --jq .default_branch
main

$ git ls-remote --symref origin HEAD
ref: refs/heads/main	HEAD
c937e366b9f7566a5c3b6a9d3fafc8f7d25272bd	HEAD
```

Both identify `main`. No PATCH was required on this pass.

## Commands run (acceptance-gap patch)

```bash
gh api repos/kalwad/JobApply --jq .default_branch
git ls-remote --symref origin HEAD

uv sync --dev
uv run playwright install chromium

uv run pytest tests/test_autofill_stage1.py tests/test_config.py -q
# → 5 passed

uv run pytest tests/browser -q
# → 10 passed

(cd extension && pnpm exec vitest run)
# → 486 passed

(cd app/static && pnpm exec vitest run tests/router.test.js tests/api.test.js tests/utils.test.js)
# → 64 passed
```

## Browser fixture evidence (synthetic local ATS fixtures)

Screenshots are labeled: **“Pre-fill review overlay on a synthetic local ATS browser fixture”** (and cancel / approve / fill-report counterparts). They are **not** live Workday/Greenhouse/Lever verification.

| Artifact | Path |
|---|---|
| Workday review | `docs/screenshots/workday-review-overlay.png` |
| Workday cancel | `docs/screenshots/workday-cancel-result.png` |
| Workday approve | `docs/screenshots/workday-after-approve.png` |
| Workday fill report | `docs/screenshots/workday-fill-report.png` + `.json` |
| Greenhouse review | `docs/screenshots/greenhouse-review-overlay.png` |
| Greenhouse cancel | `docs/screenshots/greenhouse-cancel-result.png` |
| Greenhouse approve | `docs/screenshots/greenhouse-after-approve.png` |
| Greenhouse fill report | `docs/screenshots/greenhouse-fill-report.png` + `.json` |
| Lever review | `docs/screenshots/lever-review-overlay.png` |
| Lever cancel | `docs/screenshots/lever-cancel-result.png` |
| Lever approve | `docs/screenshots/lever-after-approve.png` |
| Lever fill report | `docs/screenshots/lever-fill-report.png` + `.json` |
| Full-stack review/approve | `docs/screenshots/fullstack-greenhouse-*.png` |
| Full-stack analyze trace | `docs/screenshots/fullstack-analyze-trace.json` |

CI uploads these under artifact `stage1-browser-evidence`. Required screenshots fail the run if capture fails.

### Checkbox evidence

- Empty benign `contact_by_email` → checked after Approve
- Prechecked SMS/newsletter → remains checked (`alreadyCompleted`)
- Unmapped `marketing_opt_in` (false/absent preference) → remains unchecked
- Legal terms/privacy → `skip` with reason `manual review — legal attestation` (`needsReview`)
- EEO controls → skipped without `fill_eeo`

### Radio evidence

- Empty trusted `work_auth` / `sponsorship` → filled from explicit profile/mock value after Approve
- Existing `contact_pref=email` → unchanged
- Untested/untrusted groups (`favorite_color`, `shirt_size`, `team_color`) → remain unselected
- EEO `disability` radio → untouched

### Submit-event counter evidence

Fixture pages install:

- `window.__submitEventCount`
- `window.__submitButtonClickCount`
- `window.__requestSubmitCount` (patched `requestSubmit`)

Cancel and Approve paths assert all three remain **0**. Submit is also deliberately proposed in the mock mapping and refused by the extension (`refusing to interact with submit control`).

### Exact fill-report assertions (mocked analyze path)

| ATS | filled | alreadyCompleted (preserved) | skippedSensitive | needsReview | failed |
|---|---:|---:|---:|---:|---:|
| Workday | 5 | 2 | 4 | 1 | 0 |
| Greenhouse | 5 | 3 | 3 | 1 | 0 |
| Lever | 4 | 2 | 3 | 1 | 0 |

Named categories verified in results JSON: submit refusal, EEO skip, legal manual review, nonempty protection.

### Full-stack request trace

`tests/browser/test_fullstack_autofill.py` runs:

fixture page → unpacked extension → real FastAPI on `127.0.0.1` → `/api/autofill/analyze` (not mocked) → review → Approve → DOM fill → fill report dataset.

Deterministic profile rules supply mappings (no cloud credentials / no live Ollama). Trace: `docs/screenshots/fullstack-analyze-trace.json`.

### Runtime error capture

Harness fails on page exceptions, content-script console errors, service-worker console errors, and unhandled rejections. Nonfatal warnings are recorded separately. Notification prompts are suppressed via Chromium flags; persistent contexts always `close()` in `finally`.

## Security / Stage 1 scope notes

- Default bind `127.0.0.1`; slim mode default on
- Checkbox/radio `currentValue` extraction uses checked state (not the value attribute)
- Autofill radio/checkbox action detection no longer misclassifies group `options` as dropdowns
- No Stage 2–6 modules on this branch

## Remaining manual live-ATS work

See `docs/live-ats-smoke.md`. Still required before merge:

- [ ] Supervised Workday public application (stop before submit)
- [ ] Supervised Greenhouse public application (stop before submit)
- [ ] Supervised Lever public application (stop before submit)

Do **not** squash-merge when ready; use a normal merge commit to preserve Stage 1 history.
