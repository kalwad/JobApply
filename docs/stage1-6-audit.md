# JobApply Stage 1–6 Implementation Audit

**Status:** Feature-frozen pending review. This document reports evidence only.  
**Audit branch:** `audit/stage1-6`  
**WIP checkpoint:** `grok/stage1-6-checkpoint` @ `5eb922e`  
**Remote:** https://github.com/kalwad/JobApply.git  
**Upstream (CareerPulse):** `upstream` → https://github.com/tcpsyn/CareerPulse.git  
**Baseline tag:** `baseline/careerpulse-upstream` (`629aa99`)  
**Audit date:** 2026-07-24

Accurate summary of current state:

> An initial implementation of Stages 1–6 has been generated, wired together, and passed a selected set of automated tests. Full regression health, live ATS verification, résumé document safety, and production readiness remain open.

This is **not** a production-ready Simplify replacement.

---

## 1. Git audit

### Remotes and branches

| Remote / ref | Value |
|--------------|--------|
| `origin` | https://github.com/kalwad/JobApply.git |
| `upstream` | https://github.com/tcpsyn/CareerPulse.git |
| `main` | Phase 0 only (`c937e36`) — attribution + baseline report |
| `grok/stage1-6-checkpoint` | WIP checkpoint of generated Stage 1–6 tree (`5eb922e`) |
| `audit/stage1-6` | Same commit as checkpoint; used for audit docs |
| `baseline/untouched` | Frozen CareerPulse tip (`629aa99`) |

### Why no implementation commits during the earlier pass

The generating agent produced Stages 1–6 in one working tree and only committed Phase 0 (`ATTRIBUTION.md`, baseline report, `.gitignore`). Implementation remained uncommitted until the explicit WIP checkpoint requested for audit. That checkpoint is **not** an approval commit.

### Diff vs CareerPulse baseline

```
baseline/careerpulse-upstream..HEAD
65 files changed, 3808 insertions(+), 1067 deletions(-)
29 added, 36 modified, 0 deleted, 0 renamed
```

Commits on this line:

1. `c937e36` — Phase 0 baseline docs  
2. `5eb922e` — `wip: checkpoint Grok Stage 1-6 implementation`

### Added files (implementation)

- `app/answers/*`, `app/facts/*`, `app/resume_engine/*`
- `app/routers/{answers,facts,resume_engine}.py`
- `app/static/js/views/{facts,resume-studio}.js`
- `extension/ats-core.js`, related tests
- `fixtures/{workday,greenhouse,lever}/basic-form.html`
- `tests/{test_facts,test_answers_engine,test_resume_engine}.py`
- `tests/e2e/test_extension_invariants.py`
- `docs/stage1-smoke.md` (+ Phase 0 docs)

Working tree at audit start after checkpoint: **clean**.

---

## 2. Test audit

### Original full-suite commands

| Suite | Command | Baseline (Phase 0) | Current full run |
|-------|---------|--------------------|------------------|
| Backend | `uv run pytest --tb=line -q` (audit used `--timeout=15`) | 663 collected; **650 passed**, 13 failed, 3 errors | 686 collected; **636 passed**, 13 failed, 1 skipped, 2 errors |
| Extension | `cd extension && pnpm exec vitest run` | **469 passed** | **486 passed** |
| Frontend | `cd app/static && pnpm exec vitest run` | **180 passed** | **178 passed** |

### New suites

| Suite | Result |
|-------|--------|
| `tests/test_facts.py` + `test_answers_engine.py` + `test_resume_engine.py` | Included in 636; Stage1+ CI subset previously **22 passed** |
| `extension` ats-core + fixtures-extract | Included in 486; fixtures-extract **5/5** verbose |
| `tests/e2e/test_extension_invariants.py` | **2 passed**, **1 skipped** |

### Trimmed CI (important)

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) no longer runs the full backend suite. It runs a curated Stage 1+ file list and `-k "not scraper"`.

**Deselected by CI (not deleted from repo):** essentially all scraper, pipeline, CRM, analytics, enrichment, queue, calendar, and most CareerPulse dashboard tests.

Passing the trimmed CI set **does not** prove fork-wide health.

### Backend full-suite reduction explanation

