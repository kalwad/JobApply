"""Heuristic job-description parsing."""

from __future__ import annotations

import re

_SKILL_SPLIT_RE = re.compile(r"[,;/|•\n]+")
_SECTION_KEYWORDS = {
    "requirements": "requirements",
    "qualifications": "requirements",
    "must have": "requirements",
    "required": "requirements",
    "responsibilities": "responsibilities",
    "what you'll do": "responsibilities",
    "about the role": "responsibilities",
    "nice to have": "preferred",
    "preferred": "preferred",
    "bonus": "preferred",
}

_COMMON_SKILLS = {
    "python", "javascript", "typescript", "java", "go", "golang", "rust", "c++", "c#",
    "react", "node", "nodejs", "aws", "gcp", "azure", "kubernetes", "docker", "sql",
    "postgres", "postgresql", "mongodb", "redis", "kafka", "spark", "terraform",
    "machine learning", "deep learning", "nlp", "llm", "fastapi", "django", "flask",
}


def _normalize_skill(token: str) -> str:
    return re.sub(r"\s+", " ", token.strip().lower())


def _extract_years(text: str) -> int | None:
    m = re.search(r"(\d+)\+?\s*(?:years?|yrs?)", text, re.IGNORECASE)
    return int(m.group(1)) if m else None


def parse_job_description(jd_text: str) -> dict:
    """Extract keywords, skills, and structured sections from JD text."""
    if not jd_text or not jd_text.strip():
        return {
            "title_hint": "",
            "sections": {},
            "keywords": [],
            "skills": [],
            "years_experience": None,
        }

    lines = [ln.strip() for ln in jd_text.splitlines() if ln.strip()]
    title_hint = lines[0][:120] if lines else ""

    sections: dict[str, list[str]] = {
        "requirements": [],
        "responsibilities": [],
        "preferred": [],
        "other": [],
    }
    current = "other"

    for line in lines[1:]:
        lower = line.lower()
        matched = False
        for key, section in _SECTION_KEYWORDS.items():
            if key in lower and len(line) < 80:
                current = section
                matched = True
                break
        if matched:
            continue
        sections[current].append(line)

    blob = jd_text.lower()
    skills_found: set[str] = set()
    for skill in _COMMON_SKILLS:
        if re.search(rf"\b{re.escape(skill)}\b", blob):
            skills_found.add(skill)

    for line in sections["requirements"] + sections["preferred"]:
        for token in _SKILL_SPLIT_RE.split(line):
            token = _normalize_skill(token)
            if 2 <= len(token) <= 40 and not token.startswith(("the ", "and ", "or ")):
                if any(c.isalpha() for c in token):
                    skills_found.add(token)

    keywords = sorted(skills_found)
    years = _extract_years(jd_text)

    return {
        "title_hint": title_hint,
        "sections": sections,
        "keywords": keywords,
        "skills": keywords,
        "years_experience": years,
    }
