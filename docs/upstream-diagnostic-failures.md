# Upstream diagnostic failures (inherited CareerPulse)

JobApply Stage 1 runs in `JOBAPPLY_SLIM_MODE=true` by default. Scrapers, CRM, scheduler, and unrelated analytics routes are disabled and are **not** Stage 1 merge gates.

The workflow `.github/workflows/ci-upstream-diagnostic.yml` runs the full inherited backend suite on a schedule / `workflow_dispatch` so those failures stay visible.

## Expected failure class

Most full-suite failures are scraper/network tests that need live sites, browser automation credentials, or optional Playwright scraper paths. They already existed in the CareerPulse baseline (`baseline/careerpulse-upstream`).

Examples (non-exhaustive; see the latest diagnostic artifact for the current list):

- Indeed / LinkedIn / board scrapers timing out or hitting bot challenges
- Enrichment paths that call external pages
- Tests that assume scrapers or schedulers are mounted

## Honest reporting

- **Required JobApply Core CI** green ≠ “entire repository green”
- Upstream diagnostic may be red while Stage 1 remains acceptable
- Do not hide these failures with broad `-k not scraper` filters in Core CI

## Stage 1 stance

Disabled modules remain in the tree for later non-slim use. They must not block Stage 1 acceptance.
