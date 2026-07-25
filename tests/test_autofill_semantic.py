"""Contract tests: ATS semanticType survives to deterministic fill."""

import pytest

from app.routers.autofill import (
    _compose_location,
    _current_company,
    _deterministic_fill,
    _expand_language_mappings,
    _match_language_option,
    _normalize_url,
    _semantic_mapping_for_field,
    _strip_blank_mappings,
)


def test_normalize_url_adds_https():
    assert _normalize_url("tanishkalwad.com") == "https://tanishkalwad.com"
    assert _normalize_url("https://github.com/x") == "https://github.com/x"
    assert _normalize_url("") == ""


def test_match_language_option_english_code():
    opts = [
        {"value": "English", "label": "English (ENG)"},
        {"value": "Spanish", "label": "Spanish (SPA)"},
        {"value": "Other", "label": "Other"},
    ]
    assert _match_language_option("English", opts)["value"] == "English"
    assert _match_language_option("ENG", opts)["value"] == "English"
    assert _match_language_option("Hindi", opts) is None


def test_expand_language_mappings_multi_checkbox():
    field = {
        "selector": 'input[name="cards[languages]"]',
        "name": "cards[languages]",
        "type": "checkbox",
        "label": "Language Skill(s)",
        "options": [
            {"value": "English", "label": "English (ENG)"},
            {"value": "Spanish", "label": "Spanish (SPA)"},
            {"value": "Hindi", "label": "Hindi (HIN)"},
            {"value": "Other", "label": "Other"},
            {"value": "decline", "label": "Choose not to disclose"},
        ],
    }
    profile = {
        "languages": [
            {"language": "English"},
            {"language": "Hindi"},
            {"language": "Klingon"},
        ],
    }
    maps = _expand_language_mappings(field, profile)
    assert len(maps) == 2
    assert all(m["action"] == "check_checkbox" and m["value"] == "yes" for m in maps)
    sels = {m["selector"] for m in maps}
    assert 'input[name="cards[languages]"][value="English"]' in sels
    assert 'input[name="cards[languages]"][value="Hindi"]' in sels
    assert not any("Other" in m["selector"] or "disclose" in m["field_label"].lower() for m in maps)


def test_deterministic_languages_emits_per_option():
    profile = {
        "languages": [{"language": "English"}, {"language": "Spanish"}],
    }
    mappings, _remaining = _deterministic_fill(
        [{
            "selector": 'input[name="cards[languages]"]',
            "name": "cards[languages]",
            "type": "checkbox",
            "tag": "input",
            "label": "Language Skill(s) (Check all that apply)",
            "semanticType": "languages",
            "currentValue": "",
            "options": [
                {"value": "English", "label": "English (ENG)"},
                {"value": "Spanish", "label": "Spanish (SPA)"},
                {"value": "Other", "label": "Other"},
            ],
        }],
        profile,
    )
    fillable = [m for m in mappings if m.get("action") == "check_checkbox"]
    assert len(fillable) == 2


def test_compose_location_prefers_free_text():
    assert _compose_location({"location": "Sterling Heights, MI"}) == "Sterling Heights, MI"
    assert _compose_location({
        "address_city": "Ann Arbor",
        "address_state": "MI",
        "address_country_name": "United States",
    }) == "Ann Arbor, MI, United States"


def test_current_company_single_current():
    company, err = _current_company({
        "work_history": [
            {"company": "OldCo", "is_current": 0},
            {"company": "PulseMo", "is_current": 1},
        ],
    })
    assert company == "PulseMo"
    assert err is None


def test_current_company_ambiguous():
    company, err = _current_company({
        "work_history": [
            {"company": "A", "is_current": 1},
            {"company": "B", "is_current": 1},
        ],
    })
    assert company is None
    assert err == "ambiguous_multiple_current_jobs"


