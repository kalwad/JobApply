"""Resume analysis helpers (Stage 1: draft-only; not a verified ATS checker)."""

from __future__ import annotations

import logging
import re
from datetime import date
from typing import Any

from app.ai_client import AIClient, parse_json_response

logger = logging.getLogger(__name__)

SENIORITY_LEVELS = (
    "intern",
    "entry",
    "junior",
    "mid",
    "senior",
    "staff",
    "lead",
    "principal",
    "unknown",
)

# Cap inferred seniority unless total professional years justify higher levels.
_SENIORITY_BY_YEARS = (
    (0.5, "intern"),
    (1.5, "entry"),
    (3.0, "junior"),
    (6.0, "mid"),
    (10.0, "senior"),
    (14.0, "staff"),
    (18.0, "lead"),
    (999.0, "principal"),
)

PROFILE_PARSE_PROMPT = """Extract structured profile data from this resume. Pull out every fact you can find.

TODAY'S DATE (authoritative — do not invent document creation dates): {today}

RESUME:
{resume}

Return ONLY valid JSON with this exact structure (use null for fields not found):
{{
    "personal": {{
        "first_name": "...",
        "last_name": "...",
        "email": "...",
        "phone": "...",
        "address_city": "...",
        "address_state": "...",
        "address_country_name": "...",
        "linkedin_url": "...",
        "github_url": "...",
        "portfolio_url": "...",
        "website_url": "..."
    }},
    "work_history": [
        {{
            "job_title": "...",
            "company": "...",
            "location_city": "...",
            "location_state": "...",
            "start_month": 1,
            "start_year": 2020,
            "end_month": null,
            "end_year": null,
            "is_current": 1,
            "description": "Brief summary of role and key achievements"
        }}
    ],
    "education": [
        {{
            "school": "...",
            "degree_type": "bachelors",
            "field_of_study": "...",
            "grad_year": 2018,
            "gpa": null
        }}
    ],
    "skills": [
        {{
            "name": "...",
            "years_experience": null,
            "proficiency": "advanced"
        }}
    ],
    "certifications": [
        {{
            "name": "...",
            "issuing_org": "...",
            "date_obtained": "2023-01-01"
        }}
    ],
    "languages": [
        {{
            "language": "English",
            "proficiency": "native"
        }}
    ]
}}

Rules:
- Extract ALL work history entries, ordered most recent first
- For skills, extract technical skills, tools, frameworks, and languages mentioned
- proficiency for skills: beginner/intermediate/advanced/expert (infer from context)
- degree_type must be one of: high_school, associates, bachelors, masters, mba, jd, md, phd, other
- language proficiency: native/fluent/conversational/basic
- For work history descriptions, summarize key responsibilities and achievements in 1-3 sentences
- Use null (not empty string) for fields not found in the resume
- Do NOT fabricate data — only extract what is explicitly stated
- Never invent PDF/file creation dates or claim the resume was written in a past year"""


ANALYSIS_PROMPT = """Analyze this resume for career-fit suggestions. Results are DRAFT suggestions for human review — not automated search configuration.

TODAY'S DATE (authoritative): {today}
OPTIONAL TARGET TRACKS (user-selected; empty means none): {target_tracks}

RESUME:
{resume}

Return ONLY valid JSON with this exact structure:
{{
    "search_terms": ["short role title 1", "short role title 2"],
    "job_titles": [
        {{
            "title": "Example Role Title",
            "why": "Evidence from the resume (roles, years, skills) supporting this title",
            "evidence": ["quoted or paraphrased resume evidence"]
        }}
    ],
    "key_skills": ["skill 1", "skill 2"],
    "seniority": "unknown",
    "summary": "Brief 2-3 sentence summary grounded only in the resume text.",
    "content_heuristic_score": 70,
    "content_issues": ["issue grounded in extracted text only"],
    "content_tips": ["tip grounded in extracted text only"]
}}

Guidelines:
- seniority MUST be exactly one of: intern, entry, junior, mid, senior, staff, lead, principal, unknown
- Prefer unknown or mid when years of professional experience are unclear or limited. Do not default to senior.
- search_terms and job_titles are SUGGESTIONS only. Use short recruiter-facing titles (1-4 words).
- Cover a NEUTRAL mix of fields when evidence supports them (software, data/analytics, business, QA, infrastructure, research, etc.). Do not bias toward DevOps/Kubernetes/MLOps/Cloud Architect.
- Every job_titles entry MUST include evidence from the resume. If evidence is weak, omit the title.
- content_heuristic_score is a 0-100 CONTENT heuristic from extracted text only — NOT a real ATS parse of fonts, layout, pages, or reading order.
- Do NOT require a Summary section. Do NOT invent file creation dates. Do NOT claim jobs are future-dated unless a date is after TODAY'S DATE.
- For tense tips: suggest past tense for completed roles; present tense is fine for current roles.
- Do NOT append remote/full-time/location filters to search terms."""


