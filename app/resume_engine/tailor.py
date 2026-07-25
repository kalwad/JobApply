"""Conservative bullet rewrite using AI or heuristic reorder."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.facts.schema import Fact, FactCategory
from app.resume_engine.matcher import match_jd_to_facts

if TYPE_CHECKING:
    from app.ai_client import AIClient

logger = logging.getLogger(__name__)


def _score_fact_for_jd(fact: Fact, jd_keywords: set[str]) -> float:
    hay = " ".join([fact.text, fact.employer or "", fact.role or "", " ".join(fact.skills)]).lower()
    if not jd_keywords:
        return 0.5
    hits = sum(1 for kw in jd_keywords if kw in hay)
    return hits / max(len(jd_keywords), 1)


def _heuristic_tailor(facts: list[Fact], jd_text: str, match_report: dict) -> dict:
    keywords = set(match_report["parsed"]["skills"])
    work = [f for f in facts if f.category == FactCategory.WORK_EXPERIENCE and f.verified]
    skills = [f for f in facts if f.category == FactCategory.SKILL and f.verified]
    education = [f for f in facts if f.category == FactCategory.EDUCATION and f.verified]

    ranked_work = sorted(work, key=lambda f: _score_fact_for_jd(f, keywords), reverse=True)
    bullets = []
    diffs = []
    supporting: set[str] = set()

    for fact in ranked_work:
        bullets.append({
            "text": fact.text,
            "employer": fact.employer,
            "role": fact.role,
            "supportingFactIds": [fact.id],
        })
        supporting.add(fact.id)

    skill_line = ", ".join(f.text for f in skills[:12])
    sections = {
        "summary": f"Targeting: {match_report['parsed'].get('title_hint', 'Role')}",
        "experience": bullets,
        "skills": skill_line,
        "education": [f.text for f in education],
    }

    return {
        "content": sections,
        "diffs": diffs,
        "supportingFactIds": sorted(supporting),
        "method": "heuristic_reorder",
    }


AI_TAILOR_PROMPT = """Rewrite resume bullets conservatively for this job description.
ONLY use facts provided. Do NOT add skills or metrics not present in the facts.
Return JSON: {{"experience":[{{"text":"...", "supportingFactIds":["id"]}}], "summary":"..."}}

Job description:
{jd}

Verified facts:
{facts}
"""


async def tailor_resume(
    jd_text: str,
    facts: list[Fact],
    ai_client: AIClient | None = None,
) -> dict:
    """Produce tailored content with fact IDs attached."""
    match_report = match_jd_to_facts(jd_text, facts)
    verified = [f for f in facts if f.verified]

    if not ai_client or not verified:
        base = _heuristic_tailor(verified, jd_text, match_report)
        base["gaps"] = match_report["gaps"]
        base["matched"] = match_report["matched"]
        return base

    try:
        fact_lines = []
        for fact in verified:
            fact_lines.append(f"[{fact.id}] ({fact.category.value}) {fact.text}")
        prompt = AI_TAILOR_PROMPT.format(
            jd=jd_text[:8000],
            facts="\n".join(fact_lines[:60]),
        )
        raw = await ai_client.chat(prompt, max_tokens=2500)
        import json
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("No JSON in AI response")
        parsed = json.loads(raw[start:end + 1])
        supporting: set[str] = set()
        experience = []
        for item in parsed.get("experience", []):
            ids = item.get("supportingFactIds") or []
            supporting.update(ids)
            experience.append({
                "text": item.get("text", ""),
                "supportingFactIds": ids,
            })
        result = {
            "content": {
                "summary": parsed.get("summary", ""),
                "experience": experience,
                "skills": ", ".join(
                    f.text for f in verified if f.category == FactCategory.SKILL
                )[:500],
                "education": [
                    f.text for f in verified if f.category == FactCategory.EDUCATION
                ],
            },
            "diffs": [{"type": "ai_rewrite", "count": len(experience)}],
            "supportingFactIds": sorted(supporting),
            "method": "ai_conservative",
            "gaps": match_report["gaps"],
            "matched": match_report["matched"],
        }
        return result
    except Exception:
        logger.exception("AI tailor failed; using heuristic reorder")
        base = _heuristic_tailor(verified, jd_text, match_report)
        base["gaps"] = match_report["gaps"]
        base["matched"] = match_report["matched"]
        return base