def test_semantic_linkedin_and_portfolio():
    profile = {
        "linkedin_url": "https://www.linkedin.com/in/tanish",
        "github_url": "https://github.com/kalwad",
        "portfolio_url": "tanishkalwad.com",
    }
    linkedin = _semantic_mapping_for_field(
        {"selector": 'input[name="urls[LinkedIn]"]', "semanticType": "linkedin_url", "label": "LinkedIn"},
        profile,
    )
    assert linkedin["value"] == "https://www.linkedin.com/in/tanish"
    assert linkedin["action"] == "fill_text"

    portfolio = _semantic_mapping_for_field(
        {"selector": 'input[name="urls[Portfolio]"]', "semanticType": "portfolio_url", "label": "Portfolio"},
        profile,
    )
    assert portfolio["value"] == "https://tanishkalwad.com"


def test_lever_github_lowercase_h_and_other_website():
    """Live Lever uses urls[Github] and urls[Other Website], not urls[GitHub]/urls[Portfolio]."""
    profile = {
        "full_name": "Tanish Kalwad",
        "email": "t@example.com",
        "linkedin_url": "https://www.linkedin.com/in/tanish",
        "github_url": "https://github.com/kalwad",
        "portfolio_url": "tanishkalwad.com",
        "website_url": "tanishkalwad.com",
    }
    fields = [
        {
            "selector": 'input[name="urls[LinkedIn]"]',
            "name": "urls[LinkedIn]",
            "label": "LinkedIn URL",
            "type": "text",
            "tag": "input",
            "semanticType": "linkedin_url",
            "currentValue": "",
        },
        {
            "selector": 'input[name="urls[Github]"]',
            "name": "urls[Github]",
            "label": "Github URL",
            "type": "text",
            "tag": "input",
            "semanticType": "github_url",
            "currentValue": "",
        },
        {
            "selector": 'input[name="urls[Other Website]"]',
            "name": "urls[Other Website]",
            "label": "Other Website URL",
            "type": "text",
            "tag": "input",
            "semanticType": "website",
            "currentValue": "",
        },
    ]
    mappings, remaining = _deterministic_fill(fields, profile)
    assert not remaining
    by = {m["selector"]: m for m in mappings}
    assert "linkedin.com" in by['input[name="urls[LinkedIn]"]']["value"]
    assert "github.com" in by['input[name="urls[Github]"]']["value"]
    assert by['input[name="urls[Other Website]"]']["value"].startswith("https://")


def test_semantic_beats_fuzzy_for_org():
    profile = {
        "full_name": "Tanish Kalwad",
        "email": "t@example.com",
        "work_history": [{"company": "PulseMo", "is_current": 1}],
    }
    fields = [{
        "selector": 'input[name="org"]',
        "name": "org",
        "label": "Current company",
        "type": "text",
        "tag": "input",
        "semanticType": "current_company",
        "currentValue": "",
    }]
    mappings, remaining = _deterministic_fill(fields, profile)
    assert not remaining
    assert mappings[0]["value"] == "PulseMo"
    assert mappings[0]["inventoryCategory"] == "filled_from_profile"


def test_canada_work_auth_not_filled_from_us():
    profile = {"authorized_to_work_us": "Yes", "requires_sponsorship": "No"}
    fields = [{
        "selector": "#canada_auth",
        "name": "work_auth_canada",
        "label": "Do you have a legal right to work in Canada if hired?",
        "type": "select",
        "tag": "select",
        "semanticType": "work_authorization",
        "currentValue": "",
        "options": [{"value": "yes", "text": "Yes"}, {"value": "no", "text": "No"}],
    }]
    mappings, _ = _deterministic_fill(fields, profile, page_url="https://boards.greenhouse.io/x")
    assert mappings[0]["action"] == "skip"
    assert mappings[0]["inventoryCategory"] == "legal_or_consent_manual"


def test_ontario_eligibility_manual_without_semantic():
    profile = {"address_city": "Sterling Heights", "authorized_to_work_us": "Yes"}
    fields = [{
        "selector": "#ontario",
        "name": "based_in_ontario",
        "label": "Please confirm you're based in Ontario, Canada",
        "type": "select",
        "tag": "select",
        "currentValue": "",
        "options": [{"value": "yes", "text": "Yes"}, {"value": "no", "text": "No"}],
    }]
    mappings, _ = _deterministic_fill(fields, profile)
    assert mappings[0]["action"] == "skip"
    assert "ontario" in (mappings[0].get("reason") or "") or mappings[0]["inventoryCategory"] == "legal_or_consent_manual"


