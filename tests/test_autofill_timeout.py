import asyncio
import json

import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch

from app.database import Database
from app.routers.autofill import (
    _deterministic_fill,
    _match_phone_country_option,
    _name_components,
)


@pytest.fixture
async def app(tmp_path):
    from app.main import create_app
    application = create_app(db_path=str(tmp_path / "test.db"), testing=True)
    db = Database(str(tmp_path / "test.db"))
    await db.init()
    application.state.db = db
    yield application
    await db.close()


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
def mock_ai_client():
    client = AsyncMock()
    client.chat = AsyncMock()
    return client


async def test_autofill_analyze_timeout(app, client, mock_ai_client):
    """AI timeout should keep deterministic mappings and surface an error."""

    async def slow_chat(*args, **kwargs):
        await asyncio.sleep(5)
        return '[]'

    mock_ai_client.chat = AsyncMock(side_effect=slow_chat)
    app.state.ai_client = mock_ai_client

    await app.state.db.save_user_profile(
        full_name="Jane Doe",
        email="jane@example.com",
        phone="555-0100",
    )

    fields = [
        {
            "selector": "#email",
            "name": "email",
            "id": "email",
            "label": "Email",
            "tag": "input",
            "type": "email",
            "placeholder": "",
            "currentValue": "",
        },
        {
            "selector": "#custom_question",
            "name": "custom_question",
            "id": "custom_question",
            "label": "Why do you want this role?",
            "tag": "textarea",
            "type": "",
            "placeholder": "",
            "currentValue": "",
        },
    ]

    with patch("app.routers.autofill.AUTOFILL_ANALYZE_TIMEOUT", 1), \
         patch("app.routers.autofill.AUTOFILL_ANALYZE_TIMEOUT_PARTIAL", 1):
        resp = await client.post(
            "/api/autofill/analyze",
            json={"form_html": "<form></form>", "fields": fields},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "error" in data
    assert "timed out" in data["error"].lower()
    assert len(data["mappings"]) == 1
    assert data["mappings"][0]["selector"] == "#email"
    assert data["mappings"][0]["value"] == "jane@example.com"


async def test_autofill_analyze_no_timeout_on_fast_response(app, client, mock_ai_client):
    """A fast AI response should succeed normally, no timeout error."""

    mock_ai_client.chat = AsyncMock(return_value=json.dumps([
        {"field_name": "email", "value": "test@example.com", "confidence": 0.9}
    ]))
    app.state.ai_client = mock_ai_client

    resp = await client.post(
        "/api/autofill/analyze",
        json={"form_html": "<form><input name='email'></form>", "fields": [{"name": "email"}]},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert "error" not in data
    assert isinstance(data["mappings"], list)
    assert len(data["mappings"]) == 1


# ─── _deterministic_fill phone field matching ──────────────────

PROFILE = {
    "full_name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "(555) 123-4567",
    "phone_country_code": "+1",
    "address_country_name": "United States",
}


def test_deterministic_fill_matches_bare_phone_field():
    """Greenhouse #phone (name='phone', id='phone') should match deterministically."""
    fields = [
        {"selector": "#phone", "name": "phone", "id": "phone", "label": "Phone",
         "tag": "input", "type": "text", "placeholder": "", "currentValue": ""},
    ]
    mappings, remaining = _deterministic_fill(fields, PROFILE)
    assert len(mappings) == 1
    assert mappings[0]["selector"] == "#phone"
    assert mappings[0]["value"] == "(555) 123-4567"
    assert mappings[0]["action"] == "fill_text"
    assert remaining == []


def test_deterministic_fill_matches_phone_number_field():
    """Fields with name='phone_number' should still match."""
    fields = [
        {"selector": "#phone_number", "name": "phone_number", "id": "phone_number",
         "label": "Phone Number", "tag": "input", "type": "tel",
         "placeholder": "", "currentValue": ""},
    ]
    mappings, remaining = _deterministic_fill(fields, PROFILE)
    assert len(mappings) == 1
    assert mappings[0]["value"] == "(555) 123-4567"


def test_deterministic_fill_excludes_phone_country_code():
    """phone_country_code must be skipped (Stage 1 fail-safe), not filled as phone."""
    fields = [
        {"selector": "#phone_country_code", "name": "phone_country_code",
         "id": "phone_country_code", "label": "Phone Country Code",
         "tag": "select", "type": "", "placeholder": "", "currentValue": "",
         "options": [{"text": "United States (+1)", "value": "US"}]},
    ]
    mappings, remaining = _deterministic_fill(fields, PROFILE)
    assert len(mappings) == 1
    assert mappings[0]["action"] == "skip"
    assert mappings[0]["reason"] == "phone_country_manual_review"
    assert mappings[0]["fieldKind"] == "phone_country"


def test_deterministic_fill_excludes_phone_extension():
    """phone_extension fields should NOT be filled with the phone number."""
    fields = [
        {"selector": "#phone_ext", "name": "phone_extension",
         "id": "phone_ext", "label": "Phone Extension",
         "tag": "input", "type": "text", "placeholder": "", "currentValue": ""},
    ]
    mappings, remaining = _deterministic_fill(fields, PROFILE)
    # _is_excluded blocks phone-pattern rules for extension fields,
    # so the field falls to remaining (handled by AI)
    phone_mappings = [m for m in mappings if m["value"] == PROFILE["phone"]]
    assert phone_mappings == [], "phone extension field must not be filled with the phone number"


def test_deterministic_fill_greenhouse_phone_and_country_code():
    """Phone number fills; phone-country is left for manual review."""
    fields = [
        {"selector": "#phone_country_code", "name": "phone_country_code",
         "id": "phone_country_code", "label": "Phone Country Code",
         "tag": "select", "type": "", "placeholder": "", "currentValue": "",
         "options": [{"text": "United States (+1)", "value": "US"}]},
        {"selector": "#phone", "name": "phone", "id": "phone", "label": "Phone",
         "tag": "input", "type": "text", "placeholder": "", "currentValue": ""},
    ]
    mappings, remaining = _deterministic_fill(fields, PROFILE)
    assert len(mappings) == 2
    assert remaining == []
    phone_mapping = next(m for m in mappings if m["selector"] == "#phone")
    code_mapping = next(m for m in mappings if m["selector"] == "#phone_country_code")
    assert phone_mapping["value"] == "(555) 123-4567"
    assert phone_mapping["action"] == "fill_text"
    assert code_mapping["action"] == "skip"
    assert code_mapping["reason"] == "phone_country_manual_review"


def test_deterministic_fill_ignores_phone_nearby_heading():
    """A shared parent heading of 'Phone' must not fill GPA/essay with the phone number."""
    fields = [
        {"selector": "#gpa", "name": "gpa", "id": "gpa",
         "label": "What is your current cumulative GPA on a 4.0 scale?",
         "tag": "input", "type": "text", "placeholder": "", "currentValue": "",
         "nearbyHeading": "Phone"},
        {"selector": "#why", "name": "why", "id": "why",
         "label": "Why are you interested in this specific role?",
         "tag": "textarea", "type": "", "placeholder": "", "currentValue": "",
         "nearbyHeading": "Phone"},
    ]
    mappings, remaining = _deterministic_fill(fields, PROFILE)
    assert mappings == []
    assert len(remaining) == 2


def test_deterministic_fill_city_skips_work_authorization():
    profile = {**PROFILE, "address_city": "Sterling Heights", "authorized_to_work_us": "Yes"}
    fields = [
        {"selector": "#work_auth", "name": "work_auth", "id": "work_auth",
         "label": "Are you currently authorized to work in the United States?",
         "tag": "input", "type": "text", "placeholder": "", "currentValue": ""},
        {"selector": "#city", "name": "city", "id": "city", "label": "City",
         "tag": "input", "type": "text", "placeholder": "", "currentValue": ""},
    ]
    mappings, remaining = _deterministic_fill(fields, profile)
    assert any(m["selector"] == "#city" and m["value"] == "Sterling Heights" for m in mappings)
    assert not any(m["selector"] == "#work_auth" and m["value"] == "Sterling Heights" for m in mappings)


def test_match_phone_country_prefers_us_plus_one_not_albania():
    """'+1' must not substring-match Albania (+355) or Algeria (+213)."""
    options = [
        {"value": "AF", "text": "Afghanistan (+93)"},
        {"value": "AL", "text": "Albania (+355)"},
        {"value": "DZ", "text": "Algeria (+213)"},
        {"value": "AS", "text": "American Samoa (+1)"},
        {"value": "US", "text": "United States (+1)"},
        {"value": "CA", "text": "Canada (+1)"},
    ]
    assert _match_phone_country_option("United States (+1)", options) == "United States (+1)"
    assert _match_phone_country_option("+1", options) == "United States (+1)"
    assert _match_phone_country_option("1", options) == "United States (+1)"


def test_name_components_three_part_with_middle():
    profile = {
        "full_name": "Tanish Ashok Kalwad",
        "middle_name": "Ashok",
    }
    first, middle, last = _name_components(profile)
    assert first == "Tanish"
    assert middle == "Ashok"
    assert last == "Kalwad"


def test_name_components_explicit_fields_win():
    profile = {
        "full_name": "Wrong Name Here",
        "first_name": "Tanish",
        "middle_name": "Ashok",
        "last_name": "Kalwad",
    }
    assert _name_components(profile) == ("Tanish", "Ashok", "Kalwad")


def test_deterministic_fill_three_part_name():
    profile = {
        **PROFILE,
        "full_name": "Tanish Ashok Kalwad",
        "middle_name": "Ashok",
    }
    fields = [
        {"selector": "#first_name", "name": "first_name", "id": "first_name",
         "label": "First Name", "tag": "input", "type": "text", "placeholder": "", "currentValue": ""},
        {"selector": "#last_name", "name": "last_name", "id": "last_name",
         "label": "Last Name", "tag": "input", "type": "text", "placeholder": "", "currentValue": ""},
        {"selector": "#middle_name", "name": "middle_name", "id": "middle_name",
         "label": "Middle Name", "tag": "input", "type": "text", "placeholder": "", "currentValue": ""},
    ]
    mappings, _remaining = _deterministic_fill(fields, profile)
    by_sel = {m["selector"]: m["value"] for m in mappings}
    assert by_sel["#first_name"] == "Tanish"
    assert by_sel["#middle_name"] == "Ashok"
    assert by_sel["#last_name"] == "Kalwad"


def test_phone_sms_opt_in_not_filled_with_phone_number():
    fields = [
        {"selector": "#phone", "name": "phone", "id": "phone", "label": "Phone Number",
         "tag": "input", "type": "tel", "placeholder": "", "currentValue": ""},
        {"selector": "[data-automation-id='phone-sms-opt-in']", "name": "phone-sms-opt-in",
         "id": "phone-sms-opt-in", "label": "phone-sms-opt-in",
         "tag": "input", "type": "checkbox", "placeholder": "", "currentValue": ""},
    ]
    mappings, remaining = _deterministic_fill(fields, PROFILE)
    phone = next(m for m in mappings if m["selector"] == "#phone")
    assert phone["value"] == PROFILE["phone"]
    assert not any(m["selector"] == "[data-automation-id='phone-sms-opt-in']" for m in mappings)
    assert any(f.get("id") == "phone-sms-opt-in" for f in remaining)


def test_work_auth_not_filled_with_country_name():
    profile = {
        **PROFILE,
        "address_country_name": "United States",
        "authorized_to_work_us": "yes",
    }
    fields = [
        {"selector": "input[name='work_auth']", "name": "work_auth", "id": "",
         "label": "Are you currently authorized to work in this country?",
         "tag": "input", "type": "radio", "placeholder": "", "currentValue": "",
         "options": [{"value": "yes", "label": "Yes"}, {"value": "no", "label": "No"}]},
        {"selector": "#address_country", "name": "country", "id": "address_country",
         "label": "Country*", "tag": "select", "type": "", "placeholder": "", "currentValue": "",
         "options": [{"text": "United States", "value": "US"}, {"text": "Albania", "value": "AL"}]},
        {"selector": "#phone_country_trigger", "name": "", "id": "phone_country_trigger",
         "label": "Select country", "tag": "button", "type": "", "placeholder": "",
         "currentValue": "", "fieldKind": "phone_country"},
    ]
    mappings, _remaining = _deterministic_fill(fields, profile)
    work = next(m for m in mappings if "work_auth" in m["selector"])
    assert work["value"] == "yes"
    assert work["action"] == "click_radio"
    assert work["value"] != "United States"
    addr = next(m for m in mappings if m["selector"] == "#address_country")
    assert addr["value"] == "United States"
    phone_cc = next(m for m in mappings if m["selector"] == "#phone_country_trigger")
    assert phone_cc["action"] == "skip"
    assert phone_cc["fieldKind"] == "phone_country"
