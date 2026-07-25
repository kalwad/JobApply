"""Playwright fixtures: unpacked extension + sanitized ATS HTML fixtures."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
EXTENSION = ROOT / "extension"
FIXTURES = ROOT / "fixtures"

ATS_URLS = {
    "workday": "https://company.myworkdayjobs.com/en-US/careers/job/Apply/applyManual",
    "greenhouse": "https://boards.greenhouse.io/acme/jobs/12345",
    "lever": "https://jobs.lever.co/acme/abc-123/apply",
}


def _fixture_html(name: str) -> str:
    return (FIXTURES / name / "basic-form.html").read_text(encoding="utf-8")


def _build_mappings_from_fields(fields: list) -> list[dict]:
    mappings: list[dict] = []
    seen_radio: set[str] = set()
    for f in fields:
        label = (f.get("label") or f.get("name") or f.get("id") or "").lower()
        selector = f.get("selector") or ""
        current = (f.get("currentValue") or "").strip()
        ftype = (f.get("type") or "").lower()
        name = f.get("name") or ""
        if current and current.lower() not in ("", "select", "select one", "select an option"):
            continue
        if any(k in label for k in ("race", "ethnicity", "gender", "veteran", "disability")):
            mappings.append({
                "selector": selector,
                "value": "",
                "action": "skip",
                "confidence": 0.0,
                "field_label": f.get("label") or label,
                "reason": "EEO skipped unless explicitly enabled",
            })
            continue
        if ftype == "radio" or name in ("work_auth", "sponsorship", "contact_pref"):
            # Only propose fills for empty radio groups (preserve already-selected).
            if name and name not in seen_radio and not current:
                seen_radio.add(name)
                value = "no" if name == "sponsorship" else "yes"
                if name == "contact_pref":
                    continue  # fixture may preselect — never overwrite
                mappings.append({
                    "selector": f'input[name="{name}"][value="{value}"]',
                    "value": value,
                    "action": "click_radio",
                    "confidence": 0.9,
                    "field_label": f.get("label") or name,
                })
            continue
        if ftype == "checkbox" or any(k in label for k in ("terms", "privacy", "newsletter", "agree")):
            # Avoid flaky custom-control paths in CI; text/select coverage is enough here.
            continue
        if "first" in label or name in ("firstName", "first_name"):
            mappings.append({
                "selector": selector,
                "value": "Ada",
                "action": "fill_text",
                "confidence": 0.95,
                "field_label": f.get("label") or "First Name",
            })
        elif "last" in label or name in ("lastName", "last_name"):
            mappings.append({
                "selector": selector,
                "value": "Lovelace",
                "action": "fill_text",
                "confidence": 0.95,
                "field_label": f.get("label") or "Last Name",
            })
        elif re.search(r"\bname\b", label) or name == "name":
            mappings.append({
                "selector": selector,
                "value": "Ada Lovelace",
                "action": "fill_text",
                "confidence": 0.95,
                "field_label": f.get("label") or "Name",
            })
        elif "email" in label or name == "email":
            mappings.append({
                "selector": selector,
                "value": "ada@example.com",
                "action": "fill_text",
                "confidence": 0.95,
                "field_label": f.get("label") or "Email",
            })
        elif "phone" in label:
            mappings.append({
                "selector": selector,
                "value": "555-0199",
                "action": "fill_text",
                "confidence": 0.9,
                "field_label": f.get("label") or "Phone",
            })
        elif "city" in label:
            mappings.append({
                "selector": selector,
                "value": "London",
                "action": "fill_text",
                "confidence": 0.9,
                "field_label": f.get("label") or "City",
            })
        elif "country" in label or "hear about" in label:
            opts = f.get("options") or []
            val = "US"
            for o in opts:
                text = o if isinstance(o, str) else str(o.get("value") or o.get("text") or "")
                if text and text.lower() not in ("", "select", "select one", "select an option"):
                    val = text if isinstance(o, str) else (o.get("value") or text)
                    break
            mappings.append({
                "selector": selector,
                "value": val,
                "action": "select_dropdown",
                "confidence": 0.85,
                "field_label": f.get("label") or label,
            })
        elif "location" in label:
            # Native <select role=combobox> can enter typeahead paths; use select_dropdown + option value.
            mappings.append({
                "selector": selector,
                "value": "nyc",
                "action": "select_dropdown",
                "confidence": 0.85,
                "field_label": f.get("label") or label,
            })
        elif "address" in label:
            mappings.append({
                "selector": selector,
                "value": "1 Analytical Engine Way",
                "action": "fill_text",
                "confidence": 0.85,
                "field_label": f.get("label") or "Address",
            })
        elif "linkedin" in label:
            mappings.append({
                "selector": selector,
                "value": "https://linkedin.com/in/ada",
                "action": "fill_text",
                "confidence": 0.8,
                "field_label": f.get("label") or "LinkedIn",
            })
    return [m for m in mappings if m.get("selector")]


def _mock_jobapply_api(route):
    url = route.request.url
    method = route.request.method.upper()
    if "/api/health" in url:
        route.fulfill(status=200, content_type="application/json", body='{"status":"ok"}')
        return
    if "/api/profile" in url:
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"full_name": "Ada Lovelace", "email": "ada@example.com"}),
        )
        return
    if "/api/custom-qa" in url:
        route.fulfill(status=200, content_type="application/json", body='{"items":[]}')
        return
    if "/api/autofill/analyze" in url and method == "POST":
        try:
            body = route.request.post_data_json or {}
        except Exception:
            body = {}
        fields = body.get("fields") or body.get("structuredFields") or []
        mappings = _build_mappings_from_fields(fields)
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"mappings": mappings, "fill_eeo": False}),
        )
        return
    if "/api/" in url:
        route.fulfill(status=200, content_type="application/json", body="{}")
        return
    route.continue_()


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    return {**browser_context_args, "viewport": {"width": 1280, "height": 900}}


@pytest.fixture
def extension_context(playwright, tmp_path):
    """Chromium persistent context with unpacked JobApply extension loaded."""
    user_data = tmp_path / "chromium-profile"
    user_data.mkdir()
    context = playwright.chromium.launch_persistent_context(
        str(user_data),
        headless=False,
        args=[
            f"--disable-extensions-except={EXTENSION}",
            f"--load-extension={EXTENSION}",
            "--no-first-run",
            "--disable-default-apps",
        ],
        ignore_default_args=["--disable-extensions"],
    )
    context.route("http://localhost:8085/**", _mock_jobapply_api)
    context.route("http://127.0.0.1:8085/**", _mock_jobapply_api)
    yield context
    context.close()


@pytest.fixture
def ats_page(extension_context):
    page = extension_context.new_page()
    yield page
    page.close()


def open_ats_fixture(page, name: str) -> str:
    """Navigate to a realistic ATS URL served with the local sanitized fixture."""
    html = _fixture_html(name)
    url = ATS_URLS[name]
    host = url.split("/")[2]

    def fulfill(route):
        route.fulfill(status=200, content_type="text/html", body=html)

    page.route(f"**://{host}/**", fulfill)
    page.goto(url, wait_until="domcontentloaded")
    return url


def extension_service_worker(extension_context):
    for sw in extension_context.service_workers:
        if sw.url.startswith("chrome-extension://"):
            return sw
    return extension_context.wait_for_event("serviceworker", timeout=15000)


def start_fill_via_extension(extension_context, page):
    """Start fill without awaiting completion (review overlay blocks sendResponse)."""
    page.bring_to_front()
    sw = extension_service_worker(extension_context)
    return sw.evaluate(
        """async () => {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tab = tabs[0];
          if (!tab?.id) return { ok: false, error: 'no tab' };
          try {
            // Do not await — content script only sendResponse after approve/cancel.
            chrome.tabs.sendMessage(tab.id, { type: 'startFill' });
            return { ok: true };
          } catch (e) {
            return { ok: false, error: String(e) };
          }
        }"""
    )


SCREENSHOT_DIR = ROOT / "docs" / "screenshots"
