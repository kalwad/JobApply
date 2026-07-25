"""Parse resume text into proposed Fact objects (heuristic + optional AI)."""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import TYPE_CHECKING

from app.facts.schema import Fact, FactCategory

if TYPE_CHECKING:
    from app.ai_client import AIClient

logger = logging.getLogger(__name__)

_SECTION_HEADERS = {
    "experience": FactCategory.WORK_EXPERIENCE,
    "work experience": FactCategory.WORK_EXPERIENCE,
    "employment": FactCategory.WORK_EXPERIENCE,
    "professional experience": FactCategory.WORK_EXPERIENCE,
    "education": FactCategory.EDUCATION,
    "skills": FactCategory.SKILL,
    "technical skills": FactCategory.SKILL,
    "projects": FactCategory.PROJECT,
    "certifications": FactCategory.CERTIFICATION,
    "certificates": FactCategory.CERTIFICATION,
}

_BULLET_RE = re.compile(r"^[\s•\-\*●◦]\s*(.+)$")
_JOB_HEADER_RE = re.compile(
    r"^(.+?)\s*(?:\||@|\bat\b|\-)\s*(.+?)(?:\s*\((\d{4})\s*[-–—]\s*(\d{4}|present|current)\))?$",
    re.IGNORECASE,
)
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.\w+\b")
_PHONE_RE = re.compile(r"(?:\+?\d[\d\s().-]{7,}\d)")
_LINKEDIN_RE = re.compile(r"linkedin\.com/in/[\w-]+", re.IGNORECASE)


def _new_fact(
    text: str,
    category: FactCategory,
    *,
    employer: str | None = None,
    role: str | None = None,
    skills: list[str] | None = None,
    source: str = "resume_import",
    metadata: dict | None = None,
) -> Fact:
    return Fact(
        id=str(uuid.uuid4()),
        category=category,
        text=text.strip(),
        employer=employer,
        role=role,
        skills=skills or [],
        verified=False,
        source=source,
        metadata=metadata or {},
    )


def _detect_section(line: str) -> FactCategory | None:
    cleaned = re.sub(r"[^a-z\s]", "", line.lower()).strip()
    for header, cat in _SECTION_HEADERS.items():
        if cleaned == header or cleaned.startswith(header):
            return cat
    if cleaned.endswith("experience") and "work" in cleaned:
        return FactCategory.WORK_EXPERIENCE
    return None


def _parse_skills_block(text: str) -> list[Fact]:
    raw = re.split(r"[,;|•\n]", text)
    skills = [s.strip() for s in raw if s.strip() and len(s.strip()) > 1]
    facts: list[Fact] = []
    for skill in skills[:40]:
        facts.append(_new_fact(skill, FactCategory.SKILL, metadata={"kind": "skill_token"}))
    return facts


def _parse_contact_lines(lines: list[str]) -> list[Fact]:
    facts: list[Fact] = []
    for line in lines[:8]:
        line = line.strip()
        if not line:
            continue
        email = _EMAIL_RE.search(line)
        if email:
            facts.append(_new_fact(
                f"Email: {email.group()}",
                FactCategory.CONTACT,
                metadata={"field": "email", "value": email.group()},
            ))
        phone = _PHONE_RE.search(line)
        if phone and len(re.sub(r"\D", "", phone.group())) >= 10:
            facts.append(_new_fact(
                f"Phone: {phone.group().strip()}",
                FactCategory.CONTACT,
                metadata={"field": "phone", "value": phone.group().strip()},
            ))
        linkedin = _LINKEDIN_RE.search(line)
        if linkedin:
            facts.append(_new_fact(
                f"LinkedIn: {linkedin.group()}",
                FactCategory.CONTACT,
                metadata={"field": "linkedin", "value": linkedin.group()},
            ))
    return facts


