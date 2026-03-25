# Task 11: Interview Detail Panel — UX Design Spec

## Overview

A slide-out drawer panel triggered by clicking an interview event (from calendar or pipeline). Split layout: interview info on the left, compact salary calculator on the right. Read-only by default with Edit toggle for the calculator.

---

## Trigger Points

1. **Calendar view**: Click an interview event chip or agenda item
2. **Pipeline board**: Click an interview card in the "Interviewing" column (if interview data exists)
3. **Job detail view**: Click an interview round card in the timeline (from Task 10)

All triggers call the same `openInterviewPanel(roundId, jobId)` function.

---

## Panel Type: Slide-Out Drawer

Use a right-edge drawer (not a centered modal) to preserve context behind it. This aligns with the existing nav-drawer pattern on mobile, scaled up for desktop.

### Why drawer over modal:
- Split content needs ~900px width — too wide for a centered modal
- Calendar/pipeline stays visible behind the semi-transparent backdrop
- Feels like a detail expansion, not a context switch
- Esc or backdrop click to dismiss (consistent with existing modal)

### Dimensions:
- **Desktop (>768px)**: width `min(920px, 90vw)`, full viewport height, right-aligned
- **Mobile (<=768px)**: full width, full height (stacks vertically)
- Slide-in from right with 250ms ease-out transition

---

## Layout

```
+--backdrop (rgba overlay)----------------------------------+
|                                                           |
|   +--drawer panel------------------------------------+    |
|   |  [x] Interview Detail           [Edit] toggle    |    |
|   |--------------------------------------------------|    |
|   |                    |                              |    |
|   |  INTERVIEW INFO    |  SALARY CALCULATOR           |    |
|   |  (left, ~55%)      |  (right, ~45%)               |    |
|   |                    |                              |    |
|   |  Round badge       |  Stat cards (2x2 grid):     |    |
|   |  Job title/company |  - Gross Annual              |    |
|   |  Date & time       |  - Total Taxes               |    |
|   |  Duration          |  - Take-Home                 |    |
|   |  Location/link     |  - Effective Rate             |    |
|   |  Interviewer       |                              |    |
|   |  Status controls   |  Employment type toggle      |    |
|   |  Notes             |  Filing status toggle        |    |
|   |                    |  State dropdown              |    |
|   |  [View Full Job]   |  Donut chart (compact)       |    |
|   |                    |                              |    |
|   +--------------------------------------------------+    |
|                                                           |
+-----------------------------------------------------------+
```

### Mobile stacked layout (<=768px):
```
+--drawer (full screen)--------------------+
|  [x] Interview Detail       [Edit]       |
|------------------------------------------|
|  INTERVIEW INFO (full width)             |
|  Round badge, job, date, interviewer...  |
|  Status controls, notes                  |
|------------------------------------------|
|  SALARY CALCULATOR (full width)          |
|  Stat cards (2x2), toggles, chart       |
+------------------------------------------+
```

---

## Left Panel: Interview Info

### Header Section
- **Round badge**: Pill with round number and label, e.g. `Round 1 — Phone Screen`
  - Background: `var(--accent-light)`, text: `var(--accent)`, font-weight 600
- **Job title**: 1.125rem, font-weight 700, `var(--text-primary)`
- **Company**: 0.875rem, `var(--text-secondary)`

### Details Grid (2-column, label:value pairs)
| Field | Format |
|-------|--------|
| Date | `formatDate()` with day of week, e.g. "Tue, Apr 10, 2026" |
| Time | "3:00 PM — 4:00 PM" (derived from scheduled_at + duration_min) |
| Duration | "60 min" |
| Location | Clickable link if URL (Zoom/Teams), plain text otherwise |
| Interviewer | Name + title, e.g. "Sarah Chen, Senior Recruiter" |

- Grid: `display: grid; grid-template-columns: auto 1fr; gap: 8px 16px;`
- Labels: 0.8125rem, font-weight 500, `var(--text-tertiary)`, right-aligned
- Values: 0.875rem, `var(--text-primary)`

### Status Controls
- **Status badge**: Pill next to round badge
  - `scheduled`: blue (`var(--accent)`)
  - `completed`: green (`var(--score-green)`)
  - `cancelled`: red (`var(--danger)`)
- **Status select dropdown**: Same style as existing `.filter-select`
- **Mark Complete button**: `btn btn-primary btn-sm`, only visible when status is `scheduled`

### Notes Section
- Textarea (read-only by default, editable in edit mode)
- Placeholder: "No notes for this round"
- Max-height 120px with scroll
- "Save Notes" button appears when content changes

### Footer Action
- **"View Full Job Detail →"** link: navigates to `#/job/{jobId}`, closes the drawer
- Style: `var(--accent)`, 0.875rem, font-weight 500

---

## Right Panel: Compact Salary Calculator

### Data Pre-population
From the job record:
- `salary_min` → sets the `calc-salary` input
- If hourly rate detected (job tags or salary < 500 suggesting hourly): switch to hourly mode
- State: attempt to parse from `job.location` (e.g., "San Francisco, CA" → "CA"), fallback to user's saved calc settings
- Employment type: infer from job tags if present (e.g., "contract" → 1099), fallback to W2

