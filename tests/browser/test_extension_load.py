"""Prove the unpacked extension loads without manifest/service-worker errors."""

from __future__ import annotations

from .conftest import extension_service_worker, open_ats_fixture


def test_unpacked_extension_service_worker_starts(extension_context):
    worker = extension_service_worker(extension_context)
    assert worker is not None
    assert worker.url.startswith("chrome-extension://")
    assert "background" in worker.url


def test_extension_injects_on_ats_fixture(ats_page, extension_context):
    errors: list[str] = []
    ats_page.on("pageerror", lambda err: errors.append(str(err)))
    ats_page.on(
        "console",
        lambda msg: errors.append(msg.text) if msg.type == "error" else None,
    )

    open_ats_fixture(ats_page, "greenhouse")
    ats_page.wait_for_timeout(1000)

    sw = extension_service_worker(extension_context)
    result = sw.evaluate(
        """async () => {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tab = tabs[0];
          if (!tab?.id) return { ok: false, error: 'no tab' };
          try {
            const resp = await chrome.tabs.sendMessage(tab.id, { type: 'getStatus' });
            return resp || { ok: false, error: 'empty' };
          } catch (e) {
            return { ok: false, error: String(e) };
          }
        }"""
    )
    assert result.get("ok") is True, f"content script not responding: {result}"
    assert not any("Manifest" in e for e in errors)