| Observation | Explanation |
|-------------|-------------|
| Collected 663 → 686 | New tests added (~23) |
| Passed 650 → 636 | Net loss despite new tests; scraper/network timeouts + `pytest-timeout` `INTERNALERROR` interrupted some reporting |
| Failures ~13 | Same class as baseline: `tests/test_scrapers/*` (Indeed/LinkedIn/Dice/Wellfound/BuiltIn) hang/timeout under local network conditions |
| 1 skipped | Playwright optional E2E (see below) |

**No tests were deleted from the repository** to obtain a green CI. CI **scope was reduced**.

### Skipped E2E explained

[`tests/e2e/test_extension_invariants.py`](../tests/e2e/test_extension_invariants.py):

```python
@pytest.mark.skipif(
    find_spec("playwright") is None,
    reason="playwright not installed",
)
def test_playwright_available():
    ...
```

This is **not** a safety invariant test. Real fixture invariants run via Vitest (`fixtures-extract.test.js`). Playwright remains optional and is **not** currently proving live Workday multi-step flows.

### Frontend count drop (180 → 178)

Router tests were rewritten for Settings-first slim navigation; feed/stats/pipeline-specific cases were removed/replaced. Not a silent deletion of product tests for scraping UI behavior—those views are still in the tree but unused in slim mode.

---

## 3. Stage-by-stage evidence

### Stage 1 — Slim autofill fork

| Requirement | Files / functions | Tests / evidence | Status |
|-------------|-------------------|------------------|--------|
| Slim mode disables scrapers/scheduler | `app/config.py` (`slim_mode`), `app/main.py` lifespan + router gating | Runtime: `/api/pipeline` → 404; meta `scraping: false` | **Implemented** |
| Branding JobApply | `extension/manifest.json`, SPA, `pyproject.toml` | Extension/UI strings | **Implemented** |
| Profile CRUD | `app/routers/settings.py`, `Database` profile methods | Runtime profile post/get OK | **Implemented** |
| Custom Q&A | settings custom-qa endpoints | Runtime create/list OK | **Implemented** |
| Ollama provider | `app/ai_client.py` (`_ollama_chat`, `check_ai_reachable`) | Runtime health `ok` against localhost:11434 | **Implemented** (local Ollama was reachable during audit) |
| Review-before-fill | `extension/content.js` `reviewMappingsBeforeFill` | Covered indirectly; skipped in `__jaAutofillTest` | **Partial** (UI path exists; not browser-e2e exercised in audit) |
| Nonempty protection | `fillField` + `getCurrentFieldValue` | Unit tests + autofill analyze skipped filled city | **Implemented** (unit/API); live Workday unproven |
| No auto-submit | `isSubmitControl`, click guards | fixtures-extract refuses submit | **Implemented** (fixture/unit); live unproven |
| EEO not inferred | `app/routers/autofill.py` `_filter_eeo_mappings` | Runtime: race field not filled when `fill_eeo=false` | **Implemented** |
| Fill report | `extension/ats-core.js` `buildFillReport` | ats-core + fixtures-extract tests | **Implemented** |
| ATS fixtures extract | `fixtures/*/basic-form.html` | Workday/Greenhouse/Lever extract tests pass | **Partial** (static HTML only) |

**Known Stage 1 limitations:** no supervised live Workday/Greenhouse/Lever run in this audit; autofill analyze returned `"No AI provider for remaining fields"` when no AI client was attached to the app state in the ASGI lifespan test harness (deterministic fields still mapped).

### Stage 2 — Fact Bank

| Requirement | Evidence | Status |
|-------------|----------|--------|
| Persist facts | SQLite `facts` table; runtime persist across new `Database` connection | **Implemented** |
| Stable IDs | UUID ids; persisted | **Implemented** |
| Unverified not trusted for résumé | `/api/resume/tailor` → 400 until verify | **Implemented** |
| Import not auto-trusted | Importer creates `verified=False` (tests) | **Implemented** |
| Malformed rejection | Pydantic bodies on router | **Partial** (basic validation; not exhaustive) |
| Dependent content invalidation on fact delete | Not proven | **Unimplemented / unproven** |

### Stage 3 — Grounded short answers

