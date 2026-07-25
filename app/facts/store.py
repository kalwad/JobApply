"""SQLite-backed Fact Bank store."""

from __future__ import annotations

from app.database import Database
from app.facts.schema import Fact, FactCategory


def _to_fact(row: dict) -> Fact:
    category = row.get("category", "other")
    try:
        cat = FactCategory(category)
    except ValueError:
        cat = FactCategory.OTHER
    return Fact(
        id=row["id"],
        category=cat,
        text=row.get("text", ""),
        employer=row.get("employer"),
        role=row.get("role"),
        skills=row.get("skills") or [],
        verified=bool(row.get("verified")),
        source=row.get("source", "master_resume"),
        metadata=row.get("metadata") or {},
    )


def _from_fact(fact: Fact | dict) -> dict:
    if isinstance(fact, Fact):
        return {
            "id": fact.id,
            "category": fact.category.value if isinstance(fact.category, FactCategory) else fact.category,
            "text": fact.text,
            "employer": fact.employer,
            "role": fact.role,
            "skills": fact.skills,
            "verified": fact.verified,
            "source": fact.source,
            "metadata": fact.metadata,
        }
    data = dict(fact)
    if "category" in data and hasattr(data["category"], "value"):
        data["category"] = data["category"].value
    return data


class FactStore:
    """CRUD wrapper over Database fact methods."""

    def __init__(self, db: Database):
        self.db = db

    async def list(
        self,
        *,
        verified_only: bool = False,
        category: FactCategory | str | None = None,
    ) -> list[Fact]:
        cat = category.value if isinstance(category, FactCategory) else category
        rows = await self.db.list_facts(verified_only=verified_only, category=cat)
        return [_to_fact(r) for r in rows]

    async def get(self, fact_id: str) -> Fact | None:
        row = await self.db.get_fact(fact_id)
        return _to_fact(row) if row else None

    async def create(self, fact: Fact | dict) -> Fact:
        row = await self.db.create_fact(_from_fact(fact))
        return _to_fact(row)

    async def update(self, fact_id: str, updates: dict) -> Fact | None:
        row = await self.db.update_fact(fact_id, updates)
        return _to_fact(row) if row else None

    async def verify(self, fact_id: str, verified: bool = True) -> Fact | None:
        row = await self.db.verify_fact(fact_id, verified=verified)
        return _to_fact(row) if row else None

    async def delete(self, fact_id: str) -> bool:
        return await self.db.delete_fact(fact_id)

    async def assemble_master_resume(self, *, verified_only: bool = True) -> str:
        facts = await self.list(verified_only=verified_only)
        if not facts:
            return ""

        sections: dict[str, list[Fact]] = {}
        for fact in facts:
            key = fact.category.value
            sections.setdefault(key, []).append(fact)

        lines: list[str] = []
        order = [
            FactCategory.CONTACT,
            FactCategory.WORK_EXPERIENCE,
            FactCategory.EDUCATION,
            FactCategory.PROJECT,
            FactCategory.CERTIFICATION,
            FactCategory.SKILL,
            FactCategory.AUTHORIZATION,
            FactCategory.PREFERENCE,
            FactCategory.OTHER,
        ]
        for cat in order:
            items = sections.get(cat.value, [])
            if not items:
                continue
            title = cat.value.replace("_", " ").title()
            lines.append(title.upper())
            for item in items:
                prefix = ""
                if item.employer or item.role:
                    parts = [p for p in (item.role, item.employer) if p]
                    prefix = " — ".join(parts) + ": "
                lines.append(f"- {prefix}{item.text}")
            lines.append("")
        return "\n".join(lines).strip()
