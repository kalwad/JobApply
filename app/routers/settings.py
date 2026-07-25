import asyncio
import json
import logging
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Request, UploadFile, File

from app.ai_client import AIClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


def _resume_drafts(request: Request) -> dict:
    store = getattr(request.app.state, "resume_drafts", None)
    if store is None:
        store = {}
        request.app.state.resume_drafts = store
    return store


def _mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "****"
    return f"****{key[-4:]}"


@router.get("/profile")
async def get_profile(request: Request):
    profile = await request.app.state.db.get_user_profile()
    return profile or {"full_name": "", "email": "", "phone": "", "location": "",
                        "linkedin_url": "", "github_url": "", "portfolio_url": ""}


@router.post("/profile")
async def update_profile(request: Request):
    body = await request.json()
    body.pop("id", None)
    body.pop("updated_at", None)
    await request.app.state.db.save_user_profile(**body)
    return {"ok": True}


@router.get("/profile/full")
async def get_full_profile(request: Request):
    return await request.app.state.db.get_full_profile()


@router.put("/profile/full")
async def update_full_profile(request: Request):
    body = await request.json()
    await request.app.state.db.save_full_profile(body)
    return {"ok": True}


@router.post("/profile/learn")
async def learn_from_autofill(request: Request):
    body = await request.json()
    job_url = body.get("job_url", "")
    job_title = body.get("job_title", "")
    company = body.get("company", "")
    new_data = body.get("new_data", {})
    db = request.app.state.db
    if new_data:
        existing = await db.get_user_profile() or {}
        existing.pop("id", None)
        existing.pop("updated_at", None)
        updated = {k: v for k, v in new_data.items() if v}
        existing.update(updated)
        await db.save_user_profile(**existing)
    await db.save_autofill_history(
        job_url=job_url, job_title=job_title, company=company,
        new_data_saved=new_data,
    )
    return {"ok": True}


@router.get("/custom-qa")
async def list_custom_qa(request: Request):
    return {"items": await request.app.state.db.get_custom_qa()}


@router.post("/custom-qa")
async def save_custom_qa(request: Request):
    body = await request.json()
    qa_id = await request.app.state.db.save_custom_qa(body)
    return {"ok": True, "id": qa_id}


@router.delete("/custom-qa/{qa_id}")
async def delete_custom_qa(request: Request, qa_id: int):
    await request.app.state.db.delete_custom_qa(qa_id)
    return {"ok": True}


@router.get("/autofill/history")
async def get_autofill_history(request: Request, limit: int = Query(50)):
    return {"items": await request.app.state.db.get_autofill_history(limit=limit)}


# Profile field CRUD
@router.post("/work-history")
async def save_work_history(request: Request):
    body = await request.json()
    entry_id = await request.app.state.db.save_work_history(body)
    return {"ok": True, "id": entry_id}


@router.delete("/work-history/{entry_id}")
async def delete_work_history(request: Request, entry_id: int):
    await request.app.state.db.delete_work_history(entry_id)
    return {"ok": True}


@router.post("/education")
async def save_education(request: Request):
    body = await request.json()
    entry_id = await request.app.state.db.save_education(body)
    return {"ok": True, "id": entry_id}


@router.delete("/education/{entry_id}")
async def delete_education(request: Request, entry_id: int):
    await request.app.state.db.delete_education(entry_id)
    return {"ok": True}


@router.post("/certifications")
async def save_certification(request: Request):
    body = await request.json()
    entry_id = await request.app.state.db.save_certification(body)
    return {"ok": True, "id": entry_id}


@router.delete("/certifications/{entry_id}")
async def delete_certification(request: Request, entry_id: int):
    await request.app.state.db.delete_certification(entry_id)
    return {"ok": True}


@router.post("/skills")
async def save_skill(request: Request):
    body = await request.json()
    entry_id = await request.app.state.db.save_skill(body)
    return {"ok": True, "id": entry_id}


@router.delete("/skills/{entry_id}")
async def delete_skill(request: Request, entry_id: int):
    await request.app.state.db.delete_skill(entry_id)
    return {"ok": True}


