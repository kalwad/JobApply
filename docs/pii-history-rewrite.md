# PII history rewrite (unmerged PR branch)

**Date:** 2026-07-25  
**Owner approval:** explicit (rewrite unmerged PR branch history)  
**Scope:** `stage1/slim-autofill` only — **not** `main`

## Backup (local, not pushed)

```text
backup/pre-pii-rewrite-20260725  →  tip before rewrite
```

## Replacement

| Pattern | Replacement |
|---------|-------------|
| Real 10-digit phone previously used in `extension/tests/content.test.js` fixtures | `5551234567` |

No street address, Apple relay email, or LinkedIn profile URL was found in branch history during the pre-rewrite scan.

## Verification

After rewrite + force-push:

```bash
git log --all -S'<old-phone>' --oneline   # expect empty on rewritten tip history
git grep -n '<old-phone>' origin/stage1/slim-autofill
```

Do not restate the real phone number in commits, issues, or docs.
