# CareerPulse (JobFinder)

Job discovery, matching, and application management platform — scrapes job boards, scores listings against resume with AI, generates tailored resumes/cover letters, tracks applications through a CRM pipeline, and automates follow-ups.

## Running the App
```bash
# Development (uv auto-manages venv and deps)
uv run uvicorn app.main:create_app --factory --reload --host 0.0.0.0 --port 8085

# Docker
docker compose up -d
```

## Tech Stack
- Python (FastAPI), aiosqlite
- AI: Anthropic, OpenAI, Google, OpenRouter, Ollama (configurable via settings UI)
- APScheduler for periodic scraping
- Vanilla JS frontend (served from `app/static/`)

## Key Architecture
- `app/main.py` — FastAPI app assembler: `create_app` factory + lifespan (352 lines)
- `app/routers/` — API routes split into 10 modules: `jobs.py`, `tailoring.py`, `pipeline.py`, `queue.py`, `contacts.py`, `analytics.py`, `settings.py`, `alerts.py`, `scraping.py`, `autofill.py`
- `app/database.py` — async SQLite via aiosqlite (37 tables)
- `app/scrapers/` — job board scrapers (pluggable, 10 sources)
- `app/matcher.py` — AI-powered job/resume matching (supports resume override)
- `app/tailoring.py` — generates tailored resumes/cover letters (supports resume override)
- `app/ai_client.py` — multi-provider AI client (Anthropic, OpenAI, Google, OpenRouter, Ollama)
- `app/pdf_generator.py` — resume/cover letter PDF output
- `app/docx_generator.py` — resume/cover letter DOCX output
- `app/scheduler.py` — periodic scrape cycles, alert checks, follow-up automation
- `app/digest.py` / `app/emailer.py` — email digest notifications
- `app/follow_up.py` — AI-drafted follow-up emails
- `app/predictor.py` — application success prediction
- `app/career_advisor.py` — career trajectory AI analysis
- `app/offer_calculator.py` — offer comparison with cost-of-living normalization
- `app/static/js/salary-calculator.js` — client-side salary calculator (W2/1099/C2C, tax estimation by state, Chart.js visualizations)
- `app/static/js/tax-data.js` — 2025 federal + all 50 state tax brackets and FICA rates
- `extension/` — Chrome extension (Manifest V3): autofill, job board overlays, queue orchestration

## Environment Variables
Required in `.env` (all optional — can configure via UI instead):
- `JOBFINDER_ANTHROPIC_API_KEY` — AI scoring key (Anthropic); use UI for other providers
- `JOBFINDER_USAJOBS_API_KEY` — USAJobs.gov API key (optional, for federal listings)
- `JOBFINDER_DB_PATH` — default: `data/jobfinder.db`
- `JOBFINDER_RESUME_PATH` — default: `data/resume.txt`
- `JOBFINDER_SCRAPE_INTERVAL_HOURS` — default: `6`
- `JOBFINDER_MIN_SALARY` — default: `150000` (annual FTE filter)
- `JOBFINDER_MIN_HOURLY_RATE` — default: `95` (contract rate filter)
- `JOBFINDER_HOST` — default: `0.0.0.0`
- `JOBFINDER_PORT` — default: `8085`

## Testing
```bash
uv run pytest                        # 504 backend tests
cd extension && npx vitest run       # 410 extension tests
```

## Git Remote
- **GitHub**: `https://github.com/tcpsyn/CareerPulse.git` (origin)