@router.post("/languages")
async def save_language(request: Request):
    body = await request.json()
    entry_id = await request.app.state.db.save_language(body)
    return {"ok": True, "id": entry_id}


@router.delete("/languages/{entry_id}")
async def delete_language(request: Request, entry_id: int):
    await request.app.state.db.delete_language(entry_id)
    return {"ok": True}


@router.post("/references")
async def save_reference(request: Request):
    body = await request.json()
    entry_id = await request.app.state.db.save_reference(body)
    return {"ok": True, "id": entry_id}


@router.delete("/references/{entry_id}")
async def delete_reference(request: Request, entry_id: int):
    await request.app.state.db.delete_reference(entry_id)
    return {"ok": True}


@router.get("/resumes")
async def list_resumes(request: Request):
    resumes = await request.app.state.db.get_resumes()
    return {"resumes": resumes}


@router.post("/resumes")
async def create_resume(request: Request):
    body = await request.json()
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(400, "Resume name is required")
    db = request.app.state.db
    resume_id = await db.create_resume(
        name=name, resume_text=body.get("resume_text", ""),
        is_default=body.get("is_default", False),
        search_terms=body.get("search_terms"), job_titles=body.get("job_titles"),
        key_skills=body.get("key_skills"), seniority=body.get("seniority", ""),
        summary=body.get("summary", ""),
    )
    resume = await db.get_resume(resume_id)
    return {"ok": True, "resume": resume}


@router.put("/resumes/{resume_id}")
async def update_resume(request: Request, resume_id: int):
    body = await request.json()
    if "name" in body and not body["name"].strip():
        raise HTTPException(400, "Resume name cannot be empty")
    fields = {}
    for key in ("name", "resume_text", "is_default", "search_terms",
                 "job_titles", "key_skills", "seniority", "summary"):
        if key in body:
            fields[key] = body[key].strip() if isinstance(body[key], str) else body[key]
    if not fields:
        raise HTTPException(400, "No fields to update")
    db = request.app.state.db
    updated = await db.update_resume(resume_id, **fields)
    if not updated:
        raise HTTPException(404, "Resume not found")
    resume = await db.get_resume(resume_id)
    return {"ok": True, "resume": resume}


@router.delete("/resumes/{resume_id}")
async def delete_resume(request: Request, resume_id: int):
    deleted = await request.app.state.db.delete_resume(resume_id)
    if not deleted:
        raise HTTPException(404, "Resume not found")
    return {"ok": True}


@router.post("/resumes/{resume_id}/set-default")
async def set_default_resume(request: Request, resume_id: int):
    result = await request.app.state.db.set_default_resume(resume_id)
    if not result:
        raise HTTPException(404, "Resume not found")
    return {"ok": True}


@router.get("/saved-views")
async def list_saved_views(request: Request):
    views = await request.app.state.db.get_saved_views()
    return {"views": views}


@router.post("/saved-views")
async def create_saved_view(request: Request):
    body = await request.json()
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(400, "View name is required")
    db = request.app.state.db
    filters = body.get("filters", {})
    view_id = await db.create_saved_view(name, filters)
    view = await db.get_saved_view(view_id)
    return {"ok": True, "view": view}


@router.put("/saved-views/{view_id}")
async def update_saved_view(request: Request, view_id: int):
    body = await request.json()
    name = body.get("name")
    filters = body.get("filters")
    if name is not None and not name.strip():
        raise HTTPException(400, "View name cannot be empty")
    db = request.app.state.db
    updated = await db.update_saved_view(
        view_id, name=name.strip() if name else name, filters=filters
    )
    if not updated:
        raise HTTPException(404, "View not found")
    view = await db.get_saved_view(view_id)
    return {"ok": True, "view": view}


@router.delete("/saved-views/{view_id}")
async def delete_saved_view(request: Request, view_id: int):
    deleted = await request.app.state.db.delete_saved_view(view_id)
    if not deleted:
        raise HTTPException(404, "View not found")
    return {"ok": True}