def test_strip_none_mappings():
    cleaned = _strip_blank_mappings([
        {"selector": "#a", "value": None, "action": "fill_text"},
        {"selector": "#b", "value": "None", "action": "fill_text"},
        {"selector": "#c", "value": "Ada", "action": "fill_text"},
        {"selector": "#d", "value": "", "action": "skip", "reason": "manual"},
    ])
    by = {m["selector"]: m for m in cleaned}
    assert by["#a"]["action"] == "skip"
    assert by["#b"]["action"] == "skip"
    assert by["#c"]["value"] == "Ada"
    assert by["#d"]["action"] == "skip"


def test_empty_work_seniority_unknown_still_separate():
    # Sanity: semantic location mapping present
    m = _semantic_mapping_for_field(
        {"selector": "#loc", "semanticType": "current_location", "label": "Location (City)"},
        {"location": "Sterling Heights, MI, United States"},
    )
    assert "Sterling Heights" in m["value"]


@pytest.mark.asyncio
async def test_analyze_forwards_semantic_and_inventory(client, db):
    await client.post("/api/profile", json={
        "full_name": "Tanish Kalwad",
        "email": "kalwad@umich.edu",
        "phone": "2488322855",
        "linkedin_url": "https://www.linkedin.com/in/tanish-kalwad-56434235b/",
        "github_url": "https://github.com/kalwad",
        "portfolio_url": "tanishkalwad.com",
        "location": "Sterling Heights, MI",
        "address_city": "Sterling Heights",
        "address_state": "MI",
    })
    await db.save_work_history({
        "company": "PulseMo Technologies",
        "job_title": "Engineer",
        "start_year": 2024,
        "is_current": 1,
    })
    resp = await client.post("/api/autofill/analyze", json={
        "ats_name": "Lever",
        "page_url": "https://jobs.lever.co/palantir/abc",
        "ats_field_map": {"input[name='org']": "current_company"},
        "fields": [
            {
                "selector": 'input[name="urls[LinkedIn]"]',
                "name": "urls[LinkedIn]",
                "label": "LinkedIn URL",
                "type": "url",
                "tag": "input",
                "semanticType": "linkedin_url",
                "currentValue": "",
            },
            {
                "selector": 'input[name="urls[GitHub]"]',
                "name": "urls[GitHub]",
                "label": "GitHub URL",
                "type": "url",
                "tag": "input",
                "semanticType": "github_url",
                "currentValue": "",
            },
            {
                "selector": 'input[name="urls[Portfolio]"]',
                "name": "urls[Portfolio]",
                "label": "Portfolio URL",
                "type": "url",
                "tag": "input",
                "semanticType": "portfolio_url",
                "currentValue": "",
            },
            {
                "selector": 'input[name="org"]',
                "name": "org",
                "label": "Current company",
                "type": "text",
                "tag": "input",
                "semanticType": "current_company",
                "currentValue": "",
            },
            {
                "selector": "#resume",
                "name": "resume",
                "label": "Resume/CV",
                "type": "file",
                "tag": "input",
                "semanticType": "resume_file",
                "currentValue": "",
            },
            {
                "selector": "#proud",
                "name": "cards[proud]",
                "label": "What has been your favorite project?",
                "type": "text",
                "tag": "textarea",
                "semanticType": "open_ended_question",
                "currentValue": "",
            },
        ],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("ats_name") == "Lever"
    assert "inventory" in data
    by = {m["selector"]: m for m in data["mappings"]}
    assert "linkedin.com" in by['input[name="urls[LinkedIn]"]']["value"]
    assert "github.com" in by['input[name="urls[GitHub]"]']["value"]
    assert by['input[name="urls[Portfolio]"]']["value"].startswith("https://")
    assert by['input[name="org"]']["value"] == "PulseMo Technologies"
    assert by["#resume"]["inventoryCategory"] == "file_attachment_unavailable"
    assert by["#proud"]["inventoryCategory"] == "ai_draft_available"
    # No None/null proposed values
    for m in data["mappings"]:
        if m.get("action") not in ("skip", "upload_file"):
            assert m.get("value") not in (None, "None", "null", "")