| Requirement | Evidence | Status |
|-------------|----------|--------|
| Resolution chain | `generate_answer` in `app/answers/engine.py` | **Implemented** |
| Cite fact IDs | AI path asks for JSON IDs; heuristic flags numbers/employers | **Partial** |
| Reject invalid fact IDs | Not strictly validated against DB set | **Partial / weak** |
| Auto-cite fallback | If model omits IDs, code uses `facts[:3]` — can over-attribute | **Risk / partial** |
| Approve → custom_qa | `approve_answer` | **Implemented** |
| Prompt injection untreated as instructions | Autofill prompt marks form untrusted; answer prompt weaker | **Partial** |
| Demographic never inferred | Deterministic rules exclude EEO; AI path not fully locked | **Partial** |
| Character limits | Not clearly enforced | **Unimplemented / unproven** |

### Stage 4–5 — Résumé tailor + one-page

| Requirement | Evidence | Status |
|-------------|----------|--------|
| JD parse / gaps | `jd_parser.py`, `matcher.py`; runtime gaps for aws/kubernetes | **Implemented** (heuristic) |
| No unsupported skill insert | Matcher gaps; tailor heuristic | **Partial** (heuristic only) |
| Diffs + supportingFactIds | API returns fields; unit tests | **Partial** |
| One-page **fitting loop** | `fit_one_page` uses **line budget** (`MAX_LINES=52`), not PDF page count | **Scaffold / approximate** |
| Actual PDF page count | `pdf_page_count()` via PyMuPDF after render; returned as `pdfPageCount` | **Partial** — available but **not used to drive fitting** |
| Critical contradiction observed | Runtime: `pageEstimate=2` while `pdfPageCount=1` | Proves estimate ≠ measured pages |
| DOCX export path from new engine | `/api/resume/tailor` returns text only; no DOCX path | **Unimplemented** in new engine |
| Min font/margin enforcement on real PDF | Layout dict only (`fontSize`/`margin` numbers); not measured from PDF | **Scaffold** |
| Unreadable one-page refusal | No hard failure when illegible | **Unimplemented** |

### Stage 6 — Fixtures / reliability

| Requirement | Evidence | Status |
|-------------|----------|--------|
| Static ATS fixtures | Present + vitest extract | **Implemented** |
| Playwright live multi-step | Skipped without playwright; no real corpus | **Unimplemented** |
| Conditional fields / iframes / React variants | Not covered beyond existing CareerPulse unit tests | **Partial** (inherited) |

---

## 4. Stage 1 runtime verification (executed)

Harness: ASGI app with `JOBAPPLY_SLIM_MODE=true`, temp SQLite.

| Check | Result |
|-------|--------|
| `/api/meta` | 200; `slim_mode: true` |
| Profile create/read | 200; values persisted |
| Custom Q&A create/read | 200 |
| Fact create unverified | `verified: false` |
| Tailor before verify | **400** expected |
| Fact verify | true |
| Answer “What is your email?” | `audit@example.com` |
| Tailor after verify | 200; gaps for aws/kubernetes; `pdfPageCount: 1`; `pageEstimate: 2` |
| Autofill analyze | First Name mapped; city with value not overwritten; EEO not filled; `fill_eeo: false` |
| Ollama health | **ok** (`http://localhost:11434`) |
| Facts survive new DB connection | yes |
| `/api/pipeline` in slim | **404** |

**Not done in this audit:** unpacked Chrome load, real Workday/Greenhouse/Lever pages, click-through review overlay in a browser.

---

## 5. Integration audit (reachability)

