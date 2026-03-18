from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api")


@router.get("/contacts")
async def list_contacts(request: Request):
    contacts = await request.app.state.db.get_contacts()
    return {"contacts": contacts}


@router.post("/contacts")
async def create_contact(request: Request):
    body = await request.json()
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(400, "Contact name is required")
    fields = {}
    for key in ("email", "phone", "company", "role", "linkedin_url", "notes"):
        if key in body:
            fields[key] = body[key]
    db = request.app.state.db
    contact_id = await db.create_contact(name, **fields)
    contact = await db.get_contact(contact_id)
    return {"ok": True, "contact": contact}


@router.put("/contacts/{contact_id}")
async def update_contact(request: Request, contact_id: int):
    body = await request.json()
    fields = {}
    for key in ("name", "email", "phone", "company", "role", "linkedin_url", "notes"):
        if key in body:
            fields[key] = body[key]
    if not fields:
        raise HTTPException(400, "No fields to update")
    db = request.app.state.db
    updated = await db.update_contact(contact_id, **fields)
    if not updated:
        raise HTTPException(404, "Contact not found")
    contact = await db.get_contact(contact_id)
    return {"ok": True, "contact": contact}


@router.delete("/contacts/{contact_id}")
async def delete_contact(request: Request, contact_id: int):
    deleted = await request.app.state.db.delete_contact(contact_id)
    if not deleted:
        raise HTTPException(404, "Contact not found")
    return {"ok": True}


@router.get("/contacts/{contact_id}/interactions")
async def get_contact_interactions(request: Request, contact_id: int):
    db = request.app.state.db
    contact = await db.get_contact(contact_id)
    if not contact:
        raise HTTPException(404, "Contact not found")
    interactions = await db.get_contact_interactions(contact_id)
    return {"interactions": interactions}


@router.post("/contacts/{contact_id}/interactions")
async def add_contact_interaction(request: Request, contact_id: int):
    db = request.app.state.db
    contact = await db.get_contact(contact_id)
    if not contact:
        raise HTTPException(404, "Contact not found")
    body = await request.json()
    interaction_id = await db.add_contact_interaction(
        contact_id,
        type=body.get("type", "note"),
        notes=body.get("notes", ""),
        date=body.get("date", datetime.now(timezone.utc).isoformat()),
    )
    return {"ok": True, "interaction_id": interaction_id}


@router.get("/jobs/{job_id}/contacts")
async def get_job_contacts(request: Request, job_id: int):
    db = request.app.state.db
    job = await db.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    contacts = await db.get_job_contacts(job_id)
    return {"contacts": contacts}


@router.post("/jobs/{job_id}/contacts")
async def link_job_contact(request: Request, job_id: int):
    body = await request.json()
    contact_id = body.get("contact_id")
    if not contact_id:
        raise HTTPException(400, "contact_id is required")
    await request.app.state.db.link_job_contact(
        job_id, contact_id, relationship=body.get("relationship", "")
    )
    return {"ok": True}


@router.delete("/jobs/{job_id}/contacts/{contact_id}")
async def unlink_job_contact(request: Request, job_id: int, contact_id: int):
    removed = await request.app.state.db.unlink_job_contact(job_id, contact_id)
    if not removed:
        raise HTTPException(404, "Link not found")
    return {"ok": True}
