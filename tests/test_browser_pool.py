import json
import os

import pytest

from app.browser_pool import BrowserPool, get_browser_pool, shutdown_browser_pool, COOKIE_DIR


def test_save_and_load_cookies(tmp_path, monkeypatch):
    monkeypatch.setattr("app.browser_pool.COOKIE_DIR", str(tmp_path / "cookies"))
    pool = BrowserPool()
    cookies = [{"name": "session", "value": "abc123", "domain": "example.com"}]
    pool.save_cookies("example.com", cookies)

    loaded = pool._load_cookies("example.com")
    assert loaded == cookies


def test_load_cookies_missing_file(tmp_path, monkeypatch):
    monkeypatch.setattr("app.browser_pool.COOKIE_DIR", str(tmp_path / "cookies"))
    pool = BrowserPool()
    loaded = pool._load_cookies("nonexistent.com")
    assert loaded == []


def test_load_cookies_corrupted_file(tmp_path, monkeypatch):
    cookie_dir = tmp_path / "cookies"
    cookie_dir.mkdir()
    monkeypatch.setattr("app.browser_pool.COOKIE_DIR", str(cookie_dir))
    (cookie_dir / "bad.com.json").write_text("not json!!!")
    pool = BrowserPool()
    loaded = pool._load_cookies("bad.com")
    assert loaded == []


def test_save_cookies_creates_directory(tmp_path, monkeypatch):
    cookie_dir = tmp_path / "new_cookies"
    monkeypatch.setattr("app.browser_pool.COOKIE_DIR", str(cookie_dir))
    pool = BrowserPool()
    pool.save_cookies("test.com", [{"name": "x", "value": "y"}])
    assert cookie_dir.exists()
    assert (cookie_dir / "test.com.json").exists()


def test_get_browser_pool_singleton(monkeypatch):
    monkeypatch.setattr("app.browser_pool._pool", None)
    pool1 = get_browser_pool()
    pool2 = get_browser_pool()
    assert pool1 is pool2
    monkeypatch.setattr("app.browser_pool._pool", None)


async def test_shutdown_browser_pool_when_none(monkeypatch):
    monkeypatch.setattr("app.browser_pool._pool", None)
    await shutdown_browser_pool()  # should not raise


async def test_shutdown_browser_pool_resets_global(monkeypatch):
    pool = BrowserPool()
    monkeypatch.setattr("app.browser_pool._pool", pool)
    await shutdown_browser_pool()
    import app.browser_pool as bp
    assert bp._pool is None


def test_browser_pool_init():
    pool = BrowserPool()
    assert pool._browser is None
    assert pool._playwright is None
