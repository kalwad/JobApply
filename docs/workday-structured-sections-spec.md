# Workday structured sections (Stage 1.1 spec)

**Status:** Spec only — do **not** implement in PR #1.  
**Branch:** `stage1.1/structured-ats-profile` (after PR #1 merge)

## Goal

Deterministic, reviewable automation for Workday **My Experience** (and similar) repeated sections. JobApply must never silently no-op and never click page-level **Save and Continue** or final **Submit**.

## Section plan UI (before any Add clicks)

```
Workday — My Experience

Work Experience     3 profile / 0 present / 3 proposed
Education           1 profile / 0 present / 1 proposed
Certifications      0 proposed
Skills              N proposed
Resume/CV           Default: <filename>
Websites            …
Social URLs         LinkedIn …
Projects            … (first-class model)
```

User approves the plan. Only then may JobApply click section-level **Add**.

## Repeated entry loop

For each approved work/education/cert entry:

1. Click section **Add**
2. Fill one verified profile entry
3. Verify fields
4. Save *internal* entry (or pause for user Save if Stage 1.1 initial build)
5. Verify the entry appears in the list
6. Deduplicate before adding the next

### Dedup keys

| Section | Key |
|---------|-----|
| Work | normalized company + title + start date |
| Education | school + degree + graduation year |
| Certification | name + issuer |
| Project | name + organization/type + start date |

## Projects (first-class)

Fields: name, type (`personal|academic|open_source|research`), role, organization, location, dates/current, URL/GitHub/demo, technologies, summary, bullets, sort_order.

### ATS mapping priority

1. Dedicated Projects section  
2. Portfolio / Additional Experience / Other Experience  
3. Explicitly approved Work Experience fallback (**off by default**)

Work Experience fallback must: place projects after real employment; require per-application approval; label Personal/Academic/Open-Source Project (or real org); never imply paid employment.

## Out of scope for PR #1

Same-URL section *detection* and toolbar ack live in Stage 1. Full Add→fill→save orchestration is Stage 1.1.