def import_resume_heuristic(resume_text: str) -> list[Fact]:
    """Split resume text into proposed facts using section and bullet heuristics."""
    if not resume_text or not resume_text.strip():
        return []

    lines = [ln.rstrip() for ln in resume_text.splitlines()]
    facts: list[Fact] = []
    facts.extend(_parse_contact_lines(lines))

    current_section: FactCategory | None = None
    current_employer: str | None = None
    current_role: str | None = None
    skill_buffer: list[str] = []

    for raw in lines:
        line = raw.strip()
        if not line:
            continue

        section = _detect_section(line)
        if section:
            if skill_buffer and current_section == FactCategory.SKILL:
                facts.extend(_parse_skills_block(", ".join(skill_buffer)))
                skill_buffer = []
            current_section = section
            current_employer = None
            current_role = None
            continue

        if current_section is None:
            if len(line.split()) <= 6 and not _BULLET_RE.match(line):
                facts.append(_new_fact(line, FactCategory.CONTACT, metadata={"kind": "header_line"}))
            continue

        bullet = _BULLET_RE.match(line)
        if bullet:
            text = bullet.group(1).strip()
            if current_section == FactCategory.WORK_EXPERIENCE:
                facts.append(_new_fact(
                    text,
                    FactCategory.WORK_EXPERIENCE,
                    employer=current_employer,
                    role=current_role,
                    metadata={"kind": "bullet"},
                ))
            elif current_section == FactCategory.PROJECT:
                facts.append(_new_fact(text, FactCategory.PROJECT, metadata={"kind": "bullet"}))
            elif current_section == FactCategory.EDUCATION:
                facts.append(_new_fact(text, FactCategory.EDUCATION, metadata={"kind": "bullet"}))
            else:
                facts.append(_new_fact(text, current_section, metadata={"kind": "bullet"}))
            continue

        if current_section == FactCategory.SKILL:
            skill_buffer.append(line)
            continue

        job_match = _JOB_HEADER_RE.match(line)
        if job_match and current_section == FactCategory.WORK_EXPERIENCE:
            current_role = job_match.group(1).strip()
            current_employer = job_match.group(2).strip()
            date_meta = {}
            if job_match.group(3):
                date_meta["start_year"] = job_match.group(3)
            if job_match.group(4):
                date_meta["end_year"] = job_match.group(4)
            facts.append(_new_fact(
                line,
                FactCategory.WORK_EXPERIENCE,
                employer=current_employer,
                role=current_role,
                metadata={"kind": "job_header", **date_meta},
            ))
            continue

        if current_section == FactCategory.EDUCATION:
            facts.append(_new_fact(line, FactCategory.EDUCATION, metadata={"kind": "education_line"}))
        elif current_section == FactCategory.CERTIFICATION:
            facts.append(_new_fact(line, FactCategory.CERTIFICATION, metadata={"kind": "cert_line"}))
        elif current_section == FactCategory.WORK_EXPERIENCE:
            facts.append(_new_fact(
                line,
                FactCategory.WORK_EXPERIENCE,
                employer=current_employer,
                role=current_role,
                metadata={"kind": "line"},
            ))

    if skill_buffer:
        facts.extend(_parse_skills_block(", ".join(skill_buffer)))

    seen: set[str] = set()
    deduped: list[Fact] = []
    for fact in facts:
        key = (fact.category.value, fact.text.lower(), fact.employer or "", fact.role or "")
        if key in seen:
            continue
        seen.add(key)
        deduped.append(fact)
    return deduped


AI_IMPORT_PROMPT = """Extract resume facts as JSON array. Each item:
{{"category":"work_experience|education|skill|project|certification|contact|other",
  "text":"...", "employer":null|"...", "role":null|"...", "skills":[]}}

Only include facts explicitly supported by the resume. Resume:
{resume}

Return JSON array only."""


async def import_resume_with_ai(
    resume_text: str,
    client: AIClient | None,
) -> list[Fact]:
    """Optional AI enrichment; falls back to heuristics when AI unavailable."""
    heuristic = import_resume_heuristic(resume_text)
    if not client:
        return heuristic

    try:
        prompt = AI_IMPORT_PROMPT.format(resume=resume_text[:12000])
        raw = await client.chat(prompt, max_tokens=4000)
        start = raw.find("[")
        end = raw.rfind("]")
        if start < 0 or end <= start:
            return heuristic
        items = json.loads(raw[start:end + 1])
        ai_facts: list[Fact] = []
        for item in items:
            if not isinstance(item, dict) or not item.get("text"):
                continue
            try:
                cat = FactCategory(item.get("category", "other"))
            except ValueError:
                cat = FactCategory.OTHER
            ai_facts.append(_new_fact(
                item["text"],
                cat,
                employer=item.get("employer"),
                role=item.get("role"),
                skills=item.get("skills") or [],
                source="resume_import_ai",
                metadata={"ai_extracted": True},
            ))
        if not ai_facts:
            return heuristic
        merged = {f.text.lower(): f for f in heuristic}
        for fact in ai_facts:
            merged.setdefault(fact.text.lower(), fact)
        return list(merged.values())
    except Exception:
        logger.exception("AI resume import failed; using heuristics")
        return heuristic


async def import_resume(
    resume_text: str,
    client: AIClient | None = None,
    *,
    use_ai: bool = False,
) -> list[Fact]:
    if use_ai and client:
        return await import_resume_with_ai(resume_text, client)
    return import_resume_heuristic(resume_text)