@router.get("/search-config")
async def get_search_config(request: Request):
    config = await request.app.state.db.get_search_config()
    if not config:
        return {"resume_text": "", "search_terms": [], "job_titles": [],
                "key_skills": [], "seniority": "", "summary": "",
                "ats_score": 0, "ats_issues": [], "ats_tips": [],
                "exclude_terms": [], "allowed_regions": ["US", "Remote"],
                "remote_only": False, "updated_at": None}
    return config


@router.post("/search-config/terms")
async def update_search_terms(request: Request):
    body = await request.json()
    terms = body.get("search_terms", [])
    if not isinstance(terms, list):
        raise HTTPException(400, "search_terms must be a list")
    await request.app.state.db.update_search_terms(terms)
    return {"ok": True, "search_terms": terms}


@router.post("/search-config/exclude-terms")
async def update_exclude_terms(request: Request):
    body = await request.json()
    terms = body.get("exclude_terms", [])
    if not isinstance(terms, list):
        raise HTTPException(400, "exclude_terms must be a list")
    await request.app.state.db.update_exclude_terms(terms)
    return {"ok": True, "exclude_terms": terms}


@router.get("/search-config/allowed-regions")
async def get_allowed_regions(request: Request):
    regions = await request.app.state.db.get_allowed_regions()
    return {"allowed_regions": regions}


@router.post("/search-config/allowed-regions")
async def update_allowed_regions(request: Request):
    body = await request.json()
    regions = body.get("allowed_regions", [])
    if not isinstance(regions, list):
        raise HTTPException(400, "allowed_regions must be a list")
    await request.app.state.db.update_allowed_regions(regions)
    return {"ok": True, "allowed_regions": regions}


@router.get("/search-config/remote-only")
async def get_remote_only(request: Request):
    enabled = await request.app.state.db.get_remote_only()
    return {"remote_only": enabled}


@router.post("/search-config/remote-only")
async def update_remote_only(request: Request):
    body = await request.json()
    enabled = body.get("remote_only", False)
    if not isinstance(enabled, bool):
        raise HTTPException(400, "remote_only must be a boolean")
    await request.app.state.db.set_remote_only(enabled)
    return {"ok": True, "remote_only": enabled}


@router.get("/ai-settings")
async def get_ai_settings(request: Request):
    settings = await request.app.state.db.get_ai_settings()
    if not settings:
        env_key = getattr(getattr(request.app.state, "settings", None), "anthropic_api_key", "") or ""
        return {
            "provider": "anthropic" if env_key else "",
            "api_key": _mask_key(env_key),
            "model": "", "base_url": "", "region": "",
            "has_key": bool(env_key), "updated_at": None,
        }
    is_bedrock = settings["provider"] == "bedrock"
    return {
        "provider": settings["provider"],
        "api_key": _mask_key(settings["api_key"]),
        "model": settings["model"],
        "base_url": _mask_key(settings["base_url"]) if is_bedrock else settings["base_url"],
        "region": settings.get("region", ""),
        "has_key": bool(settings["api_key"]),
        "has_secret": bool(settings["base_url"]) if is_bedrock else None,
        "updated_at": settings["updated_at"],
    }


@router.post("/ai-settings")
async def update_ai_settings(request: Request):
    from app.ai_client import ALL_PROVIDERS
    body = await request.json()
    provider = body.get("provider", "anthropic")
    api_key = body.get("api_key", "")
    model = body.get("model", "")
    base_url = body.get("base_url", "")
    region = body.get("region", "")
    if provider not in ALL_PROVIDERS:
        raise HTTPException(400, f"Provider must be one of: {', '.join(ALL_PROVIDERS)}")
    existing = None
    if api_key.startswith("****") or (provider == "bedrock" and base_url.startswith("****")):
        existing = await request.app.state.db.get_ai_settings()
    if api_key.startswith("****"):
        if existing:
            api_key = existing["api_key"]
        else:
            env_key = getattr(getattr(request.app.state, "settings", None), "anthropic_api_key", "") or ""
            api_key = env_key
    if provider == "bedrock" and base_url.startswith("****"):
        base_url = existing["base_url"] if existing else ""
    await request.app.state.db.save_ai_settings(provider, api_key, model, base_url, region=region)
    from app.main import _build_ai_client
    client = _build_ai_client({"provider": provider, "api_key": api_key,
                                "model": model, "base_url": base_url,
                                "region": region})
    config = await request.app.state.db.get_search_config()
    resume_text = config.get("resume_text", "") if config else ""
    await request.app.state.reinit_ai_services(client, resume_text)
    return {"ok": True, "provider": provider, "model": model}


