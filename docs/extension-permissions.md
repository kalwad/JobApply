# JobApply extension permissions (Stage 1)

## Declared permissions

| Permission | Why it is required |
|---|---|
| `activeTab` | User-triggered autofill on the tab the user is viewing |
| `scripting` | Inject/coordinate content scripts when the user starts fill |
| `storage` | Persist local safety flags (`overwriteExistingFields`, `debugAutofill`, etc.) |
| `downloads` | Optional resume/cover-letter download helpers on application pages |
| `webNavigation` | Enumerate tab frames so Fill reaches Greenhouse/Lever iframe embeds |

## Host access

| Entry | Scope | Why |
|---|---|---|
| `host_permissions`: `http://localhost:8085/*` | Local JobApply backend only | Profile, custom Q&A, and autofill analysis stay on the user’s machine |
| `content_scripts.matches`: `<all_urls>` | Broad page injection | Workday, Greenhouse, Lever, and employer career sites use many domains and subdomains. Narrow static match lists miss real applications. Autofill still requires an explicit user action (popup, badge, or shortcut) and review-before-fill |

Stage 1 does **not** request broad `host_permissions` for the open web. The content script can run on application pages, but network calls from the extension go only to the local backend unless the user configures a cloud AI provider in JobApply settings.

## Logging

Ordinary console logging does not print profile values or proposed answers. Set `chrome.storage.local.debugAutofill = true` for redacted debug output.
