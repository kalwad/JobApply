import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from app.database import Database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.get("/calendar")
async def get_calendar_events(request: Request,
                               start: str = Query(...),
                               end: str = Query(...)):
    db: Database = request.app.state.db
    events = await db.get_calendar_events(start, end)
    return {"events": events}


@router.get("/calendar/token")
async def get_ical_token(request: Request):
    db: Database = request.app.state.db
    token = await db.get_or_create_ical_token()
    return {"token": token}


@router.post("/calendar/token/regenerate")
async def regenerate_ical_token(request: Request):
    db: Database = request.app.state.db
    token = await db.regenerate_ical_token()
    return {"token": token}


def _format_ical_datetime(iso_str: str) -> str:
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _escape_ical(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _build_ical(events: list[dict]) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CareerPulse//Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:CareerPulse Interviews",
    ]
    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    for event in events:
        if event["event_type"] == "interview":
            uid = f"interview-{event['id']}@careerpulse"
            dtstart = _format_ical_datetime(event["scheduled_at"])
            duration = event.get("duration_min", 60)
            dt_start = datetime.fromisoformat(event["scheduled_at"].replace("Z", "+00:00"))
            dt_end = dt_start + timedelta(minutes=duration)
            dtend = dt_end.strftime("%Y%m%dT%H%M%SZ")
            summary = f"Round {event['round_number']}: {event['label']} — {event['company']}"
            desc_parts = [event.get("job_title", "")]
            if event.get("interviewer_name"):
                desc_parts.append(f"Interviewer: {event['interviewer_name']}")
            if event.get("notes"):
                desc_parts.append(event["notes"])
            description = "\\n".join(desc_parts)
            location = event.get("location", "")
        elif event["event_type"] == "reminder":
            uid = f"reminder-{event['id']}@careerpulse"
            dtstart = _format_ical_datetime(event["remind_at"])
            dt_start = datetime.fromisoformat(event["remind_at"].replace("Z", "+00:00"))
            dt_end = dt_start + timedelta(minutes=30)
            dtend = dt_end.strftime("%Y%m%dT%H%M%SZ")
            summary = f"Follow-up: {event['company']} — {event.get('job_title', '')}"
            description = f"Reminder type: {event.get('reminder_type', 'follow_up')}"
            location = ""
        else:
            continue

        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{uid}")
        lines.append(f"DTSTAMP:{now}")
        lines.append(f"DTSTART:{dtstart}")
        lines.append(f"DTEND:{dtend}")
        lines.append(f"SUMMARY:{_escape_ical(summary)}")
        if description:
            lines.append(f"DESCRIPTION:{_escape_ical(description)}")
        if location:
            lines.append(f"LOCATION:{_escape_ical(location)}")
        lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)


@router.get("/calendar.ics")
async def ical_feed(request: Request, token: str = Query(None)):
    if not token:
        raise HTTPException(401, "Token required")
    db: Database = request.app.state.db
    if not await db.validate_ical_token(token):
        raise HTTPException(401, "Invalid token")

    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=7)).isoformat()
    end = (now + timedelta(days=90)).isoformat()
    events = await db.get_calendar_events(start, end)

    ical_body = _build_ical(events)
    return Response(
        content=ical_body,
        media_type="text/calendar; charset=utf-8",
        headers={"Cache-Control": "no-cache"},
    )
