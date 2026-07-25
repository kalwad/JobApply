"""Match JD requirements to verified facts; produce gap report."""

from __future__ import annotations

from app.facts.schema import Fact, FactCategory
from app.facts.store import FactStore
from app.resume_engine.jd_parser import parse_job_description


def _fact_skill_tokens(facts: list[Fact]) -> set[str]:
    tokens: set[str] = set()
    for fact in facts:
        for skill in fact.skills:
            tokens.add(skill.lower().strip())
        if fact.category == FactCategory.SKILL:
            tokens.add(fact.text.lower().strip())
        text_lower = fact.text.lower()
        for word in text_lower.split():
            if len(word) >= 3:
                tokens.add(word.strip(".,;:"))
    return tokens


def _fact_supports_skill(facts: list[Fact], skill: str) -> tuple[bool, list[str]]:
    skill_l = skill.lower()
    supporting: list[str] = []
    for fact in facts:
        hay = " ".join([
            fact.text,
            fact.employer or "",
            fact.role or "",
            " ".join(fact.skills),
        ]).lower()
        if skill_l in hay:
            supporting.append(fact.id)
    return bool(supporting), supporting


def match_jd_to_facts(jd_text: str, facts: list[Fact]) -> dict:
    """Match parsed JD skills to verified facts. Never invent unsupported skills."""
    parsed = parse_job_description(jd_text)
    verified = [f for f in facts if f.verified]
    skill_tokens = _fact_skill_tokens(verified)

    matched = []
    gaps = []
    all_supporting: set[str] = set()

    for skill in parsed["skills"]:
        supported, fact_ids = _fact_supports_skill(verified, skill)
        if supported or skill in skill_tokens:
            matched.append({"skill": skill, "supportingFactIds": fact_ids})
            all_supporting.update(fact_ids)
        else:
            gaps.append({"skill": skill, "reason": "No verified fact supports this requirement"})

    work_facts = [f for f in verified if f.category == FactCategory.WORK_EXPERIENCE]
    return {
        "parsed": parsed,
        "matched": matched,
        "gaps": gaps,
        "supportingFactIds": sorted(all_supporting),
        "verifiedFactCount": len(verified),
        "workExperienceFacts": len(work_facts),
    }