@router.get("/ai-settings/models")
async def list_ollama_models(request: Request, base_url: str = Query("http://localhost:11434")):
    import httpx
    from app.ai_client import _resolve_ollama_url
    url = f"{_resolve_ollama_url(base_url).rstrip('/')}/api/tags"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
            models = [m["name"] for m in data.get("models", [])]
            return {"ok": True, "models": models}
    except Exception as e:
        return {"ok": False, "models": [], "error": str(e)}


@router.post("/ai-settings/test")
async def test_ai_connection(request: Request):
    body = await request.json()
    provider = body.get("provider", "anthropic")
    api_key = body.get("api_key", "")
    model = body.get("model", "")
    base_url = body.get("base_url", "")
    region = body.get("region", "")
    existing = None
    if api_key.startswith("****") or (provider == "bedrock" and base_url.startswith("****")):
        existing = await request.app.state.db.get_ai_settings()
    if api_key.startswith("****"):
        if existing:
            api_key = existing["api_key"]
        else:
            env_key = getattr(getattr(request.app.state, "settings", None), "anthropic_api_key", "") or ""
            api_key = env_key
    if provider == "bedrock" and base_url.startswith("****"):
        base_url = existing["base_url"] if existing else ""
    try:
        client = AIClient(provider, api_key=api_key, model=model, base_url=base_url, region=region)
        logger.info("Testing AI connection: provider=%s, model=%s, region=%s",
                     provider, model, region)
        response = await client.chat("Reply with exactly: OK", max_tokens=10)
        return {"ok": True, "response": (response or "").strip()[:50]}
    except Exception as e:
        logger.exception("AI connection test failed for provider=%s", provider)
        detail = str(e)
        cause = e.__cause__ or e.__context__
        if cause:
            detail = f"{detail} — {type(cause).__name__}: {cause}"
        return {"ok": False, "error": detail}


@router.get("/settings/embeddings")
async def get_embedding_settings(request: Request):
    settings = await request.app.state.db.get_embedding_settings()
    if not settings:
        return {
            "provider": "", "api_key": "", "model": "", "base_url": "",
            "dimensions": 256, "has_key": False, "enabled": False, "updated_at": None,
        }
    return {
        "provider": settings["provider"],
        "api_key": _mask_key(settings["api_key"]),
        "model": settings["model"],
        "base_url": settings["base_url"],
        "dimensions": settings["dimensions"],
        "has_key": bool(settings["api_key"]),
        "enabled": bool(request.app.state.embedding_client),
        "updated_at": settings["updated_at"],
    }


@router.post("/settings/embeddings")
async def save_embedding_settings(request: Request):
    body = await request.json()
    provider = body.get("provider", "openai")
    api_key = body.get("api_key", "")
    model = body.get("model", "")
    base_url = body.get("base_url", "")
    dimensions = body.get("dimensions", 256)
    if provider not in ("openai", "ollama"):
        raise HTTPException(400, "Provider must be 'openai' or 'ollama'")
    if api_key.startswith("****"):
        existing = await request.app.state.db.get_embedding_settings()
        if existing:
            api_key = existing["api_key"]
    db = request.app.state.db
    await db.save_embedding_settings(provider, api_key, model, base_url, dimensions)
    from app.main import _init_embedding_client
    request.app.state.embedding_client = await _init_embedding_client(db)
    return {"ok": True, "provider": provider, "enabled": bool(request.app.state.embedding_client)}


