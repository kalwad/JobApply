# JobApply – Application Copilot

Local-first assistive job-application copilot. Fill and draft with review; **you** always submit.

JobApply is a fork of [CareerPulse](https://github.com/tcpsyn/CareerPulse) (MIT). See [`ATTRIBUTION.md`](ATTRIBUTION.md) and [`LICENSE`](LICENSE).

## Stage 1 scope

- Candidate profile + saved Q&A
- Chrome Manifest V3 extension with Workday, Greenhouse, and Lever adapters
- Review-before-fill, nonempty-field protection, no automatic final submit
- Ollama (and optional cloud providers) via the FastAPI backend
- Slim mode (default): scrapers, CRM, analytics, and schedulers disabled

Later stages add a verified Fact Bank, grounded short answers, and a one-page résumé engine.

## Quick start

```bash
cp .env.example .env
uv sync --dev
uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8085
```

1. Open http://127.0.0.1:8085 → Settings
2. Configure profile + AI provider (Ollama recommended: `http://localhost:11434`)
3. Load unpacked extension from `extension/`
4. Open an application form → Fill → review → approve → submit yourself

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `JOBAPPLY_SLIM_MODE` | `true` | Disable scrapers/CRM/scheduler |
| `JOBAPPLY_DB_PATH` | `data/jobapply.db` | SQLite path |
| `JOBAPPLY_HOST` / `JOBAPPLY_PORT` | `0.0.0.0` / `8085` | Server bind |
| `JOBAPPLY_ANTHROPIC_API_KEY` | empty | Optional cloud key |

Legacy `JOBFINDER_*` env vars are accepted as a temporary compatibility shim.

## Tests

```bash
# Stage 1+ backend suite (see CI)
uv run pytest tests/test_config.py tests/test_ai_client.py tests/test_ai_settings.py \
  tests/test_autofill_timeout.py tests/test_profile_extended.py tests/test_facts.py \
  tests/test_answers_engine.py tests/test_resume_engine.py --tb=short

(cd extension && pnpm install && pnpm exec vitest run)
(cd app/static && pnpm install && pnpm exec vitest run)
```

Baseline CareerPulse results: [`docs/baseline-test-report.md`](docs/baseline-test-report.md)  
Stage 1 smoke: [`docs/stage1-smoke.md`](docs/stage1-smoke.md)

## Upstream

```bash
git remote -v
# upstream → https://github.com/tcpsyn/CareerPulse.git
git tag -l 'baseline/*'
# baseline/careerpulse-upstream
```

## License

MIT — retains CareerPulse copyright notices. Additional JobApply contributions are under the same license unless noted.
