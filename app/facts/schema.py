"""Fact-Bank-ready schema stubs for JobApply.

Stage 1 defines the contracts used by later stages. Runtime autofill does not
yet require verified facts; `supportingFactIds` on answers remains empty until
Stage 2–4 wire verification and grounding.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class FactCategory(str, Enum):
    CONTACT = "contact"
    WORK_EXPERIENCE = "work_experience"
    EDUCATION = "education"
    PROJECT = "project"
    CERTIFICATION = "certification"
    SKILL = "skill"
    AUTHORIZATION = "authorization"
    PREFERENCE = "preference"
    OTHER = "other"


class Fact(BaseModel):
    id: str
    category: FactCategory
    text: str
    employer: str | None = None
    role: str | None = None
    skills: list[str] = Field(default_factory=list)
    verified: bool = False
    source: str = "master_resume"
    metadata: dict[str, Any] = Field(default_factory=dict)


class AnswerDraft(BaseModel):
    answer: str
    supporting_fact_ids: list[str] = Field(default_factory=list, alias="supportingFactIds")
    confidence: float = 0.0
    missing_information: list[str] = Field(default_factory=list, alias="missingInformation")
    needs_review: bool = Field(default=False, alias="needsReview")
    requires_user_decision: bool = Field(default=False, alias="requiresUserDecision")

    model_config = {"populate_by_name": True}
