"""Browser-level ATS fixture acceptance (review-before-fill, safety invariants).

Screenshots are pre-fill / post-action evidence on synthetic local ATS fixtures —
not live Workday/Greenhouse/Lever verification.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from .conftest import (
    SCREENSHOT_DIR,
    assert_no_submit,
    open_ats_fixture,
    read_fill_report,
    require_screenshot,
    start_fill_via_extension,
    submit_counters,
    wait_fill_done,
)

FIXTURES = ("workday", "greenhouse", "lever")


def _shot(name: str) -> Path:
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    return SCREENSHOT_DIR / name


def _wait_review(page, timeout=30000):
    page.wait_for_selector(".ja-autofill-approve-btn", timeout=timeout)
    # Review mode: overlay gets ja-autofill-overlay-review; body uses review-panel.
    assert (
        page.locator(".ja-autofill-overlay-review").count() >= 1
        or page.locator(".ja-autofill-review-panel").count() >= 1
        or page.locator(".ja-autofill-review").count() >= 1
    )


def _dom_snapshot(page) -> dict:
    return page.evaluate(
        """() => {
          const data = {};
          for (const el of document.querySelectorAll('input, select, textarea')) {
            const key = el.id || el.name || el.getAttribute('aria-label') || el.outerHTML.slice(0, 40);
            if (el.type === 'radio' || el.type === 'checkbox') data[key] = !!el.checked;
            else data[key] = el.value || '';
          }
          return data;
        }"""
    )


def _field_state(page) -> dict:
    return page.evaluate(
        """() => {
          const checked = (name) => {
            const el = document.querySelector(`input[type="radio"][name="${name}"]:checked`);
            return el ? el.value : null;
          };
          const box = (sel) => {
            const el = document.querySelector(sel);
            return el ? !!el.checked : null;
          };
          return {
            first: (document.querySelector('#first_name, #wd-first, #lever-name, input[name="firstName"], input[name="first_name"], input[name="name"]') || {}).value || '',
            last: (document.querySelector('#last_name, #wd-last, input[name="lastName"], input[name="last_name"]') || {}).value || '',
            email: (document.querySelector('#email, #wd-email, #lever-email, input[name="email"]') || {}).value || '',
            phone: (document.querySelector('#wd-phone, #phone, #lever-phone, input[name="phone"]') || {}).value || '',
            work_auth: checked('work_auth'),
            sponsorship: checked('sponsorship'),
            contact_pref: checked('contact_pref'),
            favorite_color: checked('favorite_color'),
            shirt_size: checked('shirt_size'),
            team_color: checked('team_color'),
            disability: checked('disability'),
            contact_by_email: box('#wd-contact-email, #contact_by_email, #lever-contact-email, input[name="contact_by_email"]'),
            prechecked: box('#wd-sms, #newsletter, #lever-sms, input[name="receive_sms"], input[name="newsletter"]'),
            marketing: box('#wd-marketing, #marketing_opt_in, #lever-marketing, input[name="marketing_opt_in"]'),
            legal: box('#wd-terms, #gh-terms, #lever-privacy, input[name="terms"], input[name="privacy"]'),
            eeo_select: (document.querySelector('#race, #wd-gender, #lever-gender, select[name="race"], select[name="gender"]') || {}).value || '',
          };
        }"""
    )


@pytest.mark.parametrize("ats", FIXTURES)
def test_ats_fixture_review_cancel_no_submit(ats_page, extension_context, error_collector, ats):
    """Cancel leaves DOM unchanged; submit sentinels stay at zero."""
    open_ats_fixture(ats_page, ats)
    ats_page.wait_for_timeout(800)
    before = _dom_snapshot(ats_page)
    before_counts = submit_counters(ats_page)

    resp = start_fill_via_extension(extension_context, ats_page, error_collector)
    assert resp.get("ok") is not False, resp
    _wait_review(ats_page)

    # Label accurately: pre-fill review on synthetic fixture
    require_screenshot(ats_page, _shot(f"{ats}-review-overlay.png"))

    review_root = ats_page.locator(
        ".ja-autofill-review-panel, .ja-autofill-overlay-review, .ja-autofill-review"
    ).first
    review_text = review_root.inner_text()
    assert "Review" in review_text
    assert re.search(r"Ada|Lovelace|ada@|Contact me by email|Authorized|sponsorship", review_text, re.I)

    ats_page.click(".ja-autofill-cancel-btn")
    ats_page.wait_for_timeout(500)
    require_screenshot(ats_page, _shot(f"{ats}-cancel-result.png"))

    assert _dom_snapshot(ats_page) == before
    assert submit_counters(ats_page) == before_counts
    assert_no_submit(ats_page)
    error_collector.assert_clean()


@pytest.mark.parametrize("ats", FIXTURES)
def test_ats_fixture_approve_controls_report_and_submit(ats_page, extension_context, error_collector, ats):
    """Approve fills trusted empties; preserves nonempty; exact report; no submit."""
    open_ats_fixture(ats_page, ats)
    ats_page.wait_for_timeout(800)
    before = _field_state(ats_page)

    resp = start_fill_via_extension(extension_context, ats_page, error_collector)
    assert resp.get("ok") is not False, resp
    _wait_review(ats_page)
    ats_page.click(".ja-autofill-approve-btn")
    wait_fill_done(ats_page)

    require_screenshot(ats_page, _shot(f"{ats}-after-approve.png"))
    require_screenshot(ats_page, _shot(f"{ats}-fill-report.png"))

    state = _field_state(ats_page)
    report_payload = read_fill_report(ats_page)
    report = report_payload["report"]
    results = report_payload["results"]

    # --- text fills ---
    if ats == "lever":
        assert "Ada" in state["first"]
    else:
        assert state["first"] == "Ada"
        assert "Lovelace" in state["last"]

    # nonempty preserved
    if before["email"]:
        assert state["email"] == before["email"]
    if before["phone"]:
        assert state["phone"] == before["phone"]

    # --- radios ---
    if ats in ("workday", "lever"):
        assert state["work_auth"] == "yes", "empty trusted work_auth must fill after approve"
    if ats == "greenhouse":
        assert state["sponsorship"] == "no", "empty trusted sponsorship must fill after approve"
        assert state["contact_pref"] == "email", "existing radio must be preserved"
        assert state["shirt_size"] is None, "radio without trusted source must stay empty"
    if ats == "workday":
        assert state["favorite_color"] is None
    if ats == "lever":
        assert state["team_color"] is None
    assert state["disability"] is None, "EEO radio untouched without fill_eeo"

    # --- checkboxes ---
    assert state["contact_by_email"] is True, "benign empty contact_by_email must check"
    assert state["prechecked"] is True, "prechecked checkbox must remain checked"
    assert state["marketing"] is False, "false/unmapped preference must remain unchecked"
    assert state["legal"] is False, "legal attestation must not auto-check"
    assert state["eeo_select"] == before["eeo_select"]

    # --- submit sentinels ---
    assert_no_submit(ats_page)

    # --- exact fill report (mocked analyze path) ---
    expected = {
        "workday": {"filled": 5, "alreadyCompleted": 2, "skippedSensitive": 4, "needsReview": 1, "failed": 0},
        "greenhouse": {"filled": 5, "alreadyCompleted": 3, "skippedSensitive": 3, "needsReview": 1, "failed": 0},
        "lever": {"filled": 4, "alreadyCompleted": 2, "skippedSensitive": 3, "needsReview": 1, "failed": 0},
    }[ats]
    for key, value in expected.items():
        assert report[key] == value, f"{ats} report[{key}]={report.get(key)} expected {value}; full={report}"

    # Named field categories from results
    by_label = " ".join(
        f"{(r.get('field_label') or '')} {(r.get('selector') or '')} {(r.get('reason') or '')}"
        for r in results
    ).lower()
    assert "submit" in by_label
    assert any(r.get("skipped") and re.search(r"submit", r.get("reason") or "", re.I) for r in results)
    assert any(r.get("skipped") and re.search(r"manual review", r.get("reason") or "", re.I) for r in results)
    assert any(r.get("skipped") and re.search(r"eeo", r.get("reason") or "", re.I) for r in results)

    # Persist machine-readable evidence next to screenshots
    evidence = _shot(f"{ats}-fill-report.json")
    evidence.write_text(json.dumps(report_payload, indent=2), encoding="utf-8")

    error_collector.assert_clean()


def test_playwright_is_real_dependency():
    import importlib.metadata
    import playwright

    assert importlib.metadata.version("playwright")
    assert playwright is not None
