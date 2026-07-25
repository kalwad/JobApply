"""Browser-level ATS fixture acceptance (review-before-fill, safety invariants)."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from .conftest import SCREENSHOT_DIR, open_ats_fixture, start_fill_via_extension

FIXTURES = ("workday", "greenhouse", "lever")


def _ensure_screenshot_dir() -> Path:
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    return SCREENSHOT_DIR


def _wait_review_overlay(page, timeout=30000):
    page.wait_for_selector(".ja-autofill-approve-btn", timeout=timeout)
    assert page.locator(".ja-autofill-review").count() >= 1
    assert page.locator(".ja-autofill-cancel-btn").count() >= 1


@pytest.mark.parametrize("ats", FIXTURES)
def test_ats_fixture_detect_extract_and_review_cancel(ats_page, extension_context, ats):
    """Cancel leaves the form unchanged (review overlay not bypassed)."""
    open_ats_fixture(ats_page, ats)
    ats_page.wait_for_timeout(800)

    # Snapshot nonempty / preselected controls before fill
    before = ats_page.evaluate(
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

    resp = start_fill_via_extension(extension_context, ats_page)
    assert resp.get("ok") is not False, resp

    _wait_review_overlay(ats_page)
    shot = _ensure_screenshot_dir() / f"{ats}-review-overlay.png"
    ats_page.screenshot(path=str(shot), full_page=True)

    # Proposed values visible for review
    review_text = ats_page.locator(".ja-autofill-review").inner_text()
    assert "Review" in review_text
    assert re.search(r"Ada|Lovelace|ada@|London|Authorized|privacy|terms", review_text, re.I)

    ats_page.click(".ja-autofill-cancel-btn")
    ats_page.wait_for_timeout(500)

    after = ats_page.evaluate(
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
    assert after == before, f"Cancel mutated fields on {ats}"


@pytest.mark.parametrize("ats", FIXTURES)
def test_ats_fixture_approve_fill_and_protections(ats_page, extension_context, ats):
    """Approve fills empty fields while preserving nonempty/EEO/submit protections."""
    open_ats_fixture(ats_page, ats)
    ats_page.wait_for_timeout(800)

    # Capture preserved controls
    preserved = ats_page.evaluate(
        """() => {
          const out = {};
          const email = document.querySelector('#email, #wd-email, #lever-email, input[name="email"]');
          if (email && email.value) out.email = email.value;
          const phone = document.querySelector('#wd-phone, input[name="phone"]');
          if (phone && phone.value) out.phone = phone.value;
          const checkedRadio = document.querySelector('input[type="radio"]:checked');
          if (checkedRadio) out.radio = checkedRadio.name + '=' + checkedRadio.value;
          const eeo = document.querySelector('#race, #wd-gender, #lever-gender, select[name="race"], select[name="gender"]');
          if (eeo) out.eeo = eeo.value;
          const submit = document.querySelector('button[type="submit"], input[type="submit"]');
          if (submit) out.submitText = (submit.value || submit.textContent || '').trim();
          return out;
        }"""
    )

    resp = start_fill_via_extension(extension_context, ats_page)
    assert resp.get("ok") is not False, resp
    _wait_review_overlay(ats_page)
    ats_page.click(".ja-autofill-approve-btn")

    # Wait until filling finishes (do not match "Filling N/M fields" or Review)
    ats_page.wait_for_function(
        """() => {
          if (document.querySelector('.ja-autofill-approve-btn')) return false;
          const body = document.querySelector('#ja-autofill-overlay');
          if (!body) return false;
          const t = body.innerText || '';
          if (/Filling \\d/i.test(t)) return false;
          return /\\d+ filled|Filled \\d|No fillable|cancelled|need manual|Fill report|already set|0 fields/i.test(t);
        }""",
        timeout=90000,
    )

    shot = _ensure_screenshot_dir() / f"{ats}-after-approve.png"
    ats_page.screenshot(path=str(shot), full_page=True)

    state = ats_page.evaluate(
        """() => {
          const q = (sel) => document.querySelector(sel);
          return {
            first: (q('#first_name, #wd-first, #lever-name, input[name="firstName"], input[name="first_name"], input[name="name"]') || {}).value || '',
            last: (q('#last_name, #wd-last, input[name="lastName"], input[name="last_name"]') || {}).value || '',
            email: (q('#email, #wd-email, #lever-email, input[name="email"]') || {}).value || '',
            phone: (q('#wd-phone, #phone, #lever-phone, input[name="phone"]') || {}).value || '',
            eeo: (q('#race, #wd-gender, #lever-gender, select[name="race"], select[name="gender"]') || {}).value || '',
            emptyRadioStillEmpty: !document.querySelector('input[name="work_auth"]:checked')
              && !document.querySelector('input[name="sponsorship"]:checked'),
            terms: !!(q('#wd-terms, #lever-privacy, #newsletter') || {}).checked,
            submitDisabledInteraction: (() => {
              const s = q('button[type="submit"], input[type="submit"]');
              return s ? { text: (s.value || s.textContent || '').trim(), focused: document.activeElement === s } : null;
            })(),
          };
        }"""
    )

    # Text/name filled when empty
    if ats == "lever":
        assert "Ada" in state["first"]
    else:
        assert state["first"] == "Ada" or "Ada" in state["first"]
        if state["last"]:
            assert "Lovelace" in state["last"]

    # Nonempty email/phone preserved
    if preserved.get("email"):
        assert state["email"] == preserved["email"]
    if preserved.get("phone"):
        assert state["phone"] == preserved["phone"]

    # Preselected radio preserved (Greenhouse contact_pref=email)
    if preserved.get("radio"):
        still = ats_page.evaluate(
            """(nameVal) => {
              const [name, value] = nameVal.split('=');
              const el = document.querySelector(`input[type="radio"][name="${name}"][value="${value}"]`);
              return !!(el && el.checked);
            }""",
            preserved["radio"],
        )
        assert still is True

    # EEO untouched (empty / decline)
    if "eeo" in preserved:
        assert state["eeo"] == preserved["eeo"]

    # Submit control never focused / not auto-activated
    if state["submitDisabledInteraction"]:
        assert state["submitDisabledInteraction"]["focused"] is False
        assert re.search(r"submit|application|next", state["submitDisabledInteraction"]["text"], re.I)

    # Fill report / completion text present in overlay
    overlay_text = ats_page.locator("#ja-autofill-overlay").inner_text()
    assert re.search(r"Filled|field|skip|report|manual", overlay_text, re.I)


def test_playwright_is_real_dependency():
    """Fail loudly if Playwright is missing (not an optional skip)."""
    import importlib.metadata

    import playwright

    version = importlib.metadata.version("playwright")
    assert version
    assert playwright is not None
    # Chromium launch is exercised by the extension fixture tests above.
