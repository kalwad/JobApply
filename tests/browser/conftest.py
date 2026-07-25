"""Playwright fixtures: unpacked extension + sanitized ATS HTML fixtures."""

from __future__ import annotations

import json
import re
import socket
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

import os

import pytest

ROOT = Path(__file__).resolve().parents[2]
EXTENSION = ROOT / "extension"
FIXTURES = ROOT / "fixtures"
SCREENSHOT_DIR = ROOT / "docs" / "screenshots"

ATS_URLS = {
    "workday": "https://company.myworkdayjobs.com/en-US/careers/job/Apply/applyManual",
    "greenhouse": "https://boards.greenhouse.io/acme/jobs/12345",
    "lever": "https://jobs.lever.co/acme/abc-123/apply",
}

LEGAL_CHECKBOX_RE = re.compile(r"terms|privacy|attest|consent|agree to the", re.I)
EEO_RE = re.compile(r"race|ethnicity|gender|veteran|disability|eeo", re.I)
BENIGN_CONTACT_EMAIL_RE = re.compile(r"contact me by email", re.I)


def _fixture_html(name: str) -> str:
    return (FIXTURES / name / "basic-form.html").read_text(encoding="utf-8")


def _build_mappings_from_fields(fields: list) -> list[dict]:
    """Deterministic Stage 1 mock mappings (isolated browser tests)."""
    mappings: list[dict] = []
    seen_radio: set[str] = set()
    submit_selector = None

    for f in fields:
        label = (f.get("label") or f.get("name") or f.get("id") or "").lower()
        selector = f.get("selector") or ""
        current = (f.get("currentValue") or "").strip()
        ftype = (f.get("type") or "").lower()
        name = f.get("name") or ""
        tag = (f.get("tag") or "").lower()

        if ftype == "submit" or (tag == "button" and "submit" in label):
            submit_selector = selector or "button[type='submit'], input[type='submit']"
            continue

        nonempty = bool(current) and current.lower() not in (
            "", "select", "select one", "select an option", "prefer not to say",
            "decline to self-identify",
        )

        if EEO_RE.search(label) or name in ("race", "gender", "disability"):
            mappings.append({
                "selector": selector,
                "value": "",
                "action": "skip",
                "confidence": 0.0,
                "field_label": f.get("label") or label,
                "reason": "EEO skipped unless explicitly enabled",
            })
            continue

        if ftype == "checkbox" or "checkbox" in label:
            if LEGAL_CHECKBOX_RE.search(label) or name in ("terms", "privacy"):
                mappings.append({
                    "selector": selector,
                    "value": "",
                    "action": "skip",
                    "confidence": 0.0,
                    "field_label": f.get("label") or label,
                    "reason": "manual review — legal attestation",
                })
                continue
            if BENIGN_CONTACT_EMAIL_RE.search(label) or name == "contact_by_email":
                mappings.append({
                    "selector": selector,
                    "value": "yes",
                    "action": "check_checkbox",
                    "confidence": 0.95,
                    "field_label": f.get("label") or "Contact me by email",
                })
                continue
            if nonempty or name in ("receive_sms", "newsletter"):
                # Propose overwrite; nonempty protection must preserve prechecked boxes.
                mappings.append({
                    "selector": selector,
                    "value": "yes",
                    "action": "check_checkbox",
                    "confidence": 0.9,
                    "field_label": f.get("label") or name or "checkbox",
                })
                continue
            # marketing_opt_in / false preference → leave unmapped (remains unchecked)
            continue

        if ftype == "radio" or name in (
            "work_auth", "sponsorship", "contact_pref", "favorite_color",
            "shirt_size", "team_color", "disability",
        ):
            if name in seen_radio:
                continue
            seen_radio.add(name)
            if name in ("favorite_color", "shirt_size", "team_color"):
                # No trusted profile source — leave untouched (do not map)
                continue
            if name == "disability":
                mappings.append({
                    "selector": selector,
                    "value": "",
                    "action": "skip",
                    "confidence": 0.0,
                    "field_label": f.get("label") or name,
                    "reason": "EEO skipped unless explicitly enabled",
                })
                continue
            if name == "contact_pref" and nonempty:
                # Target the already-selected radio; nonempty protection must keep it.
                mappings.append({
                    "selector": 'input[name="contact_pref"][value="email"]',
                    "value": "phone",
                    "action": "click_radio",
                    "confidence": 0.9,
                    "field_label": "Preferred contact",
                })
                continue
            if name == "work_auth":
                mappings.append({
                    "selector": 'input[name="work_auth"][value="yes"]',
                    "value": "yes",
                    "action": "click_radio",
                    "confidence": 0.95,
                    "field_label": "Authorized to work in the US?",
                })
                continue
            if name == "sponsorship":
                mappings.append({
                    "selector": 'input[name="sponsorship"][value="no"]',
                    "value": "no",
                    "action": "click_radio",
                    "confidence": 0.95,
                    "field_label": "Requires sponsorship?",
                })
                continue
            continue

        if "first" in label or name in ("firstName", "first_name"):
            mappings.append({
                "selector": selector, "value": "Ada", "action": "fill_text",
                "confidence": 0.95, "field_label": f.get("label") or "First Name",
            })
        elif "last" in label or name in ("lastName", "last_name"):
            mappings.append({
                "selector": selector, "value": "Lovelace", "action": "fill_text",
                "confidence": 0.95, "field_label": f.get("label") or "Last Name",
            })
        elif re.search(r"\bname\b", label) or name == "name":
            mappings.append({
                "selector": selector, "value": "Ada Lovelace", "action": "fill_text",
                "confidence": 0.95, "field_label": f.get("label") or "Name",
            })
        elif "email" in label or name == "email":
            # Even when nonempty, propose a replacement so preservation is counted.
            mappings.append({
                "selector": selector, "value": "ada@example.com", "action": "fill_text",
                "confidence": 0.95, "field_label": f.get("label") or "Email",
            })
        elif "phone" in label:
            mappings.append({
                "selector": selector, "value": "555-0199", "action": "fill_text",
                "confidence": 0.9, "field_label": f.get("label") or "Phone",
            })

    # Deliberately include submit so refusal is exercised and counted.
    mappings.append({
        "selector": submit_selector or "button[type='submit'], input[type='submit']",
        "value": "clicked",
        "action": "fill_text",
        "confidence": 1.0,
        "field_label": "Submit Application",
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
            body=json.dumps({
                "full_name": "Ada Lovelace",
                "email": "ada@example.com",
                "authorized_to_work_us": "Yes",
                "requires_sponsorship": "No",
                "contact_by_email": "yes",
            }),
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


@dataclass
class ErrorCollector:
    page_errors: list[str] = field(default_factory=list)
    console_errors: list[str] = field(default_factory=list)
    worker_errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def attach_page(self, page) -> None:
        page.on("pageerror", lambda err: self.page_errors.append(str(err)))
        page.on("console", self._on_console)

    def attach_worker(self, worker) -> None:
        worker.on("console", self._on_worker_console)

    def _on_console(self, msg) -> None:
        text = msg.text
        if msg.type == "error":
            if _ignorable_console(text):
                self.warnings.append(text)
            else:
                self.console_errors.append(text)
        elif msg.type == "warning":
            self.warnings.append(text)

    def _on_worker_console(self, msg) -> None:
        text = msg.text
        if msg.type == "error":
            if _ignorable_console(text):
                self.warnings.append(f"sw: {text}")
            else:
                self.worker_errors.append(text)

    def assert_clean(self) -> None:
        fatal = self.page_errors + self.console_errors + self.worker_errors
        assert not fatal, "Uncaught extension/page errors:\n" + "\n".join(fatal)


def _ignorable_console(text: str) -> bool:
    # Chromium noise that is not an extension failure
    needles = (
        "favicon.ico",
        "Download the React DevTools",
        "Third-party cookie",
        "net::ERR_FAILED",
        "ResizeObserver loop",
    )
    return any(n.lower() in text.lower() for n in needles)


def require_screenshot(page, path: Path, *, retries: int = 3) -> None:
    """Required acceptance screenshot — fails if the file cannot be produced."""
    path.parent.mkdir(parents=True, exist_ok=True)
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            page.screenshot(path=str(path), full_page=False, timeout=15000)
            if path.exists() and path.stat().st_size > 0:
                return
            last_err = RuntimeError(f"screenshot empty: {path}")
        except Exception as exc:  # noqa: BLE001 — retry then fail
            last_err = exc
            page.wait_for_timeout(500 * (attempt + 1))
    raise AssertionError(f"Required screenshot failed for {path}: {last_err}")


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    return {**browser_context_args, "viewport": {"width": 1280, "height": 900}}


def _launch_extension_context(playwright, tmp_path, *, mock_api: bool = True):
    user_data = tmp_path / ("chromium-profile-mock" if mock_api else "chromium-profile-live")
    user_data.mkdir(exist_ok=True)
    context = playwright.chromium.launch_persistent_context(
        str(user_data),
        headless=False,
        args=[
            f"--disable-extensions-except={EXTENSION}",
            f"--load-extension={EXTENSION}",
            "--no-first-run",
            "--disable-default-apps",
            "--disable-notifications",
            "--disable-features=NotificationTriggers,PermissionElement",
            "--deny-permission-prompts",
        ],
        ignore_default_args=["--disable-extensions"],
    )
    if mock_api:
        context.route("http://localhost:8085/**", _mock_jobapply_api)
        context.route("http://127.0.0.1:8085/**", _mock_jobapply_api)
    return context


@pytest.fixture
def error_collector():
    return ErrorCollector()


@pytest.fixture
def extension_context(playwright, tmp_path, error_collector):
    """Chromium persistent context with unpacked JobApply extension + mocked API."""
    context = _launch_extension_context(playwright, tmp_path, mock_api=True)
    try:
        yield context
    finally:
        context.close()


@pytest.fixture
def ats_page(extension_context, error_collector):
    page = extension_context.new_page()
    error_collector.attach_page(page)
    try:
        yield page
    finally:
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
    # Ensure submit sentinels exist even if script was blocked
    page.evaluate(
        """() => {
          if (typeof window.__submitEventCount !== 'number') {
            window.__submitEventCount = 0;
            window.__submitButtonClickCount = 0;
            window.__requestSubmitCount = 0;
          }
        }"""
    )
    return url


def extension_service_worker(extension_context, error_collector: ErrorCollector | None = None):
    for sw in extension_context.service_workers:
        if sw.url.startswith("chrome-extension://"):
            if error_collector:
                error_collector.attach_worker(sw)
            return sw
    worker = extension_context.wait_for_event("serviceworker", timeout=15000)
    if error_collector:
        error_collector.attach_worker(worker)
    return worker


def start_fill_via_extension(extension_context, page, error_collector: ErrorCollector | None = None):
    """Start fill without awaiting completion (review overlay blocks sendResponse)."""
    page.bring_to_front()
    sw = extension_service_worker(extension_context, error_collector)
    return sw.evaluate(
        """async () => {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tab = tabs[0];
          if (!tab?.id) return { ok: false, error: 'no tab' };
          try {
            chrome.tabs.sendMessage(tab.id, { type: 'startFill' });
            return { ok: true };
          } catch (e) {
            return { ok: false, error: String(e) };
          }
        }"""
    )


def submit_counters(page) -> dict:
    return page.evaluate(
        """() => ({
          submitEventCount: window.__submitEventCount || 0,
          submitButtonClickCount: window.__submitButtonClickCount || 0,
          requestSubmitCount: window.__requestSubmitCount || 0,
        })"""
    )


def assert_no_submit(page) -> None:
    counts = submit_counters(page)
    assert counts["submitEventCount"] == 0, counts
    assert counts["submitButtonClickCount"] == 0, counts
    assert counts["requestSubmitCount"] == 0, counts


def wait_fill_done(page, timeout=90000):
    page.wait_for_function(
        """() => {
          if (document.querySelector('.ja-autofill-approve-btn')) return false;
          const body = document.querySelector('#ja-autofill-overlay');
          if (!body) return false;
          const t = body.innerText || '';
          if (/Filling \\d/i.test(t)) return false;
          return body.dataset.fillReport || /\\d+ filled|already set|sensitive skipped|0 fields|manual/i.test(t);
        }""",
        timeout=timeout,
    )


def read_fill_report(page) -> dict:
    raw = page.evaluate(
        """() => {
          const el = document.querySelector('#ja-autofill-overlay');
          if (!el || !el.dataset.fillReport) return null;
          return {
            report: JSON.parse(el.dataset.fillReport),
            results: JSON.parse(el.dataset.fillResults || '[]'),
            text: el.innerText || '',
          };
        }"""
    )
    assert raw and raw.get("report"), "fill report dataset missing on overlay"
    return raw


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture
def live_backend(tmp_path):
    """Real FastAPI server on a free port with seeded Stage 1 profile (no cloud AI)."""
    db_path = tmp_path / "live-jobapply.db"
    port = 8085  # extension default; keep stable for this process
    # If 8085 is busy, fall back and configure extension storage later.
    try:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 8085))
    except OSError:
        port = _free_port()

    env = {
        **os.environ,
        "JOBAPPLY_SLIM_MODE": "true",
        "JOBAPPLY_HOST": "127.0.0.1",
        "JOBAPPLY_PORT": str(port),
        "JOBAPPLY_DB_PATH": str(db_path),
    }

    # Seed DB then serve
    seed = subprocess.run(
        [
            "uv", "run", "python", "-c",
            f"""
import asyncio
from app.database import Database
async def main():
    db = Database({str(db_path)!r})
    await db.init()
    await db.save_user_profile(
        full_name='Ada Lovelace',
        email='ada@example.com',
        phone='555-0199',
        authorized_to_work_us='Yes',
        requires_sponsorship='No',
        contact_by_email='yes',
        address_city='London',
    )
    await db.close()
asyncio.run(main())
""",
        ],
        cwd=str(ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert seed.returncode == 0, seed.stdout + seed.stderr

    proc = subprocess.Popen(
        [
            "uv", "run", "uvicorn", "app.main:create_app", "--factory",
            "--host", "127.0.0.1", "--port", str(port),
        ],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    # Wait for health
    import urllib.request

    health_url = f"http://127.0.0.1:{port}/api/meta"
    ready = False
    for _ in range(50):
        if proc.poll() is not None:
            out = proc.stdout.read() if proc.stdout else ""
            raise RuntimeError(f"backend exited early: {out}")
        try:
            with urllib.request.urlopen(health_url, timeout=0.5) as resp:
                if resp.status == 200:
                    ready = True
                    break
        except Exception:
            time.sleep(0.2)
    assert ready, "live backend failed to become healthy"
    try:
        yield {"port": port, "db_path": db_path, "base": f"http://127.0.0.1:{port}"}
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


@pytest.fixture
def fullstack_extension_context(playwright, tmp_path, live_backend, error_collector):
    """Extension context talking to the real local FastAPI backend (no analyze mock)."""
    context = _launch_extension_context(playwright, tmp_path, mock_api=False)
    # Point extension at the live server if not on default port
    sw = None
    try:
        for _ in range(30):
            for candidate in context.service_workers:
                if candidate.url.startswith("chrome-extension://"):
                    sw = candidate
                    break
            if sw:
                break
            time.sleep(0.2)
        if sw is None:
            sw = context.wait_for_event("serviceworker", timeout=15000)
        error_collector.attach_worker(sw)
        if live_backend["port"] != 8085:
            sw.evaluate(
                """async (url) => { await chrome.storage.local.set({ serverUrl: url }); }""",
                live_backend["base"],
            )
        else:
            sw.evaluate(
                """async () => { await chrome.storage.local.set({ serverUrl: 'http://localhost:8085' }); }"""
            )
        yield context
    finally:
        context.close()