async def parse_resume_to_profile(client: AIClient, resume_text: str, today: date | None = None) -> dict:
    try:
        as_of = today or date.today()
        prompt = PROFILE_PARSE_PROMPT.format(resume=resume_text, today=as_of.isoformat())
        raw = await client.chat(prompt, max_tokens=4000)
        result = parse_json_response(raw)
        return result if isinstance(result, dict) else {}
    except Exception as e:
        logger.error(f"Resume profile parse failed: {e}")
        return {}


def _month_year_to_date(month: Any, year: Any) -> date | None:
    try:
        y = int(year)
        m = int(month) if month not in (None, "", 0) else 1
        if m < 1 or m > 12:
            m = 1
        return date(y, m, 1)
    except (TypeError, ValueError):
        return None


def professional_years(work_history: list[dict] | None, today: date | None = None) -> float:
    """Approximate total years of employment from parsed work history."""
    as_of = today or date.today()
    total_days = 0
    for job in work_history or []:
        start = _month_year_to_date(job.get("start_month"), job.get("start_year"))
        if not start:
            continue
        if job.get("is_current") in (1, True, "1", "true", "yes"):
            end = as_of
        else:
            end = _month_year_to_date(job.get("end_month"), job.get("end_year")) or as_of
        if end < start:
            continue
        total_days += (end - start).days
    return round(total_days / 365.25, 2)


def seniority_from_years(years: float) -> str:
    for threshold, level in _SENIORITY_BY_YEARS:
        if years < threshold:
            return level
    return "unknown"


def _seniority_rank(level: str) -> int:
    try:
        return SENIORITY_LEVELS.index(level)
    except ValueError:
        return SENIORITY_LEVELS.index("unknown")


def clamp_seniority(ai_level: str, work_history: list[dict] | None, today: date | None = None) -> str:
    """Prefer deterministic experience duration; never inflate above evidence."""
    years = professional_years(work_history, today)
    deterministic = seniority_from_years(years) if (work_history or years > 0) else "unknown"
    raw = (ai_level or "").strip().lower()
    if raw not in SENIORITY_LEVELS:
        # Legacy schema returned "senior/staff/lead/principal" as one string — treat as unknown.
        parts = [p.strip() for p in re.split(r"[/|,]+", raw) if p.strip()]
        if len(parts) == 1 and parts[0] in SENIORITY_LEVELS:
            raw = parts[0]
        else:
            raw = "unknown"
    # Do not emit senior+ without enough years; clamp to deterministic ceiling.
    if _seniority_rank(raw) > _seniority_rank(deterministic):
        return deterministic
    if raw == "unknown" and deterministic != "unknown":
        return deterministic
    return raw


def validate_employment_dates(
    work_history: list[dict] | None,
    today: date | None = None,
) -> list[str]:
    """Deterministic employment-date checks. Never invent file-creation metadata."""
    as_of = today or date.today()
    issues: list[str] = []
    for job in work_history or []:
        company = (job.get("company") or "Unknown company").strip()
        start = _month_year_to_date(job.get("start_month"), job.get("start_year"))
        end = _month_year_to_date(job.get("end_month"), job.get("end_year"))
        is_current = job.get("is_current") in (1, True, "1", "true", "yes")
        if start and start > as_of:
            issues.append(
                f"Start date for {company} ({start.isoformat()}) is after today ({as_of.isoformat()})."
            )
        if end and not is_current and end > as_of:
            issues.append(
                f"End date for {company} ({end.isoformat()}) is after today ({as_of.isoformat()})."
            )
        if start and end and end < start:
            issues.append(f"End date for {company} is before its start date.")
    return issues


