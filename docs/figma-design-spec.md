# Roster App — Figma Design Spec

A structured handoff doc for rebuilding this product's UI in Figma. It covers design tokens, the shared component library, and a screen-by-screen layout spec for every page currently reachable in the app, across both shipped themes ("Maison Aurore" default, "Louis Vuitton"). An appendix covers a superseded legacy UI generation still present in the codebase but not routed to.

> Source: `roster-app/frontend/src` (React + TypeScript, CSS Modules). This doc describes what exists in code today so a designer can reconstruct it 1:1 in Figma — it is not a redesign.

---

## 1. Product & IA overview

**Product**: a boutique staff-roster scheduler. A client-side engine assigns staff to shifts based on skills, VIC (VIP client) coverage, seniority, gender balance and language requirements, then routes rosters through a submit → review → approve → publish workflow.

**Four portals**, mutually exclusive per logged-in user (routed by role), all sharing one sidebar shell:

```
/login                        Login (no shell)
/admin/*         [Admin]      Dashboard · Rosters · Staff · VIC Clients · Shifts · Rules · Leave
/approvals/*     [Approver]   Inbox · History
/staff/*         [Staff]      My Schedule · Leave (stub) · Team (stub)
/view/*          [Reader]     Published Rosters
```

A user with `regional_admin` or an `admin` boutique role lands in Admin; `approver` role → Approver; a linked `staffId` → Staff; otherwise → Reader (read-only fallback). Admins/approvers with multiple boutiques get a boutique switcher in the sidebar.

**Frame plan for Figma**: one page per portal, one artboard per screen listed in §5, at 1440×900 (desktop) and 390×844 (mobile) — breakpoint is 640px, see §6.

---

## 2. Design tokens

Two token systems coexist in the codebase; **only System A is live in the current product** (every routed screen uses it). System B belongs to the legacy generation (Appendix, §7) and is not used by anything a real session can navigate to today — reproduce System A as Figma variables; keep System B only if the legacy appendix screens are wanted for reference.

### 2A. Current design system tokens ("dash" tokens — build these as Figma variables with Light/Dark modes)

| Token | Light | Dark | Used for |
|---|---|---|---|
| `border` | `#E0DDD7` | `#243050` | hairlines, table/card borders |
| `text` | `#1A1F2B` | `#E4E0D8` | primary text |
| `muted` | `#6B7280` | `#8090A8` | secondary text, labels |
| `surface` | `#FFFFFF` | `#141C2C` | cards, modals, inputs |
| `hover` | `#F5F3EF` | `#1A2438` | row/card hover background |
| `accent` | `#B8973A` | `#C9A84C` | primary actions, focus rings, active nav, links |

