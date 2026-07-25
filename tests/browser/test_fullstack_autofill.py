"""Full-stack browser acceptance: fixture → extension → real FastAPI → DOM fill.

Does not mock `/api/autofill/analyze`. Uses a seeded local profile and no cloud AI.
Remaining unmatched fields may return without AI; deterministic profile rules cover
Stage 1 contact / work-auth / contact_by_email fields.
"""

from __future__ import annotations

import json
import urllib.request

from .conftest import (
    SCREENSHOT_DIR,
    assert_no_submit,
    open_ats_fixture,
    read_fill_report,
    require_screenshot,
    start_fill_via_extension,
    wait_fill_done,
)


def test_fullstack_greenhouse_real_analyze_endpoint(
    fullstack_extension_context,
    live_backend,
    error_collector,
):
    # Prove the real backend is serving analyze (not a Playwright route mock).
    probe = {
        "fields": [
            {
                "selector": "#first_name",
                "label": "First Name",
                "name": "first_name",
                "type": "text",
                "currentValue": "",
                "tag": "input",
            },
            {
                "selector": 'input[name="sponsorship"][value="no"]',
                "label": "Requires sponsorship?",
                "name": "sponsorship",
                "type": "radio",
                "currentValue": "",
                "tag": "input",
            },
            {
                "selector": "#contact_by_email",
                "label": "Contact me by email",
                "name": "contact_by_email",
                "type": "checkbox",
                "currentValue": "",
                "tag": "input",
            },
        ],
        "page_url": "https://boards.greenhouse.io/acme/jobs/12345",
    }
    req = urllib.request.Request(
        f"{live_backend['base']}/api/autofill/analyze",
        data=json.dumps(probe).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        analyze = json.loads(resp.read().decode("utf-8"))
    assert "mappings" in analyze
    selectors = {m.get("selector") for m in analyze["mappings"]}
    assert "#first_name" in selectors
    # Sponsorship is present but manual unless application country is known.
    sponsor = next(m for m in analyze["mappings"] if "sponsorship" in (m.get("selector") or ""))
    assert sponsor.get("action") == "skip"
    assert sponsor.get("reason") in (
        "application_country_unknown",
        "sponsorship_UNKNOWN_unknown",
        "sponsorship_US_unknown",
    ) or sponsor.get("inventoryCategory") == "legal_or_consent_manual"
    assert any("contact_by_email" in (m.get("selector") or "") or "contact me by email" in (m.get("field_label") or "").lower()
                for m in analyze["mappings"])

    page = fullstack_extension_context.new_page()
    error_collector.attach_page(page)
    try:
        open_ats_fixture(page, "greenhouse")
        page.wait_for_timeout(1000)

        # Trace: extension → real backend analyze during fill
        analyze_hits = {"count": 0, "bodies": []}

        def on_request(request):
            if "/api/autofill/analyze" in request.url and request.method == "POST":
                analyze_hits["count"] += 1
                try:
                    analyze_hits["bodies"].append(request.post_data or "")
                except Exception:
                    pass

        page.on("request", on_request)
        # Also observe from context (service worker fetch)
        fullstack_extension_context.on("request", on_request)

        resp = start_fill_via_extension(fullstack_extension_context, page, error_collector)
        assert resp.get("ok") is not False, resp
        page.wait_for_selector(".ja-autofill-approve-btn", timeout=60000)
        require_screenshot(page, SCREENSHOT_DIR / "fullstack-greenhouse-review.png")

        page.click(".ja-autofill-approve-btn")
        wait_fill_done(page)
        require_screenshot(page, SCREENSHOT_DIR / "fullstack-greenhouse-approve.png")

        assert analyze_hits["count"] >= 1, "expected real /api/autofill/analyze request from extension"

        state = page.evaluate(
            """() => ({
              first: document.querySelector('#first_name')?.value || '',
              last: document.querySelector('#last_name')?.value || '',
              email: document.querySelector('#email')?.value || '',
              sponsorship: document.querySelector('input[name="sponsorship"]:checked')?.value || null,
              contact_pref: document.querySelector('input[name="contact_pref"]:checked')?.value || null,
              contact_email: !!document.querySelector('#contact_by_email')?.checked,
              newsletter: !!document.querySelector('#newsletter')?.checked,
              marketing: !!document.querySelector('#marketing_opt_in')?.checked,
              terms: !!document.querySelector('#gh-terms')?.checked,
              race: document.querySelector('#race')?.value || '',
            })"""
        )
        assert state["first"] == "Ada"
        assert state["last"] == "Lovelace"
        assert state["email"] == "existing@example.com"
        # Generic sponsorship without known job country must stay manual.
        assert state["sponsorship"] is None
        assert state["contact_pref"] == "email"
        assert state["contact_email"] is True
        assert state["newsletter"] is True
        assert state["marketing"] is False
        assert state["terms"] is False
        assert state["race"] == ""

        report_payload = read_fill_report(page)
        (SCREENSHOT_DIR / "fullstack-analyze-trace.json").write_text(
            json.dumps({
                "backend": live_backend["base"],
                "analyze_hits": analyze_hits["count"],
                "probe_mappings": analyze.get("mappings"),
                "fill_report": report_payload["report"],
            }, indent=2),
            encoding="utf-8",
        )

        assert_no_submit(page)
        error_collector.assert_clean()
    finally:
        page.close()
