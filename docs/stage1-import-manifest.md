# Stage 1 import manifest

Branch: `stage1/slim-autofill` (from `origin/main` @ Phase 0)  
Source of Stage 1 code: `grok/stage1-6-checkpoint`  
**Not imported:** Stage 2–6 prototype modules (remain only on WIP/audit branches)

## Complete files — restore from checkpoint (Stage 1 only)

| Path | Reason |
|------|--------|
| `app/config.py` | JOBAPPLY_* + slim_mode (+ later host default 127.0.0.1) |
| `app/routers/autofill.py` | EEO gating, supportingFactIds stub optional keep empty, grounded prompt |
| `app/pdf_generator.py` | JobApply branding metadata |
| `app/static/js/onboarding.js` | JobApply onboarding (no scrape CTA) |
| `app/static/package.json` | jobapply-frontend name |
| `docker-compose.yml` | JOBAPPLY_* naming |
| `docs/stage1-smoke.md` | Stage 1 smoke (will revise) |
| `extension/ats-core.js` | Field helpers + fill reports |
| `extension/ats-adapters.js` | Adapter wrap + fill report export |
| `extension/background.js` | Branding |
| `extension/content.js` | Review-before-fill, nonempty, submit refusal, redacted logs |
| `extension/manifest.json` | JobApply extension identity |
| `extension/normalize.js` | ja- prefix |
| `extension/package.json` | jobapply-extension |
| `extension/popup.html` / `popup.js` / `styles.css` | Branding + review UI styles |
| `extension/tests/*` (except none excluded) | Stage 1 extension tests |
| `fixtures/**` | Workday/Greenhouse/Lever HTML fixtures |
| `pyproject.toml` | package name jobapply |
| `tests/test_config.py` | slim_mode / db path |
| `tests/test_pdf_generator.py` | JobApply creator assert |
| `.env.example` | JOBAPPLY_* (+ host later) |

## Shared files — restore then edit (hunk-level / surgical)

| Path | Keep from checkpoint | Remove / rewrite for Stage 1 |
|------|----------------------|------------------------------|
| `app/main.py` | Slim mode lifespan, settings/autofill/tailoring routers, `/api/meta` | **Exclude** `facts`/`answers`/`resume_engine` routers and feature flags |
| `app/static/index.html` | JobApply branding, Settings-only shell | **Exclude** Fact Bank / Resume Studio nav + scripts |
| `app/static/js/app.js` | Settings-first routing | **Exclude** facts / resume-studio routes |
| `app/static/tests/router.test.js` | Settings-first tests | **Exclude** facts / resume-studio expectations |
| `README.md` | Stage 1 docs rewrite | No Stage 2–6 product claims |
| `.github/workflows/ci.yml` | — | **Rewrite:** Core CI + upstream diagnostic workflow |
| `uv.lock` | Align with pyproject after deps added | — |

## Explicitly excluded (Stages 2–6 — leave on WIP only)

- `app/facts/**`
- `app/answers/**`
- `app/resume_engine/**`
- `app/routers/facts.py`
- `app/routers/answers.py`
- `app/routers/resume_engine.py`
- `app/static/js/views/facts.js`
- `app/static/js/views/resume-studio.js`
- `app/database.py` Fact Bank table/CRUD (keep Phase 0 `database.py`)
- `tests/test_facts.py`
- `tests/test_answers_engine.py`
- `tests/test_resume_engine.py`
- Checkpoint `tests/e2e/test_extension_invariants.py` (replaced by real Playwright suite)

## Security overlays applied on Stage 1 branch (not merely copied)

1. Default bind `127.0.0.1`
2. Redacted extension logging (debug flag)
3. Permissions documentation
4. Cloud-provider disclosure in settings/onboarding docs