```
Settings UI → /api/profile, /api/custom-qa, AI settings
Fact Bank UI (`#/facts`) → /api/facts/*
Resume Studio UI (`#/resume-studio`) → /api/resume/tailor
Extension popup/content → background → /api/autofill/analyze
Answers API → /api/answers/* (API exists; **no dedicated SPA page** wired beyond raw API)
```

**Modules that exist but are weakly UI-wired:**

- `/api/answers/generate` / `approve` — backend + tests; no first-class Answers review screen in slim nav
- Legacy CareerPulse feed/pipeline/network views — still on disk; hidden by slim router
- New résumé engine does not yet replace all legacy `tailoring.py` download routes

---

## 6. Security and privacy (initial)

| Area | Finding | Severity |
|------|---------|----------|
| Extension host permissions | `localhost:8085` + `<all_urls>` content scripts | Review for least privilege |
| API keys | Stored via settings/DB locally (CareerPulse pattern) | OK if local-only; cloud send needs explicit UX notice |
| Slim local API | Binds `0.0.0.0` by default in settings | Prefer `127.0.0.1` for local-only |
| Logging | Extension logs field extracts to console | Risk of PII in DevTools |
| Cloud providers | Opt-in via settings; not forced | Need clearer “what is sent” copy |
| Path traversal on new tailor API | Returns JSON text; no file path param | Lower risk |
| HTML injection in overlay | Review list uses `escapeHtml` | Good |

---

## 7. Final classification

### Verified capabilities

- CareerPulse fork preserved with MIT/`ATTRIBUTION.md` / upstream remote
- Slim mode disables scraper scheduler and unmounts non-core routers
- Profile + custom Q&A persistence
- Fact Bank CRUD + verify gate for résumé tailor
- Ollama reachability when local server running
- Deterministic autofill mapping + EEO skip without `fill_eeo`
- Extension unit/fixture tests for extract, fill report, submit refusal, nonempty protection
- Gap reporting for missing JD skills (heuristic)

### Partial capabilities

- Review-before-fill (code present; not browser-audited)
- Grounded answers (heuristics + weak auto-cite)
- Résumé tailor (heuristic reorder; AI optional)
- PDF page count (reported, not controlling fit)
- Static ATS fixtures (not live ATS)

### Scaffolds / over-claims

- “One-page optimization” as line-budget pruning + optional post-hoc PDF count
- “End-to-end Stage 6” / production Simplify competitor
- Trimmed CI as proof of full regression health
- Playwright E2E coverage

### Broken / failing under full suite

- Full backend suite still has scraper-related failures/timeouts (same class as baseline)
- Dedicated `tests/test_scrapers` run (timeout=10s): **25 failed**, 76 passed, 5 errors — all in disabled JobApply slim modules:
  - BuiltIn: `test_builtin_detail_fetch_failure_falls_back`
  - Dice: `test_dice_parse`, `test_dice_deduplicates`, `test_dice_handles_empty`, `test_dice_handles_error`
  - Indeed: `test_indeed_handles_error`, `test_indeed_limits_search_terms`, `test_indeed_playwright_*` (4)
  - LinkedIn: `test_linkedin_parse`, `test_linkedin_deduplicates`, `test_linkedin_handles_empty`, `test_linkedin_handles_error`, `test_linkedin_custom_search_terms`
  - Wellfound: parse/filter/403/empty/dedup/multiword (9)
- These do **not** block Stage 1 autofill; they justify keeping scrapers out of default CI, not deleting the tests
- `pytest-timeout` can `INTERNALERROR` during scraper hangs
- Frontend suite green but reduced by 2 vs baseline due to router rewrite

### Manual tests still required

1. Load unpacked extension against running server  
2. Supervised Workday / Greenhouse / Lever applications (stop before submit)  
3. Ollama-backed autofill for open-ended questions  
4. Fact import from real résumé PDF → verify → tailor → open PDF and read  
5. Confirm DOCX/PDF download UX if required for product  
6. Security review of permissions and cloud disclosure  

### Prioritized fixes (before any “complete” claim)

1. **Treat WIP as prototype** — split into reviewable commits only after Stage 1 acceptance  
2. **Restore or justify CI coverage** — full suite in nightly; document deselected tests  
3. **One-page honesty** — drive fit loop from measured `pdf_page_count` or stop claiming one-page validation  
4. **Answer grounding** — reject unknown fact IDs; remove silent `facts[:3]` attribution  
5. **Live ATS supervised runs** for Workday/Greenhouse/Lever  
6. **Answers UI** or explicitly mark API-only  
7. **Bind local server to 127.0.0.1 by default** for privacy  

---

## 8. Recommended next process (not executed here)

Do **not** create one production Stage 1–6 commit.

After fixes for Stage 1 acceptance only, reconstruct small commits from the checkpoint, for example:

1. `chore: preserve CareerPulse baseline and attribution` (exists on `main`)  
2. `chore: rename fork and introduce slim mode`  
3. `feat: harden ATS autofill safety and reporting`  
4. `feat: add verified Fact Bank`  
5. `feat: add grounded answer generation`  
6. `feat: add structured resume tailoring`  
7. `feat: add one-page rendering validation` (only when real)  
8. `test: add ATS fixtures and safety invariants`  
9. `docs: document setup, architecture, and limitations`

Feature development remains **frozen** until this audit is accepted and Stage 1 is re-verified against the original planning acceptance criteria.