@router.post("/embeddings/backfill")
async def backfill_embeddings(request: Request):
    client = request.app.state.embedding_client
    if not client:
        raise HTTPException(400, "Embeddings not configured")
    db = request.app.state.db
    from app.embeddings import upsert_embedding
    cursor = await db.db.execute(
        "SELECT id, title, company, description FROM jobs WHERE dismissed = 0"
    )
    jobs = await cursor.fetchall()
    embedded = 0
    errors = 0
    for job in jobs:
        text = f"{job['title']} at {job['company']}\n{job['description'] or ''}"
        try:
            vector = await client.embed(text[:8000])
            await upsert_embedding(db.db, "vec_jobs", job["id"], vector)
            embedded += 1
        except Exception as e:
            logger.warning("Failed to embed job %d: %s", job["id"], e)
            errors += 1
    return {"ok": True, "embedded": embedded, "errors": errors, "total": len(jobs)}


@router.get("/settings/email")
async def get_email_settings(request: Request):
    settings = await request.app.state.db.get_email_settings()
    if settings:
        settings.pop("smtp_password", None)
    return settings or {}


@router.post("/settings/email")
async def save_email_settings(request: Request):
    data = await request.json()
    db = request.app.state.db
    existing = await db.get_email_settings()
    if data.get("smtp_password") == "" and existing:
        data["smtp_password"] = existing.get("smtp_password", "")
    await db.update_email_settings(data)
    scheduler = getattr(request.app.state, "scheduler", None)
    if scheduler and scheduler.running:
        digest_time = data.get("digest_time", "08:00")
        try:
            hour, minute = digest_time.split(":")
            scheduler.reschedule_job("digest_cycle", trigger="cron", hour=int(hour), minute=int(minute))
        except Exception:
            pass
    return {"ok": True}


@router.post("/settings/email/test")
async def test_email_settings(request: Request):
    from app.emailer import send_email
    data = await request.json()
    existing = await request.app.state.db.get_email_settings()
    if data.get("smtp_password") == "" and existing:
        data["smtp_password"] = existing.get("smtp_password", "")
    test_to = data.get("from_address", "")
    if not test_to:
        raise HTTPException(400, "From address required for test")
    success = await send_email(
        data, to=test_to, subject="CareerPulse SMTP Test",
        body_text="Your SMTP settings are configured correctly.",
        body_html="<p>Your SMTP settings are configured correctly.</p>",
    )
    if not success:
        raise HTTPException(500, "Failed to send test email — check SMTP settings")
    return {"ok": True, "message": f"Test email sent to {test_to}"}


@router.get("/scraper-keys")
async def get_scraper_keys(request: Request):
    keys = await request.app.state.db.get_scraper_keys()
    result = {}
    for name, data in keys.items():
        result[name] = {"has_key": bool(data["api_key"]), "email": data["email"]}
    return result


@router.post("/scraper-keys")
async def save_scraper_keys(request: Request):
    body = await request.json()
    db = request.app.state.db
    for name, data in body.items():
        api_key = data.get("api_key", "")
        email = data.get("email", "")
        if api_key.startswith("****"):
            existing = await db.get_scraper_key(name)
            if existing:
                api_key = existing["api_key"]
            else:
                api_key = ""
        await db.save_scraper_key(name, api_key, email)
    return {"ok": True}


@router.get("/scraper-schedule")
async def get_scraper_schedule(request: Request):
    schedules = await request.app.state.db.get_all_scraper_schedules()
    return {"schedules": schedules}


@router.post("/scraper-schedule")
async def update_scraper_schedule(request: Request):
    data = await request.json()
    source_name = data.get("source_name")
    interval_hours = data.get("interval_hours")
    if not source_name or interval_hours is None:
        raise HTTPException(400, "source_name and interval_hours required")
    await request.app.state.db.update_scraper_schedule(source_name, int(interval_hours))
    return {"ok": True}


_MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB
# Stage 1: text-extractable types only. DOCX/DOC/RTF need a real parser (Stage 1.1).
_ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md"}
_REJECTED_BINARY_EXTENSIONS = {".doc", ".docx", ".rtf"}


@router.post("/resume/upload")
async def upload_resume(request: Request, file: UploadFile = File(...)):
    """Extract + analyze into a DRAFT. Does not save search config or profile until approve."""
    original_name = file.filename or "resume"
    filename = original_name.lower()
    ext = "." + filename.rsplit(".", 1)[-1] if "." in filename else ""
    if ext in _REJECTED_BINARY_EXTENSIONS:
        raise HTTPException(
            400,
            f"{ext} upload is not supported yet (binary Office formats need a dedicated parser). "
            f"Upload .pdf, .txt, or .md for now.",
        )
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {ext}. Allowed: {', '.join(sorted(_ALLOWED_EXTENSIONS))}")
    content = await file.read()
    if len(content) > _MAX_UPLOAD_SIZE:
        raise HTTPException(400, f"File too large ({len(content)} bytes). Maximum: {_MAX_UPLOAD_SIZE // (1024*1024)}MB")

    stages = [
        {"id": "upload", "label": "Uploading file", "status": "done"},
        {"id": "extract", "label": "Extracting text", "status": "running"},
        {"id": "profile", "label": "Parsing profile", "status": "pending"},
        {"id": "career", "label": "Generating career suggestions", "status": "pending"},
        {"id": "review", "label": "Ready for review", "status": "pending"},
    ]

    if filename.endswith(".pdf"):
        import fitz
        doc = fitz.open(stream=content, filetype="pdf")
        resume_text = "\n".join(page.get_text() for page in doc)
        doc.close()
    else:
        resume_text = content.decode("utf-8", errors="replace")

    stages[1]["status"] = "done"
    uploaded_at = datetime.now(timezone.utc).isoformat()
    today = date.today()

    client = getattr(request.app.state, "ai_client", None)
    if not client and not getattr(request.app.state, "testing", False):
        from app.main import _build_ai_client
        ai_settings = await request.app.state.db.get_ai_settings()
        env_key = getattr(getattr(request.app.state, "settings", None), "anthropic_api_key", "") or ""
        client = _build_ai_client(ai_settings, env_key)

    analysis = {
        "search_terms": [], "job_titles": [], "key_skills": [],
        "seniority": "unknown", "summary": "",
        "content_heuristic_score": 0, "content_issues": [], "content_tips": [],
        "ats_score": 0, "ats_issues": [], "ats_tips": [],
        "professional_years_estimate": 0, "as_of_date": today.isoformat(),
    }
    profile_data: dict = {}
    logger.info(f"Resume upload draft: {len(resume_text)} chars, client={'yes' if client else 'no'}")

    if client:
        from app.resume_analyzer import analyze_resume, parse_resume_to_profile
        stages[2]["status"] = "running"
        stages[3]["status"] = "running"
        try:
            profile_task = parse_resume_to_profile(client, resume_text, today=today)
            # Profile first so analysis can clamp seniority from work history.
            profile_data = await asyncio.wait_for(profile_task, timeout=180)
            stages[2]["status"] = "done"
            work_history = profile_data.get("work_history") or []
            analysis = await asyncio.wait_for(
                analyze_resume(client, resume_text, today=today, work_history=work_history),
                timeout=180,
            )
            stages[3]["status"] = "done"
        except asyncio.TimeoutError:
            stages[2]["status"] = "error"
            stages[3]["status"] = "error"
            analysis["content_issues"] = list(analysis.get("content_issues") or []) + [
                "Analysis timed out. You can retry or discard this draft."
            ]
            analysis["ats_issues"] = analysis["content_issues"]
        except Exception as exc:
            logger.error(f"Resume draft analysis failed: {exc}")
            stages[2]["status"] = "error"
            stages[3]["status"] = "error"
            analysis["content_issues"] = [f"Analysis failed: {exc}"]
            analysis["ats_issues"] = analysis["content_issues"]
    else:
        stages[2]["status"] = "skipped"
        stages[3]["status"] = "skipped"

    stages[4]["status"] = "done"

    db = request.app.state.db
    current_config = await db.get_search_config() or {}
    full_profile = await db.get_full_profile()
    # get_full_profile shape: may nest profile under keys — normalize
    current_profile = full_profile if isinstance(full_profile, dict) else {}

    draft_id = str(uuid.uuid4())
    draft = {
        "draft_id": draft_id,
        "filename": original_name,
        "byte_size": len(content),
        "uploaded_at": uploaded_at,
        "resume_text": resume_text,
        "analysis": analysis,
        "profile_proposed": profile_data,
        "current_config": {
            "search_terms": current_config.get("search_terms") or [],
            "job_titles": current_config.get("job_titles") or [],
            "key_skills": current_config.get("key_skills") or [],
            "seniority": current_config.get("seniority") or "",
            "summary": current_config.get("summary") or "",
            "ats_score": current_config.get("ats_score") or 0,
            "resume_length": len(current_config.get("resume_text") or ""),
        },
        "current_profile_summary": {
            "work_history_count": len(current_profile.get("work_history") or []),
            "education_count": len(current_profile.get("education") or []),
            "skills_count": len(current_profile.get("skills") or []),
            "languages_count": len(current_profile.get("languages") or []),
            "certifications_count": len(current_profile.get("certifications") or []),
            "email": (current_profile.get("profile") or current_profile).get("email")
                     if isinstance(current_profile.get("profile"), dict)
                     else current_profile.get("email"),
        },
        "stages": stages,
    }
    _resume_drafts(request)[draft_id] = draft

    # IMPORTANT: do not save search_config or profile here.
    return {
        "ok": True,
        "draft": True,
        "draft_id": draft_id,
        "filename": original_name,
        "byte_size": len(content),
        "uploaded_at": uploaded_at,
        "stages": stages,
        "resume_length": len(resume_text),
        "analysis": analysis,
        "profile_proposed": profile_data,
        "current_config": draft["current_config"],
        "current_profile_summary": draft["current_profile_summary"],
        "profile_parsed": bool(profile_data),
        # Convenience mirrors for older clients (still draft-only — not persisted).
        "search_terms": analysis.get("search_terms") or [],
        "job_titles": analysis.get("job_titles") or [],
        "key_skills": analysis.get("key_skills") or [],
        "seniority": analysis.get("seniority") or "",
        "summary": analysis.get("summary") or "",
        "ats_score": analysis.get("content_heuristic_score") or analysis.get("ats_score") or 0,
        "ats_issues": analysis.get("content_issues") or analysis.get("ats_issues") or [],
        "ats_tips": analysis.get("content_tips") or analysis.get("ats_tips") or [],
        "content_heuristic_score": analysis.get("content_heuristic_score") or 0,
        "message": "Draft ready for review. Nothing was saved to your profile or search settings.",
    }


