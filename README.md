# JobApply – Application Copilot

Local-first assistive job-application copilot. Fill and draft with review; **you** always submit.

JobApply is a fork of [CareerPulse](https://github.com/tcpsyn/CareerPulse) (MIT). See [`ATTRIBUTION.md`](ATTRIBUTION.md) and [`LICENSE`](LICENSE).

## Stage 1 scope

- Candidate profile + saved Q&A
- Chrome Manifest V3 extension with Workday, Greenhouse, and Lever adapters
- Review-before-fill, nonempty-field protection, radio/checkbox handling, EEO skip, no automatic final submit
- Ollama (recommended) and optional cloud providers via the FastAPI backend
- Slim mode (default): scrapers, CRM, analytics, and schedulers disabled

Stages 2–6 (Fact Bank, grounded answers, résumé studio) are frozen prototypes on `grok/stage1-6-checkpoint` and are **not** part of this production Stage 1 branch.

## Quick start

```bash
cp .env.example .env
uv sync --dev
uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8085
```

1. Open http://127.0.0.1:8085 → Settings
2. Configure profile + AI provider (Ollama recommended: `http://localhost:11434`)
3. Load unpacked extension from `extension/` (see [`docs/extension-permissions.md`](docs/extension-permissions.md))
4. Open an application form → Fill → review → approve → submit yourself

Cloud providers receive profile and application field context when used; prefer Ollama for local-only processing.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `JOBAPPLY_SLIM_MODE` | `true` | Disable scrapers/CRM/scheduler |
| `JOBAPPLY_DB_PATH` | `data/jobapply.db` | SQLite path |
| `JOBAPPLY_HOST` / `JOBAPPLY_PORT` | `127.0.0.1` / `8085` | Server bind (local-only by default) |
| `JOBAPPLY_ANTHROPIC_API_KEY` | empty | Optional cloud key |

Legacy `JOBFINDER_*` env vars are accepted as a temporary compatibility shim.

## Tests

```bash
# Required JobApply Core (explicit Stage 1 set — see .github/workflows/ci-core.yml)
uv run playwright install chromium
uv run pytest tests/test_config.py tests/test_autofill_stage1.py tests/browser --tb=short

(cd extension && pnpm install && pnpm exec vitest run)
(cd app/static && pnpm install && pnpm exec vitest run tests/router.test.js tests/api.test.js tests/utils.test.js)
```

Full inherited CareerPulse suite: scheduled workflow `ci-upstream-diagnostic.yml` — see [`docs/upstream-diagnostic-failures.md`](docs/upstream-diagnostic-failures.md).

Baseline: [`docs/baseline-test-report.md`](docs/baseline-test-report.md)  
Stage 1 smoke: [`docs/stage1-smoke.md`](docs/stage1-smoke.md)  
Live ATS checklist: [`docs/live-ats-smoke.md`](docs/live-ats-smoke.md)

## Upstream

```bash
git remote -v
# upstream → https://github.com/tcpsyn/CareerPulse.git
git tag -l 'baseline/*'
# baseline/careerpulse-upstream
```

## License

MIT — retains CareerPulse copyright notices. Additional JobApply contributions are under the same license unless noted.