Sidebar-specific (always dark, doesn't flip with theme):
| Token | Value |
|---|---|
| `nav-bg` | `#0F1823` |
| `nav-surface` | `#162030` |
| `nav-text` | `#C8D0DC` |
| `nav-muted` | `#5A6A80` |
| `nav-accent` | `#B8973A` |
| `nav-active-bg` | `rgba(184,151,58,0.15)` |
| `nav-active-text` | `#C9A84C` |
| `main-bg` (light / dark) | `#F5F3EF` / `#0E1420` |

Semantic status colors (light / dark), used for badges, banners, chips:
| Status | Background | Text |
|---|---|---|
| Neutral / draft / archived | `#E8E6E2` / `#1E2838` | `#5A6270` / `#8090A8` |
| Blue (submitted, pending) | `#D4E3F5` / `#0A1828` | `#1E4A8C` / `#5A8ED4` |
| Green (approved, published) | `#D4EDE2` / `#0A2018` | `#1E6B4A` / `#3AAF78` |
| Amber (amended, warning, casual) | `#F5EDD4` / `#2A2210` | `#8A6010` / `#C9A84C` |
| Red (rejected, error, danger) | `#FAD4D4` / `#230808` | `#B81A1A` / `#D44A4A` |
| Danger button | `#B81A1A` (hover `#9A1212`) | white text |

Employment-type badges (StaffPage, light/dark): full_time `#dbeafe`/`#1d4ed8`, part_time `#dcfce7`/`#16a34a`, casual `#fef9c3`/`#854d0e`, contractor `#f3e8ff`/`#7e22ce` (dark variants at 20% alpha of the same hue, lighter text).

### Typography

- Body/UI font: **DM Sans** (all current portal screens).
- Display font: **Cormorant Garamond** (serif) — used by the brand mark / theme system (legacy screens); current portal screens are DM Sans throughout, no serif display type in the live product.
- Scale actually used in code: 11px (uppercase labels/eyebrows, letter-spacing 0.04–0.07em), 11.5–12.5px (meta text, chips), 13–13.5px (body/buttons/table), 14px (inputs, headings-small), 15px (modal titles), 1.15–1.35rem / ~18–21.6px (page titles, `font-weight:700`, `letter-spacing:-0.015em`).
- Weights: 400 body, 500 medium (labels, nav), 600 semibold (section titles, table headers, badges), 700 bold (page titles), 800 (single-letter brand mark).

### Spacing, radius, shape

- Border radius: 4px (small chips/badges), 5–6px (inputs, buttons, nav items), 8–10px (cards, modals), 20px (pill badges), 50% (avatars, toggle track).
- Card/section padding: 1–2rem (16–32px) desktop, reduced to ~1rem on mobile.
- Sidebar width: 220px expanded, 56px collapsed (desktop); mobile sidebar is an off-canvas drawer, `min(80vw, 280px)`.
- Standard page header padding: `1.75rem 2rem 1.25rem` with a bottom hairline border.
- Modal shadow: `0 8px 32px rgba(0,0,0,0.18)`; overlay `rgba(0,0,0,0.48)`.

### 2B. White-label brand theme tokens (`ClientTheme`, legacy-consuming only)

Defined per-client in `src/themes/*.ts`, applied via CSS custom properties (`--navy`, `--gold`, `--cream`, etc.) that only the legacy screens (§7) read. Two themes ship:

**"Maison Aurore" (default)**
| Token | Value |
|---|---|
| primary / primaryDeep / primaryMid | `#1E2761` / `#141D4A` / `#243080` |
| accent / accentLight | `#C9A84C` / `#E8D09A` |
| background / surface / surface2 | `#F7F5EF` / `#FFFFFF` / `#F7F5EF` |
| ink / muted / rule | `#1A1A1A` / `#6B6B6B` / `#E0DDD4` |
| warnBg / warnBorder | `#FEF3E2` / `#D97706` |
| greenBg / greenText | `#EAF3DE` / `#27500A` |
| vicBg / vicBorder / vicText | `#F5F0E8` / `#C9A84C` / `#7A5C1E` |
| shift morning bg/dot | `#1E4D8C` / `#5B8FCC` |
| shift afternoon bg/dot | `#4A3280` / `#9B85D4` |
| shift closing bg/dot | `#0F6E56` / `#3DB88A` |
| fonts | display `Cormorant Garamond`, body `DM Sans` |
| eyebrow copy | "Daily Roster" |

**"Louis Vuitton"** (noir/gold tonal register)
| Token | Value |
|---|---|
| primary / primaryDeep / primaryMid | `#1A1A1A` / `#000000` / `#2C2C2C` |
| accent / accentLight | `#B08B51` / `#D4B07A` |
| background / surface / surface2 | `#F5F0E8` / `#FFFFFF` / `#EDE8DE` |
| ink / muted / rule | `#0D0D0D` / `#6B6360` / `#DDD6CC` |
| warnBg / warnBorder | `#FEF3E2` / `#B08B51` |
| greenBg / greenText | `#E8F0E4` / `#1A3A18` |
| vicBg / vicBorder / vicText | `#F0E8D8` / `#B08B51` / `#7A5820` |
| shift morning bg/dot | `#1A2640` / `#7AAED4` |
| shift afternoon bg/dot | `#28183A` / `#9B85C8` |
| shift closing bg/dot | `#0D2820` / `#5AAD82` |
| fonts | same pairing |
| eyebrow copy | "Daily Roster · Elements" |

A `ClientSwitcher` demo widget (bottom-left floating pill bar, only visible with `?demo=true`) lets you toggle between registered brand themes live — worth a Figma component if the white-label pitch matters, but note it doesn't affect any current-generation portal screen.

---

## 3. Shared component library

Build these as Figma components with variants; every portal screen composes from this set.

### Button
Variants: `primary` (filled accent, white text), `secondary` (surface bg, bordered, text flips to accent on hover), `ghost` (transparent, muted text), `danger` (filled red). Sizes: `sm` (12.5px, 0.3×0.65rem padding), `md` (13.5px, 0.45×0.85rem padding). States: default / hover / disabled (50% opacity) / loading (spinner replaces leading icon slot, 12px, spinning). Radius 6px, font-weight 500, focus ring 2px accent w/ 2px offset.

### Modal
Centered overlay dialog, default max-width 520px (per-instance override). Structure: header (title 15px/600 + × close button) → scrollable body (1.5rem padding) → optional footer (right-aligned button row, top hairline). Escape key and backdrop click both close. On mobile (≤640px) footer buttons stretch to fill width equally.

### PageHeader
Every screen's top block: title (left, 700/1.35rem) + optional subtitle (13.5px muted, below title) + optional right-aligned actions slot (buttons). Bottom hairline border, `1.75rem 2rem 1.25rem` padding (mobile: `1.25rem 1rem 1rem`, title drops to 1.15rem).

### StatusBadge
Pill, uppercase, 11px/600, letter-spacing 0.04em, 2×7px padding, radius 20px. Maps `RosterStatus` → color per §2A semantic table: draft/archived=neutral, submitted/pending_review=blue, approved/published=green, published_amended=amber, rejected=red.

### Toggle
36×20px pill switch, thumb 16px circle with shadow, off = border-color track, on = accent track + thumb translates 16px right. Disabled = 45% opacity.

### Sidebar / AppShell (the persistent nav)
Fixed-height column, `nav-bg` background:
1. **Brand block** — 32px rounded-square avatar mark ("R" mark, accent bg) + wordmark "Roster" (collapsible).
2. **Portal badge** — uppercase small label (Admin/Approver/My Portal/View) + boutique name text, or a `<select>` boutique switcher if the user has access to more than one boutique.
3. **Nav list** — icon (emoji glyphs in source: ⊞ 📋 👥 ⭐ 🕐 ⚙️ 📅 for Admin; 📥 🗂️ for Approver; 📆 🏖️ 👥 for Staff; 👁️ for Reader) + label; active item gets accent-tinted background + accent text + medium weight.
4. **Footer** — user email (truncated) + sign-out icon-button ("↩").
5. **Collapse toggle** — small circular button on the sidebar's right edge (‹ / ›), desktop only.

Mobile (≤640px): sidebar becomes an off-canvas drawer (slides from left, 80vw/280px max) triggered by a hamburger in a new sticky top bar (52px, brand mark + wordmark), with a dark scrim behind it.

### Table pattern (repeats across Rosters, Staff, VIC, Leave, Shifts requirements)
Uppercase 11px/600 muted column headers with bottom hairline; body rows 13.5px, 0.75×1.25rem cell padding, bottom hairline per row, hover = `hover` token background. First column commonly carries an avatar/expand-chevron. Trailing column is often a blank "actions" slot (Edit/Delete text-buttons or icon buttons). Footer caption below the table: "{n} item(s)" in muted 13px.

### Form field pattern (repeats in every Add/Edit modal)
Label (12.5px/500 muted, optional red " *" for required) stacked above a control (text/number/date/time/select, 14px, bordered, 5px radius, border→accent on focus) with an optional hint line (11.5px muted) below. Multi-field modals lay fields out in a 2-column grid (`1fr 1fr`) that collapses to 1 column on mobile; a field can span both columns.

### Filter pills (Rosters list, Staff role filter in legacy)
Rounded pill buttons in a row, each showing a live count badge; active pill = accent-tinted background/border/text.

---

## 4. Cross-portal shared pattern: Roster Detail panel

Used identically inside Rosters (Admin), Approver Inbox/History, and Reader's Published Rosters — spec it once, reuse everywhere with only the edit affordance toggled.

**Meta bar**: "Score: **NN**" + (Admin only) pencil "Edit assignments" toggle → becomes Cancel/Save while editing · unmet-requirements count chip (amber) · rule-flag count chip (amber) · right-aligned "Generated {datetime}".

**Shift grid**: responsive card grid (`auto-fill, minmax(260px,1fr)` → 1 column mobile), one card per shift:
- Header: shift name + headcount badge "{assigned}/{target}" (amber if under target).
- Assignment chips: staff name, optional gold "VIC" tag, optional area label (editable `<select>` in edit mode), remove "✕" in edit mode.
- "+ Add staff" (edit mode only) → inline staff-picker + area-picker row.
- Staff-mix chips: Skill ✓/✗, Senior ✓/✗, VIC ✓/✗ (only if the roster has VIC clients), gender split "{pct}% F / {pct}% M" — green border/text if within policy, red if not.
- Languages line, and red "unmet requirement" chips ("{area}: {skill}: need {min}, have {assigned}").

**Rule flags section** (conditional): severity badge (Blocked=red / Caution/Warning=amber) + rule label ("Max hours/day", "Min rest hours", "VIC coverage", "Gender balance", "Day availability", etc.) + staff name + detail string.

**VIC coverage section** (conditional): one chip per client "{name} — {covered}/{total} shifts", green if fully covered else red.

---

## 5. Screen specs

### 5.0 Login (`/login`, no sidebar shell)
Centered card (380px max-width) on `login-bg`: brand mark + "Roster" wordmark → "Sign in" heading (700/1.2rem) → form: Email input, Password input (both labeled, full width) → inline error banner (red bg/text) if auth fails → primary "Sign in" submit button (full-width feel, loading spinner state).

### 5.1 Admin · Dashboard (`/admin`)
PageHeader "Dashboard" / subtitle = active boutique name. Two stacked sections, each an uppercase section label + a vertical list of clickable cards:
- **"Draft rosters"** — cards show date (14px/600, tabular numerals) + StatusBadge on one row, then "Score: {n}%" (or "—") and "· {n} override(s)" meta line below. Empty: "No drafts waiting. The overnight batch will generate them."
- **"Awaiting approval"** — same card shape, meta line instead shows "Deadline: {date}" when present. Empty: "No rosters pending approval."
Loading state: single "Loading…" line in place of both sections.

### 5.2 Admin · Rosters (`/admin/rosters`)
PageHeader "Rosters" / "Generate drafts, review assignments, and submit for approval". Toolbar: status filter pills (All/Draft/Submitted/Approved/Published/Rejected, each with a count) on the left, primary "Generate roster" button on the right.

Table columns: *(expand chevron)*, Date, Status, Score (color-coded ≥80 green / ≥60 amber / else red), Overrides (red chip if >0), Submit by, Actions.
Row actions by status: `draft`→Submit(secondary); `submitted`→Withdraw(ghost) +, if the admin also holds the approver role at this boutique, Approve(primary)/Reject(danger); `approved` (+approver role)→Publish(primary).
Expand chevron reveals the shared **Roster Detail panel** (§4), `canEdit=true` for admins.
Empty state: "No rosters yet. Click "Generate roster" to create one." (or status-specific variant). Footer: "{n} roster(s)".

**Generate roster modal** (400px): single "Roster date" date field + explanatory hint text → on success, green check + result summary replaces the form, footer becomes single "Close".

### 5.3 Admin · Staff (`/admin/staff`)
PageHeader "Staff" / "Manage staff records, boutique assignments and day-of-week availability". Toolbar: search input ("Search by name, HR ID or skill…") + primary "+ Add staff".

Table columns: Name (avatar circle with initial, colored per `avatar_color`, + name + small HR-ID line), Type (employment-type badge), Hrs/wk (numeric), Primary skill, Languages, Availability (day-of-week chips, or "All days" muted text if unrestricted), *(blank)* Edit action.
Footer: "{n} staff member(s)".

**Add/Edit staff modal** (580px), 2-col field grid: Full name*, HR ID, Employment type* (select: Full-time/Part-time/Casual/Contractor), Contracted hrs/week (number 0–60, step 0.5), Gender (select: Female/Male/Non-binary), Seniority (select: Junior/Senior/Manager), Primary skill (select, populated from boutique's skill types), Languages (free-text, comma-separated, spans both columns... actually single field), Available days (full-width chip toggle row Sun–Sat, hint "Leave unchecked for 'all days'").

### 5.4 Admin · VIC Clients (`/admin/vic`)
PageHeader "VIC Clients" / "Manage VIC client profiles, advisor assignments and upcoming appointments". Toolbar: search input + primary "+ Add client".

List of expandable client cards. Collapsed row: chevron, client name, tier badge (Platinum/Gold/Silver, color-coded), preferred-languages text, advisor pills (or "No advisor assigned"), "{n} upcoming" blue badge if any appointments, "Edit" action.
Expanded panel, two subsections:
- **Advisors** — removable tag list + "+ Assign advisor" inline select.
- **Upcoming appointments** — mini table (Date, Shift, Advisor, Status badge: confirmed=green/tentative=amber/cancelled=grey/no_show=red/visited=dark-green, + delete) with "+ Add appointment" header action; empty: "No upcoming appointments."
Footer: "{n} client(s)".

**Add/Edit client modal** (440px): Client name*, Tier (select: none/Platinum/Gold/Silver), Preferred languages (free text).
**Add appointment modal** (460px): Date*, Status (select: Confirmed/Tentative/Cancelled), Shift (select: "any shift" + boutique shifts), Assigned advisor (select: "unassigned" + VIC-eligible staff), Notes (free text).

### 5.5 Admin · Shifts (`/admin/shifts`)
PageHeader "Shifts" / "Boutique shift definitions, requirements and closure dates". Three stacked cards:

1. **Shift Definitions** — header + "+ Add shift"; expandable rows (name, time range, optional "until {date}" gold badge, requirement-summary chips e.g. "Counter: Cashier ×1", Edit/Delete actions — delete confirms via native dialog). Expanded panel: requirements table (Area, Skill, Min, Max — Min/Max editable inline number inputs with a Save affordance, delete "×" per row) + "+ Add requirement" inline row (Area select, Skill select, Min number, Add/Cancel).
   **Add/Edit shift modal** (460px): Shift name*, Start time* (time), End time* (time), Valid from (date, defaults today), Valid until (date, optional), Sort order (number).
2. **Areas** — description line; editable rows (name text input + sort-order number + inline Save if dirty + Deactivate/Reactivate toggle, dimmed 55% when inactive); add row (name input + "Add area").
3. **Closure Dates** — description line; rows (date + reason or italic "No reason given" + delete); add row (date + reason + "Add closure").

### 5.6 Admin · Rules (`/admin/rules`)
PageHeader "Rules & Configuration" / "Toggle rules and tune engine thresholds per boutique". Three stacked cards, **no modals** — all inline/autosaving:

1. **Constraint Rules** — 8 rules grouped under 5 group headers (Hours, Fatigue, Compliance, Quality, Availability): Max hours/day, Weekly hours cap (Hours); Min rest between shifts, Max consecutive shifts (Fatigue); Certification expiry (Compliance, default hard-block); VIC client coverage, Gender balance (Quality); Day-of-week availability (Availability, default hard-block). Each row: name + description + severity select (Warning/Hard block, red border if hard-block) + Toggle (enabled) + tiny autosave indicator (…/✓/!).
2. **Engine Thresholds** — 5 numeric fields with hints: Target headcount per shift (1–30), Max hours per day (1–24), Max consecutive shifts (1–10), Min rest hours (0–24), VIC priority boost (0–100, step 0.5). Explicit "Save thresholds" button + status text.
3. **Scoring Weights** — intro noting weights must sum to 1.0, live sum readout (green if =1.0 else red); 5 number fields (0–1, step 0.01): Skill coverage, VIC affiliation, Gender balance, Seniority, Language coverage. "Save weights" button disabled unless sum ≈ 1.0.

### 5.7 Admin · Leave (`/admin/leave`)
PageHeader "Leave" / "Staff unavailability, ad-hoc leave and public holidays". Toolbar: Staff select, Leave type select, Source select, From-date, "–", To-date, conditional "Clear" link — plus right-aligned "Public holiday" (secondary) and "+ Add leave" (primary).

Table columns: Staff, Period (date range, or same-day "{date}, {start}–{end}"), Type (badge: annual=blue, sick=red, toil=amber, parental=purple, public_holiday=gold, unpaid/other=grey), Source (badge: HR system=grey, ad-hoc=green, manual=gold), Reason, *(delete — hidden for HR-sourced rows)*.
Footer: "{n} record(s)" (+ "of {total}" when filtered).

**Add leave modal** (460px): Staff member*, Start date*, End date*, Leave type (select, default Annual), Reason.
**Add public holiday modal** (420px, bulk action): Date*, Holiday name; hint that it applies to every staff member in the boutique; success state = green check + count summary.

### 5.8 Approver · Inbox (`/approvals`)
PageHeader "Approval Inbox" / "Rosters submitted for your review". Shared roster table (statuses: submitted, pending_review, approved) with Actions column: submitted/pending_review → Approve(primary)+Reject(danger, opens reason modal); approved → Publish(primary)+Reject(danger). Expand → Roster Detail panel, `canEdit=false`. Empty: "Nothing waiting on you right now."

Reject modal: optional reason textarea, hint that the admin can withdraw/resubmit, footer Cancel/"Reject roster"(danger).

### 5.9 Approver · History (`/approvals/history`)
PageHeader "Approval History" / "All rejected, published and archived rosters". Same table, statuses (rejected, published, archived, published_amended), no Actions column. Empty: "No decided rosters yet."

### 5.10 Reader · Published Rosters (`/view`)
PageHeader "Published Rosters" / "Browse published rosters for your boutique". Table columns: *(chevron)*, Date, Score, Overrides, Export (CSV + PDF secondary buttons, each with a loading state; CSV downloads a file, PDF opens print dialog). No Status/Actions columns (all rows are implicitly published). Expand → Roster Detail panel, read-only. Empty: "No published rosters yet." Footer: "{n} published roster(s)."

### 5.11 Staff · My Schedule (`/staff`)
PageHeader "My Schedule" / "Your upcoming shifts from published rosters". Day-grouped list: each date is a card with a shaded header strip (weekday + date) and one row per shift (shift name, optional area, optional gold "VIC" badge, duration right-aligned e.g. "8h"). States: "Your account isn't linked to a boutique yet.", loading, error, "No upcoming shifts on the published roster yet."

### 5.12 Staff · Leave & Team (`/staff/leave`, `/staff/team`) — **unbuilt stubs**
PageHeader with the intended title/subtitle ("Leave" / "Submit unavailability and view your leave history"; "Team" / "Published roster for your boutique") followed only by muted placeholder text "Coming in Phase 4." Nothing further to spec — flag as backlog screens in the Figma file (empty-state placeholder frames) rather than fully designed ones.

---

## 6. Responsive behavior (breakpoint: 640px)

- Sidebar → off-canvas drawer with hamburger trigger + scrim; collapse-toggle hidden.
- PageHeader padding/title size reduce; toolbar rows wrap, search/filter inputs go full-width and reorder after buttons.
- All tables keep their column structure but cell padding shrinks (`0.6–0.85rem` down from `0.75–1.25rem`); on Rosters/VIC/Staff pages, wrapping rows reorder info before actions.
- Form grids (`1fr 1fr`) collapse to a single column; modal footers stretch each button to equal width.
- Roster Detail's shift grid collapses from auto-fill multi-column to 1 column.

---

## 7. Appendix — legacy generation (not routed, reference only)

The codebase retains an earlier product generation, fully superseded and **unreachable from any live route** (confirmed against `App.tsx`): `src/admin/AdminPanel.tsx` (+ its two tabs `PublishTab.tsx`, `RosterPlannerTab.tsx`), `src/App.css`, and `src/types.ts`/`engine.ts`. It predates multi-boutique support and used a fixed 3-shift model (Morning/Afternoon/Closing) and a fixed 6-role enum (Floor Manager, Sr. Stylist, Jr. Stylist, VIC Advisor, Cashier, Stock Associate), styled inline with the Cormorant Garamond/DM Sans + navy/gold `ClientTheme` tokens (§2B) rather than the current `--dash-*` system. Notable pieces, if you want them in the Figma file as historical/alternate-concept frames:

- **AdminPanel shell** — its own 220px navy sidebar (Staff / VIC clients / Weights / Roster planner / Publish tabs), collapsing to a bottom tab bar on mobile.
- **RosterPlannerTab** — a 3-column **drag-and-drop** shift board (staff pills draggable between Morning/Afternoon/Closing columns, marking overrides), score bars per shift, a VIC-coverage strip, a violations banner, and a bench-search "add staff" picker modal. This is visually the richest screen in the legacy set and the one most worth preserving as a concept reference even though the live product replaced it with the simpler edit-in-place Roster Detail panel (§4).
- **PublishTab** — pending-approval queue as cards with a 4-step "Generated → Review → Approved → Published" status bar, a 3-column shift preview with avatar stacks, and Approve/Reject/Publish modals with named-approver confirmation; plus a publish history list.
- **WeightsTab** — 5 weight sliders (5–80 range) with live auto-redistribution to keep the total at 100%, each with a colored bar-fill and a segmented summary bar + legend.

Recommend labeling this appendix clearly in Figma (e.g. a page named "Legacy — reference only") so it isn't mistaken for current-state IA.
