import logging
from fastapi import APIRouter, HTTPException, Request

from app.database import Database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.get("/jobs/{job_id}/interviews")
async def list_interviews(job_id: int, request: Request):
    db: Database = request.app.state.db
    rounds = await db.get_interview_rounds(job_id)
    return {"rounds": rounds}


@router.post("/jobs/{job_id}/interviews")
async def create_interview(job_id: int, request: Request):
    db: Database = request.app.state.db
    body = await request.json()
    round_id = await db.create_interview_round(
        job_id,
        label=body.get("label", ""),
        scheduled_at=body.get("scheduled_at"),
        duration_min=body.get("duration_min", 60),
        interviewer_name=body.get("interviewer_name", ""),
        interviewer_title=body.get("interviewer_title", ""),
        location=body.get("location", ""),
        notes=body.get("notes", ""),
    )
    # Auto-move to interviewing if not already
    app_row = await db.get_application(job_id)
    if app_row and app_row["status"] not in ("interviewing", "offered", "rejected"):
        await db.update_application(app_row["id"], status="interviewing")
    elif not app_row:
        await db.upsert_application(job_id, status="interviewing")

    r = await db.get_interview_round(round_id)
    return r


@router.put("/interviews/{round_id}")
async def update_interview(round_id: int, request: Request):
    db: Database = request.app.state.db
    body = await request.json()
    await db.update_interview_round(round_id, **body)
    return {"ok": True}


@router.delete("/interviews/{round_id}")
async def delete_interview(round_id: int, request: Request):
    db: Database = request.app.state.db
    await db.delete_interview_round(round_id)
    return {"ok": True}


@router.post("/interviews/{round_id}/save-contact")
async def promote_to_contact(round_id: int, request: Request):
    db: Database = request.app.state.db
    r = await db.get_interview_round(round_id)
    if not r:
        raise HTTPException(404, "Interview round not found")
    if not r["interviewer_name"]:
        raise HTTPException(400, "No interviewer name to promote")
    if r["contact_id"]:
        return {"contact_id": r["contact_id"], "already_existed": True}

    contact_id = await db.create_contact(
        name=r["interviewer_name"],
        role=r["interviewer_title"],
    )
    await db.update_interview_round(round_id, contact_id=contact_id)
    await db.link_job_contact(r["job_id"], contact_id, relationship="interviewer")
    return {"contact_id": contact_id, "already_existed": False}
