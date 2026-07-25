# Attribution

JobApply is a fork and derivative work of open-source projects. This file records upstream sources and license notices that must be preserved.

## CareerPulse (primary foundation)

- **Project:** CareerPulse
- **Repository:** https://github.com/tcpsyn/CareerPulse
- **Upstream remote in this repo:** `upstream`
- **Baseline tag:** `baseline/careerpulse-upstream`
- **License:** MIT License
- **Copyright:** Copyright (c) 2026 Luke MacNeil / MacNeil Media Group, LLC  
  https://macneilmediagroup.com

Substantial portions of this codebase — including the FastAPI backend, SQLite data layer, Chrome Manifest V3 autofill extension, Workday/Greenhouse/Lever ATS adapters, AI provider abstraction (including Ollama), and automated tests — originate from CareerPulse.

The original MIT license text is retained in [`LICENSE`](LICENSE).

## Little AI Helper / job-autofill-extension (architectural inspiration)

- **Project:** job-autofill-extension (also referred to as Little AI Helper)
- **Repository:** https://github.com/ritsth/job-autofill-extension
- **License:** MIT License
- **Copyright:** Copyright (c) 2026 Ritika Shrestha

JobApply studies this project's TypeScript ATS adapter organization and grounded answer-prompt design. Any substantial code copied from that repository must retain its MIT copyright notice in the relevant files.

## Resume Tailor AI (conceptual inspiration only)

Ideas such as a verified fact bank and a render-and-count one-page fitting loop are inspired by public descriptions of Resume Tailor AI–style tools. **No code from those projects is copied into JobApply** unless and until a clear root-level LICENSE is verified and attribution is added here.
