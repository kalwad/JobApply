# Job-specific résumé tailoring (Stage 2 spec)

**Status:** Spec only — do **not** implement in PR #1.  
**Branch:** `stage2/job-tailored-resume`

## Product (Simplify-style)

Generic “analyze my résumé → career titles” is an optional diagnostic, **not** the core workflow.

```
Open / capture a specific job
        ↓
Compare selected résumé vs job description
        ↓
Show Job Description Match % (explainable)
        ↓
[Improve Resume] → JobApply web UI for that job
        ↓
Select supported keywords to incorporate
        ↓
Grounded rewrite + before/after diff
        ↓
Recalculate match %
        ↓
Optional Optimize to 1 Page (render + measure PDF)
        ↓
Save job-specific PDF/DOCX → attach to application
```

## Scores (deterministic)

LLM may extract requirements; **application code** computes:

```
covered weighted requirements / total weighted requirements × 100
```

Show three numbers when useful:

- **Current match** — selected résumé vs posting  
- **Potential supported** — if verified profile facts were used  
- **After approved rewrite** — regenerated résumé vs posting  

### Keyword matrix

| Bucket | Selectable? |
|--------|-------------|
| Already present | n/a (shown) |
| Supported by profile, absent from résumé | yes |
| Related / synonymous wording | yes (with evidence) |
| Unsupported gaps | visible, **disabled** until user verifies the skill/experience |

Never insert unsupported keywords merely because the posting mentions them.

## Models

- **JobContext:** title, company, description, posting URL, application URL  
- **Base résumé:** generated from verified profile facts  
- **Job-specific asset:** PDF/DOCX + metadata + fact IDs for every changed claim  

## Improve Resume deep link

Extension shows:

```
Resume Match
Current résumé: <name>
Job-description match: 57%
[Improve Resume]
```

Opens local JobApply → Resume Studio → Tailor for Job for that context.

## One-page optimization

After content approval: render PDF → count real pages → tighten spacing/bullets/margins within limits → re-render → confirm page count. No character-count estimates as the sole metric.

## Related Stage 1.1

Original PDF/DOCX storage and ATS attachment handoff live in `stage1.1/structured-ats-profile`.
