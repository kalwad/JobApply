# Stage 1 acceptance report

Branch: `stage1/slim-autofill` (created from `origin/main` @ `c937e36`)  
Default branch verified: `main` (`gh repo view kalwad/JobApply --json defaultBranchRef`)  
WIP / audit refs preserved: `grok/stage1-6-checkpoint`, `audit/stage1-6`, `baseline/untouched`, tag `baseline/careerpulse-upstream`

## Commit structure

| Hash | Commit |
|------|--------|
| `30def04` | chore: apply JobApply branding and environment compatibility |
| `b101dd3` | feat: introduce local-only slim application mode |
| `d320076` | refactor: retain profile Q&A and Ollama application services |
| `cec014f` | feat: harden ATS extraction and autofill safety |
| `9e4ac52` | feat: add review-before-fill and structured fill reports |
| `f3132d9` | test: add browser-level ATS fixtures and safety invariants |
| `e28245b` | ci: separate core acceptance from upstream diagnostics |
| `21b16c7` | docs: add Stage 1 setup security and smoke-test guides |

## Commands run

```bash
gh repo edit kalwad/JobApply --default-branch main
gh repo view kalwad/JobApply --json defaultBranchRef

git fetch --all --tags
git switch main && git pull --ff-only origin main
git switch -c stage1/slim-autofill

uv sync --dev
uv run playwright install chromium

uv run pytest --tb=short \
  tests/test_config.py tests/test_ai_client.py tests/test_ai_settings.py \
  tests/test_ai_retry.py tests/test_autofill_timeout.py \
  tests/test_profile_extended.py tests/test_resumes.py \
  tests/test_pdf_generator.py tests/test_docx_export.py \
  tests/test_autofill_stage1.py
# → 104 passed

uv run pytest tests/browser --tb=short -q
# → 9 passed

(cd extension && pnpm exec vitest run)
# → 486 passed

(cd app/static && pnpm exec vitest run tests/router.test.js tests/api.test.js tests/utils.test.js)
# → 64 passed
```

## Browser fixture results

| Fixture | Extension load | Review overlay | Cancel (no fill) | Approve + protections | Screenshots |
|---------|----------------|----------------|------------------|-----------------------|-------------|
| Workday | pass (shared) | pass | pass | pass | `docs/screenshots/workday-*.png` |
| Greenhouse | pass | pass | pass | pass | `docs/screenshots/greenhouse-*.png` |
| Lever | pass | pass | pass | pass | `docs/screenshots/lever-*.png` |

Protections exercised in browser tests: nonempty preservation, preselected radio preservation, EEO untouched, submit not auto-focused, review not bypassed.

## Security fixes

1. Default bind `127.0.0.1` (`JOBAPPLY_HOST`)
2. Extension debug logging redacted / off unless `debugAutofill`
3. Permissions documented in `docs/extension-permissions.md` (`host_permissions` limited to local backend; `<all_urls>` content scripts justified for ATS domains)
4. Cloud provider disclosure in onboarding, Settings, and `.env.example`

## Stage 2–6 exclusion

Confirmed absent on this branch: `app/facts`, `app/answers`, `app/resume_engine`, Fact Bank / Resume Studio UI routes, and related tests. Prototypes remain on `grok/stage1-6-checkpoint`.

## Known limitations

- Live Workday / Greenhouse / Lever supervised smoke **not** performed (see `docs/live-ats-smoke.md`)
- Full upstream CareerPulse suite has inherited scraper/network failures; tracked by `ci-upstream-diagnostic.yml` and `docs/upstream-diagnostic-failures.md`
- Browser acceptance uses mocked local autofill API responses for deterministic mappings; review overlay and DOM protections are real extension code paths
- Generic field extraction beyond the three ATS adapters is inherited best-effort only

## Manual steps awaiting user confirmation

- [ ] Workday live smoke (stop before submit)
- [ ] Greenhouse live smoke (stop before submit)
- [ ] Lever live smoke (stop before submit)

## Verdict

Automated Stage 1 evidence on this branch is ready for PR review. **Do not merge** until supervised live ATS checklists are completed and Core CI is green on the PR.
