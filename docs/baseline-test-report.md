# Baseline test report (untouched CareerPulse)

Recorded after cloning [tcpsyn/CareerPulse](https://github.com/tcpsyn/CareerPulse) into `jobapply` with no product renames or slim-mode changes.

| Item | Value |
|------|-------|
| Date | 2026-07-24 |
| Upstream commit | `629aa99` — *Extension popup: close on success, error messaging on unreachable tab* |
| Git tag | `baseline/careerpulse-upstream` |
| Frozen branch | `baseline/untouched` |
| Upstream remote | `https://github.com/tcpsyn/CareerPulse.git` |
| Python | CPython 3.14.4 via `uv` |
| Node | v26.0.0 |
| pnpm | 11.17.0 |

## Results

| Suite | Command | Result |
|-------|---------|--------|
| Backend | `uv run pytest --tb=line -q --timeout=15` | **650 passed**, 13 failed, 3 errors (663 collected) in ~546s |
| Extension | `pnpm exec vitest run` (in `extension/`) | **469 passed** (7 files) in ~12.7s |
| Frontend | `pnpm exec vitest run` (in `app/static/`) | **180 passed** (8 files) in ~1.0s |

`pytest-timeout` was used only for the baseline run (not committed) because several scraper tests hung on live/network waits under Python 3.14.

## Backend failures / errors (environment / scrapers)

All failures and errors were in `tests/test_scrapers/` (Indeed, LinkedIn, Dice, Wellfound, BuiltIn). They timed out waiting on network/backoff or left unused `pytest-httpx` mocks. These modules are disabled in JobApply Stage 1 slim mode and are not Stage 1 acceptance criteria.

Non-scraper backend tests in this baseline run completed successfully.

## Notes

- Extension and frontend suites were fully green.
- `LICENSE` remains the CareerPulse MIT license (Copyright 2026 Luke MacNeil / MacNeil Media Group, LLC).
- See [`ATTRIBUTION.md`](../ATTRIBUTION.md) for upstream attribution.
