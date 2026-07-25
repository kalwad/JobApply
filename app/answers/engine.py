"""Grounded short-answer resolution engine."""

from __future__ import annotations

import logging
import re
from difflib import SequenceMatcher
from typing import TYPE_CHECKING

from app.facts.schema import AnswerDraft
from app.facts.store import FactStore

if TYPE_CHECKING:
    from app.ai_client import AIClient
    from app.database import Database

logger = logging.getLogger(__name__)

_NUMBER_RE = re.compile(r"\b\d+(?:\.\d+)?%?\b")
_EMPLOYER_HINT_RE = re.compile(r"\b(?:at|for|with)\s+([A-Z][A-Za-z0-9&.\- ]{2,40})\b")


def _normalize_q(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, _normalize_q(a), _normalize_q(b)).ratio()


def _match_custom_qa(question: str, qa_entries: list[dict], *, exact: bool) -> dict | None:
    q = _normalize_q(question)
    if not q:
        return None
    best = None
    best_score = 0.0
    for entry in qa_entries:
        pattern = _normalize_q(entry.get("question_pattern", ""))
        if not pattern:
            continue
        if exact and pattern == q:
            return entry
        score = _similarity(q, pattern)
        if score > best_score:
            best_score = score
            best = entry
    if exact:
        return None
    return best if best_score >= 0.72 else None


def _deterministic_profile_answer(question: str, profile: dict) -> AnswerDraft | None:
    q = _normalize_q(question)
    rules = [
        (r"\b(first|given)\s*name\b", profile.get("first_name") or (profile.get("full_name") or "").split()[0:1]),
        (r"\blast\s*name\b|\bsurname\b", profile.get("last_name") or (profile.get("full_name") or "").split()[-1:]),
        (r"\bfull\s*name\b", profile.get("full_name")),
        (r"\bemail\b", profile.get("email")),
        (r"\bphone\b|\bmobile\b", profile.get("phone")),
        (r"\bcity\b", profile.get("address_city") or profile.get("location")),
        (r"\bstate\b|\bprovince\b", profile.get("address_state")),
        (r"\bzip\b|\bpostal\b", profile.get("address_zip")),
        (r"\bcountry\b", profile.get("address_country_name")),
        (r"\blinkedin\b", profile.get("linkedin_url")),
        (r"\bgithub\b", profile.get("github_url")),
        (r"\bportfolio\b|\bwebsite\b", profile.get("portfolio_url") or profile.get("website_url")),
        (r"\bauthori[sz]ed\b.*\bwork\b", profile.get("authorized_to_work_us")),
        (r"\bsponsor", profile.get("requires_sponsorship")),
        (r"\bsalary\b|\bcompensation\b", str(profile.get("desired_salary_min") or "")),
    ]
    for pattern, value in rules:
        if not value:
            continue
        if isinstance(value, list):
            value = value[0] if value else ""
        if not str(value).strip():
            continue
        if re.search(pattern, q):
            return AnswerDraft(
                answer=str(value).strip(),
                supportingFactIds=[],
                confidence=0.95,
                needsReview=False,
            )
    return None


def _facts_context(facts: list) -> str:
    lines = []
    for fact in facts:
        prefix = []
        if fact.role:
            prefix.append(fact.role)
        if fact.employer:
            prefix.append(fact.employer)
        head = " @ ".join(prefix)
        lines.append(f"[{fact.id}] {head + ': ' if head else ''}{fact.text}")
    return "\n".join(lines)


def _extract_claim_tokens(answer: str, cited_facts: list) -> tuple[set[str], set[str]]:
    cited_numbers: set[str] = set()
    cited_employers: set[str] = set()
    for fact in cited_facts:
        cited_numbers.update(_NUMBER_RE.findall(fact.text))
        if fact.employer:
            cited_employers.add(fact.employer.lower())
    answer_numbers = set(_NUMBER_RE.findall(answer))
    answer_employers = {m.group(1).strip().lower() for m in _EMPLOYER_HINT_RE.finditer(answer)}
    unsupported_numbers = answer_numbers - cited_numbers
    unsupported_employers = answer_employers - cited_employers
    return unsupported_numbers, unsupported_employers