@router.get("/resume/draft/{draft_id}")
async def get_resume_draft(request: Request, draft_id: str):
    draft = _resume_drafts(request).get(draft_id)
    if not draft:
        raise HTTPException(404, "Draft not found or expired")
    # Omit full resume_text from GET unless needed — include length only
    out = {k: v for k, v in draft.items() if k != "resume_text"}
    out["resume_length"] = len(draft.get("resume_text") or "")
    return out


@router.post("/resume/draft/discard")
async def discard_resume_draft(request: Request):
    body = await request.json()
    draft_id = body.get("draft_id")
    if not draft_id:
        raise HTTPException(400, "draft_id required")
    _resume_drafts(request).pop(draft_id, None)
    return {"ok": True}


@router.post("/resume/draft/approve")
async def approve_resume_draft(request: Request):
    """Persist selected draft sections only after explicit user approval."""
    body = await request.json()
    draft_id = body.get("draft_id")
    approve = body.get("approve") or {}
    if not draft_id:
        raise HTTPException(400, "draft_id required")
    draft = _resume_drafts(request).get(draft_id)
    if not draft:
        raise HTTPException(404, "Draft not found or expired")

    analysis = draft.get("analysis") or {}
    profile_data = draft.get("profile_proposed") or {}
    resume_text = draft.get("resume_text") or ""
    db = request.app.state.db
    current = await db.get_search_config() or {}

    # Defaults: nothing applied unless explicitly true
    apply_resume_text = bool(approve.get("resume_text"))
    apply_search_terms = bool(approve.get("search_terms"))
    apply_job_titles = bool(approve.get("job_titles"))
    apply_key_skills = bool(approve.get("key_skills"))
    apply_seniority = bool(approve.get("seniority"))
    apply_summary = bool(approve.get("summary"))
    apply_heuristic = bool(approve.get("content_heuristic") or approve.get("ats"))
    profile_sections = approve.get("profile_sections") or {}

    new_terms = analysis.get("search_terms") if apply_search_terms else (current.get("search_terms") or [])
    new_titles = analysis.get("job_titles") if apply_job_titles else (current.get("job_titles") or [])
    new_skills = analysis.get("key_skills") if apply_key_skills else (current.get("key_skills") or [])
    new_seniority = analysis.get("seniority") if apply_seniority else (current.get("seniority") or "")
    new_summary = analysis.get("summary") if apply_summary else (current.get("summary") or "")
    score = analysis.get("content_heuristic_score", analysis.get("ats_score", 0))
    issues = analysis.get("content_issues") or analysis.get("ats_issues") or []
    tips = analysis.get("content_tips") or analysis.get("ats_tips") or []

    text_to_save = resume_text if apply_resume_text else (current.get("resume_text") or resume_text)
    # Always allow storing extracted text when user approves any analysis slice + resume_text,
    # or when they approve resume_text alone. If they only approve search terms, keep prior text
    # unless resume_text approved.
    if apply_resume_text or (
        (apply_search_terms or apply_job_titles or apply_key_skills or apply_seniority or apply_summary or apply_heuristic)
        and not (current.get("resume_text") or "").strip()
    ):
        text_to_save = resume_text

    if any([
        apply_resume_text, apply_search_terms, apply_job_titles, apply_key_skills,
        apply_seniority, apply_summary, apply_heuristic,
    ]):
        await db.save_search_config(
            text_to_save,
            new_terms if apply_search_terms else (current.get("search_terms") or []),
            job_titles=new_titles if apply_job_titles else (current.get("job_titles") or []),
            key_skills=new_skills if apply_key_skills else (current.get("key_skills") or []),
            seniority=new_seniority if apply_seniority else (current.get("seniority") or ""),
            summary=new_summary if apply_summary else (current.get("summary") or ""),
            ats_score=score if apply_heuristic else (current.get("ats_score") or 0),
            ats_issues=issues if apply_heuristic else (current.get("ats_issues") or []),
            ats_tips=tips if apply_heuristic else (current.get("ats_tips") or []),
        )
        client = getattr(request.app.state, "ai_client", None)
        if client and apply_resume_text:
            await request.app.state.reinit_ai_services(client, text_to_save)

    applied_profile = []
    if profile_data and any(profile_sections.values()):
        filtered = {}
        if profile_sections.get("personal") and profile_data.get("personal"):
            filtered["personal"] = profile_data["personal"]
            applied_profile.append("personal")
        for key in ("work_history", "education", "skills", "languages", "certifications"):
            if profile_sections.get(key) and profile_data.get(key):
                filtered[key] = profile_data[key]
                applied_profile.append(key)
        if filtered:
            await request.app.state.save_parsed_profile(db, filtered)

    _resume_drafts(request).pop(draft_id, None)
    return {
        "ok": True,
        "applied": {
            "resume_text": apply_resume_text,
            "search_terms": apply_search_terms,
            "job_titles": apply_job_titles,
            "key_skills": apply_key_skills,
            "seniority": apply_seniority,
            "summary": apply_summary,
            "content_heuristic": apply_heuristic,
            "profile_sections": applied_profile,
        },
    }
