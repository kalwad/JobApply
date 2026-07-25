# Extension invariants — pytest wrapper around Node fixture tests.

import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
EXTENSION = ROOT / "extension"
FIXTURES = ROOT / "fixtures"


@pytest.fixture(scope="module")
def extension_node_modules():
    node_modules = EXTENSION / "node_modules"
    if not node_modules.exists():
        subprocess.run(["pnpm", "install"], cwd=EXTENSION, check=True, capture_output=True)
    return node_modules


def test_fixture_html_files_exist():
    for vendor in ("workday", "greenhouse", "lever"):
        path = FIXTURES / vendor / "basic-form.html"
        assert path.exists(), f"Missing fixture: {path}"


def test_extension_invariant_tests_pass(extension_node_modules):
    """Run vitest fixture/adapter invariant suite."""
    result = subprocess.run(
        ["pnpm", "exec", "vitest", "run", "tests/fixtures-extract.test.js", "tests/ats-core.test.js"],
        cwd=EXTENSION,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.fail(
            "Extension invariant tests failed:\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )


@pytest.mark.skipif(
    __import__("importlib").util.find_spec("playwright") is None,
    reason="playwright not installed",
)
def test_playwright_available():
    """Document playwright optional dependency without failing CI."""
    try:
        import playwright  # noqa: F401
        assert True
    except ImportError:
        pytest.skip("playwright not installed; jsdom vitest covers fixture invariants")
