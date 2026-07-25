import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.facts.importer import import_resume
from app.facts.schema import FactCategory
from app.facts.store import FactStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/facts", tags=["facts"])


class FactCreateBody(BaseModel):
    category: FactCategory = FactCategory.OTHER
    text: str
    employer: str | None = None
    role: str | None = None
    skills: list[str] = Field(default_factory=list)
    verified: bool = False
    source: str = "user"
    metadata: dict = Field(default_factory=dict)


class FactUpdateBody(BaseModel):
    category: FactCategory | None = None
    text: str | None = None
    employer: str | None = None
    role: str | None = None
    skills: list[str] | None = None
    verified: bool | None = None
    source: str | None = None
    metadata: dict | None = None


class ImportResumeBody(BaseModel):
    resume_text: str = ""
    use_ai: bool = False


def _store(request: Request) -> FactStore:
    return FactStore(request.app.state.db)


def _fact_dict(fact) -> dict:
    return fact.model_dump(by_alias=True)


@router.get("")
async def list_facts(
    request: Request,
    verified_only: bool = False,
    category: FactCategory | None = None,
):
    store = _store(request)
    facts = await store.list(verified_only=verified_only, category=category)
    return {"facts": [_fact_dict(f) for f in facts]}


@router.post("")
async def create_fact(request: Request, body: FactCreateBody):
    store = _store(request)
    import uuid
    fact = await store.create({
        "id": str(uuid.uuid4()),
        **body.model_dump(),
    })
    return {"fact": _fact_dict(fact)}


@router.put("/{fact_id}")
async def update_fact(request: Request, fact_id: str, body: FactUpdateBody):
    store = _store(request)
    updates = body.model_dump(exclude_unset=True)
    if "category" in updates and updates["category"] is not None:
        updates["category"] = updates["category"].value
    fact = await store.update(fact_id, updates)
    if not fact:
        raise HTTPException(status_code=404, detail="Fact not found")
    return {"fact": _fact_dict(fact)}


@router.post("/{fact_id}/verify")
async def verify_fact(request: Request, fact_id: str):
    store = _store(request)
    fact = await store.verify(fact_id, verified=True)
    if not fact:
        raise HTTPException(status_code=404, detail="Fact not found")
    return {"fact": _fact_dict(fact)}


@router.delete("/{fact_id}")
async def delete_fact(request: Request, fact_id: str):
    store = _store(request)
    deleted = await store.delete(fact_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Fact not found")
    return {"ok": True}


@router.post("/import-from-resume")
async def import_from_resume(request: Request, body: ImportResumeBody):
    resume_text = body.resume_text.strip()
    if not resume_text:
        config = await request.app.state.db.get_search_config()
        if config and config.get("resume_text"):
            resume_text = config["resume_text"]
    if not resume_text:
        raise HTTPException(status_code=400, detail="No resume text provided")

    client = getattr(request.app.state, "ai_client", None)
    facts = await import_resume(resume_text, client, use_ai=body.use_ai)
    store = _store(request)
    saved = []
    for fact in facts:
        saved.append(await store.create(fact.model_dump()))
    return {
        "imported": len(saved),
        "facts": [_fact_dict(f) for f in saved],
    }


@router.post("/assemble-master-resume")
async def assemble_master_resume(request: Request):
    store = _store(request)
    text = await store.assemble_master_resume(verified_only=True)
    return {"resume_text": text, "verified_only": True}
