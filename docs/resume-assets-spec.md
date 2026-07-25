# Résumé file assets & ATS attachment (Stage 1.1 spec)

**Status:** Spec only — do **not** implement in PR #1.  
**Branch:** after `stage1.1/inline-ai-qa` (or parallel with `stage1.1/structured-ats-profile`)

## Problem

Extracted résumé **text** is not an ATS attachment. The extension’s `upload_file` action correctly refuses silent DataTransfer attach until real assets exist.

## Required capabilities

1. Preserve the original uploaded PDF/DOCX as a binary asset  
2. Multiple résumé versions (base + job-specific later)  
3. Default résumé selection in profile / Resume Studio  
4. Reviewable Greenhouse / Lever / Workday file attachment  
5. Filename verification after the ATS shows the attached name  

## Out of scope here

Job-specific keyword rewriting and true one-page optimization → `stage2/job-tailored-resume`.