### Read-Only Mode (Default)
- All inputs appear as styled read-only text, not disabled inputs
- Background: `var(--bg-surface-secondary)` instead of white
- Toggle group buttons show active selection but are not clickable
- Stat cards still animate on load
- Donut chart renders normally

### Edit Mode
- Toggle button in panel header: "Edit" / "Editing" with pencil icon
- When toggled on:
  - Input backgrounds switch to `var(--bg-surface)` with border
  - Toggle groups become interactive
  - State dropdown becomes active
  - Subtle border glow on the right panel: `box-shadow: inset 0 0 0 2px var(--accent-light)`
- Changes are **ephemeral** — not saved back to the job. Show a subtle hint:
  - `font-size: 0.75rem; color: var(--text-tertiary);` — "Changes are for comparison only"

### Compact Stat Cards
- 2x2 grid instead of the full calculator's 4-column row
- Smaller padding: 12px instead of 20px
- Smaller font: stat-number at 1.25rem (vs 1.75rem in full calc)
- Stat labels at 0.6875rem

### Compact Donut Chart
- Height: 160px (vs 280px in full calc)
- Legend at bottom, condensed
- No bar comparison chart (too much for a side panel)

### Contract Job Enhancement
When `job.employment_type === 'contract'`:
- Show a small comparison row below the stat cards:
  ```
  W2: $X,XXX/mo  |  1099: $X,XXX/mo  |  C2C: $X,XXX/mo
  ```
- Uses `compareEmploymentTypes()` from salary-calculator.js
- Monthly take-home values: `Math.round(result.takeHome / 12)`
- Helps user quickly compare without needing the full calculator page
- Style: 0.75rem, `var(--text-secondary)`, flex row with `|` dividers

### No Breakdown Table
- Omit the detailed breakdown table in compact mode
- Users who want the full view can use the standalone Salary Calculator page

---

## CSS Classes

```css
/* --- Interview Detail Drawer --- */

.interview-drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 250;
    opacity: 0;
    transition: opacity 250ms ease;
}

.interview-drawer-backdrop.active {
    opacity: 1;
}

.interview-drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(920px, 90vw);
    background: var(--bg-main);
    box-shadow: -4px 0 24px rgba(0, 0, 0, 0.15);
    z-index: 251;
    transform: translateX(100%);
    transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.interview-drawer.open {
    transform: translateX(0);
}

.interview-drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}

.interview-drawer-header h2 {
    font-size: 1.125rem;
    font-weight: 700;
    margin: 0;
}

.interview-drawer-close {
    background: none;
    border: none;
    font-size: 1.25rem;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px 8px;
    border-radius: var(--radius-xs);
    transition: background var(--transition), color var(--transition);
}

.interview-drawer-close:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
}

.interview-drawer-body {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    flex: 1;
    overflow: hidden;
}

.interview-drawer-left {
    padding: 24px;
    overflow-y: auto;
    border-right: 1px solid var(--border);
}

.interview-drawer-right {
    padding: 24px;
    overflow-y: auto;
    background: var(--bg-surface-secondary);
}

/* Edit mode indicator */
.interview-drawer-right.editing {
    box-shadow: inset 0 0 0 2px var(--accent-light);
}

/* Edit toggle button */
.edit-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-surface-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    cursor: pointer;
    transition: all var(--transition);
}

.edit-toggle-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
}

.edit-toggle-btn.active {
    background: var(--accent-light);
    border-color: var(--accent);
    color: var(--accent);
}

/* Round badge */
.round-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    background: var(--accent-light);
    color: var(--accent);
    font-size: 0.8125rem;
    font-weight: 600;
    border-radius: var(--radius-full);
}

/* Interview status badge */
.interview-status-badge {
    display: inline-block;
    padding: 2px 10px;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: var(--radius-full);
    text-transform: capitalize;
}

.interview-status-badge[data-status="scheduled"] {
    background: var(--accent-light);
    color: var(--accent);
}

.interview-status-badge[data-status="completed"] {
    background: var(--score-green-bg);
    color: var(--score-green);
}

.interview-status-badge[data-status="cancelled"] {
    background: #fef2f2;
    color: var(--danger);
}

[data-theme="dark"] .interview-status-badge[data-status="cancelled"] {
    background: #450a0a;
}

/* Interview details grid */
.interview-details-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 16px;
    margin: 16px 0;
}

.interview-details-grid .detail-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-tertiary);
    text-align: right;
    padding-top: 1px;
}

.interview-details-grid .detail-value {
    font-size: 0.875rem;
    color: var(--text-primary);
}

/* Compact salary stat cards */
.compact-stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 16px;
}

.compact-stat-card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 12px;
    text-align: center;
}

.compact-stat-card .stat-number {
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    color: var(--text-primary);
    line-height: 1;
    margin-bottom: 4px;
}

.compact-stat-card .stat-label {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

/* Read-only calculator inputs */
.calc-readonly .calc-toggle-btn {
    pointer-events: none;
}

.calc-readonly .calc-input-group input,
.calc-readonly .calc-input-group select {
    background: var(--bg-surface-secondary);
    border-color: transparent;
    pointer-events: none;
    color: var(--text-primary);
}

/* Compact donut chart */
.compact-chart-wrap {
    height: 160px;
    margin-top: 16px;
}

/* Responsive: mobile stacks vertically */
@media (max-width: 768px) {
    .interview-drawer {
        width: 100vw;
    }

    .interview-drawer-body {
        grid-template-columns: 1fr;
        overflow-y: auto;
    }

    .interview-drawer-left {
        border-right: none;
        border-bottom: 1px solid var(--border);
        overflow: visible;
    }

    .interview-drawer-right {
        overflow: visible;
    }

    .compact-stat-grid {
        grid-template-columns: 1fr 1fr;
    }
}
```