def _flag_ungrounded(answer: str, cited_facts: list) -> tuple[bool, list[str]]:
    if not cited_facts:
        if _NUMBER_RE.search(answer) or _EMPLOYER_HINT_RE.search(answer):
            return True, ["AI answer makes factual claims without cited facts"]
        return True, ["No supporting facts cited"]
    unsupported_numbers, unsupported_employers = _extract_claim_tokens(answer, cited_facts)
    missing = []
    if unsupported_numbers:
        missing.append(f"Numbers not in cited facts: {', '.join(sorted(unsupported_numbers))}")
    if unsupported_employers:
        missing.append(f"Employers not in cited facts: {', '.join(sorted(unsupported_employers))}")
    return bool(missing), missing


async def _grounded_ai_answer(
    question: str,
    facts: list,
    client: AIClient,
) -> AnswerDraft:
    context = _facts_context(facts)
    prompt = f"""Answer this job application question using ONLY the verified facts below.
If the facts do not support an answer, reply with exactly: NEEDS_USER_INPUT

Question: {question}

Verified facts:
{context}

Reply with JSON: {{"answer":"...", "supportingFactIds":["id1"]}}"""
    raw = await client.chat(prompt, max_tokens=800)
    answer = raw.strip()
    supporting_ids: list[str] = []
    try:
        import json
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            parsed = json.loads(raw[start:end + 1])
            answer = parsed.get("answer", answer)
            supporting_ids = parsed.get("supportingFactIds") or parsed.get("supporting_fact_ids") or []
    except Exception:
        pass

    if answer.upper().startswith("NEEDS_USER_INPUT"):
        return AnswerDraft(
            answer="",
            supportingFactIds=[],
            confidence=0.0,
            needsReview=True,
            requiresUserDecision=True,
            missingInformation=["Insufficient verified facts"],
        )

    cited = [f for f in facts if f.id in supporting_ids] or facts[:3]
    if not supporting_ids and cited:
        supporting_ids = [f.id for f in cited[:3]]
    needs_review, missing = _flag_ungrounded(answer, cited)
    return AnswerDraft(
        answer=answer,
        supportingFactIds=supporting_ids,
        confidence=0.7 if not needs_review else 0.4,
        needsReview=needs_review,
        missingInformation=missing,
    )


async def generate_answer(
    question: str,
    db: Database,
    *,
    ai_client: AIClient | None = None,
    profile: dict | None = None,
) -> AnswerDraft:
    """Resolution chain: exact Q&A → fuzzy Q&A → profile → grounded AI → manual."""
    question = (question or "").strip()
    if not question:
        return AnswerDraft(
            answer="",
            confidence=0.0,
            needsReview=True,
            requiresUserDecision=True,
            missingInformation=["Empty question"],
        )

    qa_entries = await db.get_custom_qa()
    exact = _match_custom_qa(question, qa_entries, exact=True)
    if exact and exact.get("answer"):
        return AnswerDraft(
            answer=exact["answer"],
            supportingFactIds=[],
            confidence=1.0,
            needsReview=False,
        )

    fuzzy = _match_custom_qa(question, qa_entries, exact=False)
    if fuzzy and fuzzy.get("answer"):
        return AnswerDraft(
            answer=fuzzy["answer"],
            supportingFactIds=[],
            confidence=0.9,
            needsReview=False,
        )

    profile = profile or await db.get_user_profile() or {}
    deterministic = _deterministic_profile_answer(question, profile)
    if deterministic:
        return deterministic

    store = FactStore(db)
    verified_facts = await store.list(verified_only=True)
    if ai_client and verified_facts:
        draft = await _grounded_ai_answer(question, verified_facts, ai_client)
        if draft.answer or draft.requiresUserDecision:
            return draft

    return AnswerDraft(
        answer="",
        supportingFactIds=[],
        confidence=0.0,
        needsReview=True,
        requiresUserDecision=True,
        missingInformation=["No matching saved answer or verified facts"],
    )


async def approve_answer(
    question: str,
    answer: str,
    db: Database,
    *,
    category: str = "general",
) -> int:
    """Persist approved answer to custom_qa."""
    return await db.save_custom_qa({
        "question_pattern": question.strip(),
        "category": category,
        "answer": answer.strip(),
        "times_used": 0,
    })
