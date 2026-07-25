"""Progressive one-page resume fitting."""

from __future__ import annotations

import io
from typing import Any

MAX_LINES = 52
MIN_LINES = 50
SUMMARY_MAX_CHARS = 220
BULLET_MAX_CHARS = 160


def _line_count(content: dict) -> int:
    lines = 0
    summary = content.get("summary") or ""
    if summary:
        lines += max(1, len(summary) // 90 + 1)
    for bullet in content.get("experience") or []:
        text = bullet.get("text") if isinstance(bullet, dict) else str(bullet)
        lines += max(1, len(text) // 85 + 1)
    skills = content.get("skills") or ""
    if skills:
        lines += max(1, len(skills) // 90 + 1)
    for edu in content.get("education") or []:
        lines += 1
    return lines


def _compress_text(text: str, max_chars: int) -> str:
    text = " ".join(text.split())
    if len(text) <= max_chars:
        return text
    trimmed = text[: max_chars - 3].rsplit(" ", 1)[0]
    return trimmed + "..."


def fit_one_page(content: dict, *, supporting_scores: dict[str, float] | None = None) -> dict:
    """Progressive fitting: prioritize → compress → prune lowest relevance bullets."""
    working = {
        "summary": content.get("summary") or "",
        "experience": list(content.get("experience") or []),
        "skills": content.get("skills") or "",
        "education": list(content.get("education") or []),
    }
    layout = {"fontSize": 11, "margin": 54, "lineHeight": 14}
    steps: list[str] = []

    def estimate() -> int:
        return _line_count(working)

    if estimate() <= MAX_LINES:
        return {
            "content": working,
            "pageEstimate": estimate(),
            "layout": layout,
            "steps": steps,
            "fitsOnePage": estimate() <= MAX_LINES,
        }

    working["summary"] = _compress_text(working["summary"], SUMMARY_MAX_CHARS)
    steps.append("compressed_summary")

    for bullet in working["experience"]:
        if isinstance(bullet, dict) and bullet.get("text"):
            bullet["text"] = _compress_text(bullet["text"], BULLET_MAX_CHARS)
    steps.append("compressed_bullets")

    if estimate() > MAX_LINES:
        layout["fontSize"] = 10
        layout["lineHeight"] = 13
        steps.append("tightened_layout")

    while estimate() > MAX_LINES and working["experience"]:
        scores = supporting_scores or {}
        working["experience"].sort(
            key=lambda b: scores.get(
                (b.get("supportingFactIds") or [""])[0] if isinstance(b, dict) else "",
                0.0,
            ),
        )
        removed = working["experience"].pop(0)
        steps.append(f"pruned:{(removed.get('text') or '')[:40]}")

    page_estimate = estimate()
    return {
        "content": working,
        "pageEstimate": page_estimate,
        "layout": layout,
        "steps": steps,
        "fitsOnePage": MIN_LINES <= page_estimate <= MAX_LINES or page_estimate <= MAX_LINES,
    }


def pdf_page_count(resume_text: str, name: str = "") -> int | None:
    """Optional PyMuPDF page count when generating PDF."""
    try:
        from app.pdf_generator import generate_resume_pdf
        pdf_bytes = generate_resume_pdf(resume_text, name=name)
        import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        count = doc.page_count
        doc.close()
        return count
    except Exception:
        return None


def render_tailored_text(content: dict) -> str:
    lines = []
    if content.get("summary"):
        lines.append(content["summary"])
        lines.append("")
    if content.get("experience"):
        lines.append("EXPERIENCE")
        for bullet in content["experience"]:
            text = bullet.get("text") if isinstance(bullet, dict) else str(bullet)
            lines.append(f"• {text}")
        lines.append("")
    if content.get("skills"):
        lines.append("SKILLS")
        lines.append(content["skills"])
        lines.append("")
    if content.get("education"):
        lines.append("EDUCATION")
        for edu in content["education"]:
            lines.append(f"• {edu}")
    return "\n".join(lines).strip()
