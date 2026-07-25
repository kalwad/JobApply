# Inline AI Q&A (Stage 1.1 spec)

**Status:** Spec only — do **not** implement in PR #1.  
**Branch:** `stage1.1/inline-ai-qa` (after semantic autofill patch is stable)

## Product (Simplify-style)

Do not ask a local 8B model to map an entire application in one request.

```
Page loads
    ↓
Eligible open-ended questions get “Generate with JobApply”
    ↓
Click → generate ONE answer for that question
    ↓
Preview + supporting profile facts + character count
    ↓
Use saved / Generate / Regenerate / Edit / Insert / Save to Q&A / Cancel
```

## Eligibility

Inject beside textarea / long-answer text inputs only.

**Never inject** for: legal acknowledgments, demographic/EEO, consent, signatures, ordinary contact fields, work authorization, sponsorship, salary comfort, Ontario residence, recording policies.

## Request payload (per question)

- Exact question text + nearby heading  
- Job title / company / description (if known)  
- Character / word limit (`maxlength`)  
- Verified profile subset + relevant work/projects  
- Matching saved Q&A pairs  

Timeout affects **only** that question. Deterministic profile fills must not wait on the model.

## Grounding

Never invent employers, tools, metrics, qualifications, or eligibility. Return supporting profile fact IDs for factual claims.

## Test fixtures

Sanitized versions of:

- Current teams / business problems  
- Current tech stack  
- Proudest project  
- Why this company  
