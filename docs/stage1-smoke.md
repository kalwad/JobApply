# JobApply Stage 1 smoke

Stage 1 only: branding, slim mode, profile/Q&A, Ollama, ATS adapters, review-before-fill, and fill safety. Stages 2–6 prototypes remain on `grok/stage1-6-checkpoint` and must not appear here.

## Backend

```bash
uv sync --dev
uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8085
```

Default bind is `127.0.0.1` (`JOBAPPLY_HOST`). Slim mode defaults to on (`JOBAPPLY_SLIM_MODE=true`).

## Core tests

```bash
uv run pytest tests/test_config.py tests/test_autofill_stage1.py \
  tests/test_profile_extended.py tests/test_ai_settings.py -q
```

## Extension (Vitest)

```bash
cd extension && pnpm install && pnpm exec vitest run
```

## Browser fixtures (Playwright)

```bash
uv run playwright install chromium
uv run pytest tests/browser -q
```

These load the unpacked `extension/` in Chromium, serve sanitized Workday/Greenhouse/Lever fixtures, and exercise review-before-fill (Cancel and Approve). They do **not** bypass the review overlay.

## Documented Stage 1 invariants

1. Review-before-fill before any fill
2. Nonempty text fields preserved unless overwrite is enabled
3. Existing radio/checkbox selections preserved
4. Empty radios/checkboxes can be filled
5. EEO/demographic fields skipped unless `fill_eeo` is explicitly enabled
6. Final submit controls are never auto-activated
7. Fill reports summarize filled / skipped / preserved / failed / review-required
8. Ordinary logs do not print profile or answer PII

## Manual live ATS

See `docs/live-ats-smoke.md`. Do not claim live verification until that checklist is completed.