---

## Interaction Specification

### Opening the Drawer
1. User clicks interview event → fetch interview round data + job data
2. Show backdrop with opacity fade (0 → 1, 250ms)
3. Slide drawer in from right (translateX 100% → 0, 250ms cubic-bezier)
4. Focus trap: Tab cycles within drawer, focus moves to close button initially
5. Body scroll locked while drawer is open (`overflow: hidden` on body)

### Closing the Drawer
- Click close (x) button
- Click backdrop
- Press Escape key
- Click "View Full Job Detail" link (navigates away)
- Reverse animation: slide out right + fade backdrop

### Edit Toggle
1. Default: "Edit" text with pencil icon (svg or unicode ✎)
2. Click toggles to "Editing" state:
   - Button gets `.active` class
   - Right panel gets `.editing` class
   - `.calc-readonly` class removed from calculator container
   - All inputs become interactive
3. Click again reverts to read-only
4. State is ephemeral — resets on drawer close

### Salary Pre-population Logic
```javascript
function prepopulateCalc(job) {
    const gross = job.salary_max || job.salary_min ||
                  job.salary_estimate_max || job.salary_estimate_min || 0;

    // Detect hourly vs salary — jobs have employment_type field:
    // "fulltime", "contract", "parttime", or null
    const isContract = job.employment_type === 'contract';
    const isHourly = isContract && gross > 0 && gross < 500;

    // Extract state from location (e.g., "San Francisco, CA" → "CA")
    const stateMatch = (job.location || '').match(/,\s*([A-Z]{2})\b/);
    const state = stateMatch ? stateMatch[1] : loadCalcSettings().state || 'TX';

    // Use job.employment_type to infer calculator type
    // DB values: "fulltime" → W2, "contract" → 1099 (user can toggle to C2C)
    let empType = 'w2';
    if (isContract) empType = '1099';

    return {
        payType: isHourly ? 'hourly' : 'salary',
        gross,
        rate: isHourly ? gross : null,
        salary: isHourly ? null : gross,
        employmentType: empType,
        filingStatus: loadCalcSettings().filing || 'single',
        state
    };
}
```

**Note**: The job's `employment_type` field is the primary signal. Only fall back to text parsing if `employment_type` is null. Contract jobs default to 1099 mode; users can toggle to C2C in edit mode.

### Keyboard Shortcuts
- `Escape`: Close drawer
- `E`: Toggle edit mode (when drawer is open and no input focused)
- `Tab` / `Shift+Tab`: Focus trap within drawer

---

## Accessibility Requirements

1. **ARIA roles**: Drawer has `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to header
2. **Focus management**: Focus moves to close button on open, returns to trigger element on close
3. **Focus trap**: Tab cannot leave the drawer while open
4. **Screen reader**: Backdrop has `aria-hidden="true"`, drawer content is announced
5. **Reduced motion**: Respect `prefers-reduced-motion`:
   ```css
   @media (prefers-reduced-motion: reduce) {
       .interview-drawer { transition: none; }
       .interview-drawer-backdrop { transition: none; }
   }
   ```
6. **Color contrast**: All status badges meet WCAG AA (4.5:1 for text)
7. **Read-only state**: Use `aria-readonly="true"` on calculator inputs, not `disabled` (preserves focus)

---

## Implementation Notes for Frontend Dev

1. **Function signature**: `openInterviewPanel(roundId, jobId)` — fetches both `/api/jobs/{jobId}/interviews/{roundId}` and `/api/jobs/{jobId}` in parallel
2. **Reuse `calculateSalary()`** from salary-calculator.js directly — don't duplicate the engine
3. **Reuse `renderDonutChart()`** — pass the compact canvas element; the chart is responsive
4. **DOM placement**: Append drawer to `document.body` (same as existing modal pattern)
5. **Cleanup**: Remove drawer DOM on close (same as `showModal` pattern)
6. **No persistence**: Calculator edits are not saved. Drawer state is fully ephemeral.
7. **CSS location**: Add new classes to `app/static/css/style.css` after the existing `.calc-*` rules (~line 1600)