_HALLUCINATED_META_RE = re.compile(
    r"created in \d{4}|resume was (written|created|prepared)|file creation|document metadata|pdf metadata",
    re.I,
)


def sanitize_content_issues(issues: list[str] | None, work_history: list[dict] | None, today: date | None = None) -> list[str]:
    """Drop invented metadata claims; append deterministic date issues."""
    as_of = today or date.today()
    cleaned: list[str] = []
    for issue in issues or []:
        text = str(issue).strip()
        if not text:
            continue
        if _HALLUCINATED_META_RE.search(text):
            continue
        # Drop LLM "future-dated" claims; deterministic validator owns that.
        if re.search(r"future[- ]dated", text, re.I):
            continue
        cleaned.append(text)
    for det in validate_employment_dates(work_history, as_of):
        if det not in cleaned:
            cleaned.append(det)
    return cleaned


def sanitize_content_tips(tips: list[str] | None) -> list[str]:
    out: list[str] = []
    for tip in tips or []:
        text = str(tip).strip()
        if not text:
            continue
        if re.search(r"past tense", text, re.I) and not re.search(r"current|completed|present", text, re.I):
            text = (
                "Use past tense for completed roles; present tense is appropriate for current roles."
            )
        if re.search(r"summary section", text, re.I) and re.search(r"required|must|missing", text, re.I):
            continue
        out.append(text)
    return out


async def analyze_resume(
    client: AIClient,
    resume_text: str,
    *,
    today: date | None = None,
    work_history: list[dict] | None = None,
    target_tracks: list[str] | None = None,
) -> dict:
    as_of = today or date.today()
    tracks = ", ".join(target_tracks or []) or "(none)"
    try:
        prompt = ANALYSIS_PROMPT.format(
            resume=resume_text,
            today=as_of.isoformat(),
            target_tracks=tracks,
        )
        raw = await client.chat(prompt, max_tokens=2048)
        result = parse_json_response(raw) or {}
    except Exception as e:
        logger.error(f"Resume analysis failed: {e}")
        result = {}

    # Prefer new keys; accept legacy ats_* from older models.
    score = result.get("content_heuristic_score", result.get("ats_score", 0))
    try:
        score = int(score or 0)
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))

    issues = result.get("content_issues") or result.get("ats_issues") or []
    tips = result.get("content_tips") or result.get("ats_tips") or []
    seniority = clamp_seniority(result.get("seniority", ""), work_history, as_of)

    job_titles = result.get("job_titles") or []
    normalized_titles = []
    for jt in job_titles:
        if isinstance(jt, str):
            normalized_titles.append({"title": jt, "why": "", "evidence": []})
        elif isinstance(jt, dict) and jt.get("title"):
            evidence = jt.get("evidence") or []
            if isinstance(evidence, str):
                evidence = [evidence]
            normalized_titles.append({
                "title": jt["title"],
                "why": jt.get("why") or "",
                "evidence": list(evidence),
            })

    return {
        "search_terms": result.get("search_terms") or [],
        "job_titles": normalized_titles,
        "key_skills": result.get("key_skills") or [],
        "seniority": seniority,
        "summary": result.get("summary") or "",
        "content_heuristic_score": score,
        "content_issues": sanitize_content_issues(issues, work_history, as_of),
        "content_tips": sanitize_content_tips(tips),
        # Legacy aliases for older UI/tests — same heuristic, not a real ATS score.
        "ats_score": score,
        "ats_issues": sanitize_content_issues(issues, work_history, as_of),
        "ats_tips": sanitize_content_tips(tips),
        "professional_years_estimate": professional_years(work_history, as_of),
        "as_of_date": as_of.isoformat(),
    }
