"""Grounded short-answer API routes."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.answers.engine import approve_answer, generate_answer

router = APIRouter(prefix="/api/answers", tags=["answers"])


class GenerateBody(BaseModel):
    question: str


class ApproveBody(BaseModel):
    question: str
    answer: str
    category: str = "general"


@router.post("/generate")
async def generate(request: Request, body: GenerateBody):
    db = request.app.state.db
    ai_client = getattr(request.app.state, "ai_client", None)
    profile = await db.get_user_profile()
    draft = await generate_answer(
        body.question,
        db,
        ai_client=ai_client,
        profile=profile,
    )
    return draft.model_dump(by_alias=True)


@router.post("/approve")
async def approve(request: Request, body: ApproveBody):
    if not body.question.strip() or not body.answer.strip():
        raise HTTPException(status_code=400, detail="Question and answer required")
    qa_id = await approve_answer(
        body.question,
        body.answer,
        request.app.state.db,
        category=body.category,
    )
    return {"ok": True, "id": qa_id}
