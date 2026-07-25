"""Resume tailoring API."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.facts.store import FactStore
from app.resume_engine.one_page import fit_one_page, pdf_page_count, render_tailored_text
from app.resume_engine.tailor import tailor_resume

router = APIRouter(prefix="/api/resume", tags=["resume-engine"])


class TailorBody(BaseModel):
    job_description: str


@router.post("/tailor")
async def tailor(request: Request, body: TailorBody):
    jd = body.job_description.strip()
    if not jd:
        raise HTTPException(status_code=400, detail="Job description required")

    store = FactStore(request.app.state.db)
    facts = await store.list(verified_only=False)
    verified = [f for f in facts if f.verified]
    if not verified:
        raise HTTPException(
            status_code=400,
            detail="No verified facts available. Import and verify facts first.",
        )

    ai_client = getattr(request.app.state, "ai_client", None)
    tailored = await tailor_resume(jd, facts, ai_client=ai_client)
    fitted = fit_one_page(tailored["content"])
    resume_text = render_tailored_text(fitted["content"])
    pdf_pages = pdf_page_count(resume_text)

    return {
        "content": fitted["content"],
        "gaps": tailored.get("gaps", []),
        "matched": tailored.get("matched", []),
        "diffs": tailored.get("diffs", []),
        "pageEstimate": fitted["pageEstimate"],
        "pdfPageCount": pdf_pages,
        "layout": fitted["layout"],
        "supportingFactIds": tailored.get("supportingFactIds", []),
        "method": tailored.get("method"),
        "resumeText": resume_text,
    }
