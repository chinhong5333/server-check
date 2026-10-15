# Implementation Log — Server Check

## 2026-10-13 05:10:00 PM — 05:40:00 PM

**Task:** Design the UI asset revamp mockup (layout unchanged).

**Description:**
- Captured the current UI from live `output/` previews (sidebar shell, Operations Overview roster, Projects cards, Agent Detail) at 1440 px.
- Built a Design canvas ("Server Check UI Revamp"): Asset Kit board (current vs proposed) plus Projects, Operations Overview and Agent Detail boards.
- Proposal 01 (graphite dark, IBM Plex) was rejected by the user as "not obviously different". Proposal 02 was built instead: a light canvas with a navy sidebar, Plus Jakarta Sans, solid alert badges, status-tinted icon tiles, pill tabs, elevated cards and per-metric chart colors.
- Added a Dark Mode row with dark versions of all three pages.
- Applied the user's comment threads on Agent Detail:
  - The real problem was the status grid: it wrapped to 3 + 1 columns because of `auto-fit` with a 300 px minimum. Fixed to 2×2.
  - The page was rebuilt from the real `AgentDetailPage.tsx` sections: Telegram bar, Agent Status notice, Health Checks, Database Health, Latest Script Configuration, interval buttons, and the Incident History / Telegram Delivery Log tabs.
  - Health Checks and Database Health were compacted.

**Next Steps:** Implement the approved mockup in the real app.

## 2026-10-13 05:45:00 PM — 06:31:06 PM

**Task:** Implement the approved asset revamp in the real application.

**Description:**
- **Fonts:**
  - Added `@fontsource/plus-jakarta-sans` and `@fontsource/ibm-plex-mono`.
  - Removed `@fontsource/inter`, `@fontsource/jetbrains-mono` and `@fontsource/space-grotesk`. `main.tsx` was their only importer.
  - Changed the imports in `src/client/main.tsx` to match.
- **Tokens (`tokens.css`):**
  - Rewrote the light and dark palettes in hex. Existing token names were kept, so every existing rule inherits the new colors.
  - Added fill, line and solid status tokens, plus sidebar, violet, track and chart-series tokens.
  - Added `--color-accent-text`, the readable accent for text in both themes. In dark mode `--color-accent` stays a fill colour so white button text keeps 4.5:1 contrast.
  - Added `--radius-pill`. It was referenced in `styles.css` but never defined.
  - Added `--shadow-card` and `--shadow-primary`.
- **`styles.css`:**
  - Changed the 25 text-colour uses of `var(--color-accent)` to `var(--color-accent-text)`.
  - Removed the dot-grid body background.
  - Appended a documented "Asset Revamp" layer covering:
    - typography and surfaces
    - buttons and status badges
    - status icon tiles
    - the navy sidebar and segmented theme control
    - the breadcrumb, eyebrow pill and back pill
    - the notification bar
    - roster pill filters, health-check chips, meter threshold colours and the live dot
    - project cards: status top bar via inset shadow (a pseudo-element would have become a grid item), icon tile, health breakdown bar and legend
    - Agent Detail: notice, metric tiles, health check cards, inset Database Health card, script URL box, chart series colours and the interval control
    - history pill tabs and form inputs
- **Markup** (assets only, no layout moves):
  - `AppShell`: brand-mark tile, project initials tile with agent count, account initials avatar.
  - `ThemeToggle`: rewritten as a segmented Light / Dark / System group. System clears the stored choice and follows `prefers-color-scheme`.
  - `ProjectsPage` and `InstallAgentPage`: breadcrumb in place of the uppercase context line.
  - `ProjectCard`: health breakdown bar (`aria-hidden`) and legend list, inside the existing body grid.
  - Roster rows:
    - status tile beside the identity
    - live heartbeat dot
    - `data-level` on the RAM and disk progress bars, so the fill turns amber at 70% and red at 90%
  - `AgentDetailPage`: status tile beside the title; `chart-surface--<metric>` modifier classes.
  - `TradingViewMetricChart`: the line colour now reads `--chart-series` instead of `--color-accent`.
  - `AgentHealthChecks`: icon tile in each check title.
  - `AgentIncidentHistory`: icon tile picked from the incident type.
- **Problems hit:**
  - Python file edits on Windows wrote CRLF line endings. I normalized the affected files back to LF and switched later edits to `newline=''`.
  - The shell heredoc for the CSS layer exceeded the command-length limit. I wrote it to a scratch file and appended it.
  - The sidebar footer `span` rule overrode the avatar style. I raised the avatar selector's specificity.
- **Tests:**
  - Rewrote `tests/unit/theme-toggle.test.tsx` for the segmented control (3 cases).
  - Updated one assertion in `tests/unit/agents-page.test.tsx` to look for the Theme group.
  - Ran 9 focused cases: 8 passed.
  - "shows incidents on the agent page even when metric history is empty" fails at `agent-detail-page.test.tsx:188`. This failure predates my change: the test expects "RAM, storage, or CPU load", which the committed `AgentDetailPage.tsx` definitions no longer contain (verified against `git show HEAD`). Not changed here.
  - The full suite was not run.
- **Verification:**
  - `tsc -p tsconfig.json --noEmit` passes.
  - `vite build` succeeds. The output went to the scratchpad; `dist/` was not touched.
  - New preview `output/asset-revamp-preview.html` (`?view=projects|overview|agent|login&theme=light|dark`) renders the real App with synthetic read-only data and blocks all writes.
  - Checked at 1440 px in light and dark, at 390 px in light and dark, and the login page.
  - No horizontal overflow at 390 px: `scrollWidth` equals `clientWidth` on all three pages.

**Next Steps:**
- The user reviews the real app against the mockup.
- Optional: bring the login page wordmark onto the new brand-mark tile. Login was not part of the mockup.
- Fix or update the failing assertion in `agent-detail-page.test.tsx`. It was already failing before this work.
- Commit when the user approves.

## 2026-10-13 06:48:00 PM — 06:55:00 PM

**Task:** Revamp the Maintenance panel; box the Health Checks cards.

**Description:**
- Started local XAMPP MySQL (3306), the API (`npm run dev:server`, background shell, because the browser pane runner hung `tsx watch`) and Vite (5173). Added `.claude/launch.json` (web only).
- `MaintenanceControl.tsx`:
  - The heading icon is now a status tile: warning when active, accent when scheduled, neutral when idle.
  - Added a clock icon before the time range and an icon before the note (bell-off when muted, info otherwise).
  - Added the `maintenance-control--scheduled` modifier and the `maintenance-control__note` class.
- CSS:
  - The maintenance card gets a top bar in its state colour (warning when active, accent when scheduled). The window row is now an inset tinted box. Reason text is ink 700.
  - Each health check (Apache, Nginx, Middleware API) is now its own inset box in a padded grid, matching the Database Health card. User feedback: "box wrapping is not complete".
  - Health check titles wrap instead of truncating.
- Preview harness now supports `&maint=active|scheduled` and `&checks=off`.
- Verified:
  - Card edges line up with the Database Health box (361→1352 px at 1440).
  - Titles are no longer clipped.
  - 5 focused tests pass (`maintenance-control` ×4, `agent-health-checks` ×1).
  - Type check passes.

**Next Steps:** User review in the running app.

## 2026-10-14 12:40:00 PM

**Task:** Remove the project card status top bar.

**Description:**
- The user asked to drop the coloured indicator across the top of project cards.
- I removed the `--project-card-bar` inset shadow from the card, hover and drag-preview rules, and the extra 4 px of header padding.
- Cards are now neutral and elevated. Status is still shown by the badge, the health breakdown bar and the legend.
- The maintenance panel's top bar is unchanged.
- Checked in the preview, dark theme, at 1440 px.

**Next Steps:** User review.

## 2026-10-14 12:45:00 PM

**Task:** Add space between the Overview back pill and the Agent Detail header.

**Description:** Added `.agent-page-intro { gap: var(--space-lg); }` to the revamp layer. The measured gap between the back pill and the header icon went from about 4 px to 22 px (dark theme, 1440 px preview).

**Next Steps:** User review.

## 2026-10-14 01:16:45 PM

**Task:** Restart heartbeats for agent 30 (`wsl-uptime-e2e-01`) so the metric chart has data again.

**Description:**
- The Agent Detail chart showed "No Metric History Yet". Read-only DB check: only 4 `metric_samples` rows existed in the whole database (agent 30, 2026-10-08). Older samples had been purged by the 7-day `metrics` retention policy. No agent had sent a heartbeat since 2026-10-08.
- Agent 30 was created by `output/wsl-uptime-e2e.mjs`, which piped the generated script into WSL over stdin and never installed cron. Its credential was never saved, so a new one was needed.
- With user approval, a one-off scratch script (outside the repo) followed the `credential-rotation` route logic. A backup of the agent row was written first. It then:
  - updated agent 30 with a new credential hash and hint, `heartbeat_interval_seconds` 3600 → 300, status `new`, and cleared the `last_*` fields;
  - resolved open incidents and soft-deleted pending outbox rows;
  - added an `agent.credential.rotate` audit event with `user_id` NULL;
  - left the 4 existing metric rows untouched.
- Installed the generated script at `/home/zetta/.server-check/server-check-wsl-uptime-e2e-01.sh` (chmod 700, dir chmod 700). `/opt/server-check` is root-only and sudo needs a password, so the user home was used.
- User crontab (zetta): `*/5 * * * * /bin/sh '<script>' >> "$HOME/.server-check/agent.log" 2>&1`.
- Manual first run: "Server Check heartbeat delivered."; agent status `healthy`.
- The project stays in maintenance until 2099, so alerts remain muted.

**Next Steps:**
- WSL cron only runs while the Ubuntu distro is running. Heartbeats stop when WSL shuts down idle or the PC sleeps.
- To stop: `crontab -r` in WSL, or delete the line.

## 2026-10-14 01:27:00 PM

**Task:** Smooth out the dark-mode colour tone ("dark but smooth").

**Description:**
- Rewrote the `:root[data-theme="dark"]` block in `tokens.css`:
  - Swapped the saturated navy layers for desaturated graphite-slate, with small elevation steps: canvas #0F1217, card #151920, inset #1A1F27 / #20262F.
  - Softer borders (#242A33 / #303742) and off-white ink (#E4E8EE).
  - Calmer status, accent and chart-series hues.
  - A graphite sidebar (#0B0E12).
  - Dark-only solid badge colours (#A65A16 warning, #C3392F critical).
  - Softer card shadow.
- Added dark-only overrides in `styles.css` that soften the accent glow behind the active nav item and the brand mark.
- Measured contrast on the rendered page:
  - Muted text: 5.83:1 on cards, 6.2:1 on the canvas.
  - Secondary text 9.1:1; primary ink 14.33:1.
  - Sidebar muted text 6.47:1.
  - Accent text on info surface 7.56:1.
  - White text: 5.15:1 on accent, 5.13:1 on solid warning, 5.32:1 on solid error.
  - Status text on its tint: success 6.97:1, warning 7.86:1, error 5.98:1.
  - Everything is at least 4.5:1.
- Light theme is untouched.
- Checked Overview, Agent Detail and Projects in the dark preview at 1440 px.

**Next Steps:** User review.

## 2026-10-14 03:03:00 PM

**Task:** Make the dark-mode tone change noticeable. User feedback: "did not feel any different".

**Description:**
- Confirmed Vite was serving the new tokens (`--color-paper: #0F1217`). The previous change was simply too subtle: navy swapped for graphite at the same near-black depth.
- Lifted the dark palette to a softer "dimmed" charcoal:
  - canvas #1A1D23, card #21252B, inset #262A31 / #2D3139
  - borders #2F333B / #3B4049
  - muted #9AA2AE, ink #E6E8EC
  - sidebar #16191E (raised #22262D, active #30353F)
  - lighter card shadow
- Re-measured contrast on the rendered page:
  - Muted text: 5.98:1 on cards, 5.59:1 on inset panels, 6.55:1 on the canvas.
  - Secondary text 8.78:1; sidebar muted text 6.84:1.
  - Accent text on info surface 6.09:1.
  - Status text on its tint: success 6:1, warning 6.73:1, error 5.15:1.
  - Everything is at least 4.5:1.

**Next Steps:** User review. Can go lighter or darker within this dimmed range if wanted.

## 2026-10-14 03:14:00 PM

**Task:** Fill empty project-card agent slots with dashed placeholders.

**Description:**
- `ProjectCardAgents.tsx` now renders `6 − agents shown − View All tile` empty `li.project-card__agent-slot` items, marked `aria-hidden`. The roster always shows the full 2 × 3 grid.
- Added CSS for these slots: dashed `--color-rule-strong` border, transparent background.
- Because the slots are `aria-hidden`, screen readers and list-count tests still see only real agents.
- Verified in the preview: every card renders 6 slots (placeholders 0/2/0/3/4/5 for the sample projects), and every slot is a full 34 px tall inside the roster.
- `project-card-agents.test.tsx`: 4/4 pass.

**Next Steps:** User review.

## 2026-10-14 03:20:00 PM

**Task:** Remove the Projects page description line.

**Description:** Deleted "Review every project and the health of its registered agents." from the `ProjectsPage.tsx` header. The breadcrumb, title and Create Project button are unchanged. Ran 1 focused test (`projects-page`, header and cards render).

**Next Steps:** User review.

## 2026-10-14 03:20:00 PM — 03:40:00 PM

**Task:** Batch of user requests: sort-mode cleanup, maintenance layout, time wording, favicon, Open Graph, empty chart frame, new DB-monitoring test agent.

**Description:**
- **Sort mode:**
  - Removed the ← → move buttons and the "Move buttons are also available" sentence. Reordering is now drag-only; the user chose this after being told keyboard and touch users lose reordering.
  - Removed the divider lines under "All Projects" and under the sort toolbar.
  - Sort-mode cards are now identical to normal cards: `ProjectCard` takes `sorting` instead of `sortingControls`, always renders the roster, shows a non-interactive Manage replica, and the whole card is `inert`.
  - Removed the orphaned `.project-card-sort-controls` and `.project-sort-grip` CSS.
- **Project card legend:** changed from `ul/li` to `p/span`. The extra list items had broken list queries in sort mode.
- **Maintenance panel:** rebuilt as one row (icon tile | body | actions), tinted amber when active and blue when scheduled. No top bar and no nested box; actions move below on phones.
- **Countdown:** "Time Until Marked Overdue" now uses Hour / Minute / Second words, for example "3 Minutes 23 Seconds", with leading zero units omitted. Status values shrank to 1.2rem.
- **Favicon:** `public/favicon.svg` is now the brand mark (blue tile, white pulse).
- **Open Graph:**
  - `index.html` now has description, application-name, `robots noindex,nofollow`, light/dark theme-color, color-scheme, apple-touch-icon, full `og:*` (with image size and alt) and the Twitter card.
  - Added `public/og-image.png` (1200 × 630) and `public/apple-touch-icon.png` (180 × 180), generated with Pillow and Plus Jakarta Sans.
  - `__PUBLIC_BASE_URL__` is replaced with the `PUBLIC_BASE_URL` origin: at runtime in Express (`app.ts`, read once at startup) and by a dev-only Vite plugin.
- **Empty charts:** when an interval has no values, the chart shows an empty plot frame (y and x axis lines, dashed grid, "No Data For This Interval") instead of a blank canvas.
- **Monitor test setup:**
  - Stopped the old WSL monitor: backed up the crontab to `~/.server-check/crontab.bak-20261014153703` and removed only the `server-check-wsl-uptime-e2e-01.sh` entry. The script and its data were kept.
  - Created project "WSL DB Monitor Test 2026-10-14 07:37" with agent `wsl-db-monitor-01` (`output/create-db-monitor-fixture.ts`). Heartbeat interval 120 s; Apache and Nginx off; Middleware API on, pointing at `http://172.27.112.1:3000/healthcheck`, which returns the MySQL `db` object.
  - Installed the agent script in WSL (chmod 700), ran a dry run and one real run, and added cron `*/2`. The heartbeat was delivered and the agent shows healthy, with `database_health` status "alive".
- **Tests and checks:**
  - `admin-controls-ui` sort cases: 3/3 pass.
  - `project-card-agents`: 2 selected cases pass.
  - `maintenance-control`: 6/6 pass.
  - `agent-heartbeat-summary`: 10/10 pass.
  - Client and server type checks pass.
  - Browser checks of sort mode, maintenance, status values and the empty chart.
  - The production Express injection was type-checked but not exercised in a production build.

**Next Steps:** User review. The old project "WSL uptime e2e" keeps its active maintenance window and its last data. Delete it in the UI if it's no longer needed.

## 2026-10-14 03:41:00 PM

**Task:** Dark mode too bright after the dimmed change; settle between the two attempts.

**Description:**
- Set the dark layers to a deep charcoal between graphite (#0F1217) and dimmed (#1A1D23): canvas #14171C, card #1B1F25, inset #20242B / #262A32, borders #2A2E36 / #353A43, sidebar #101317 (raised #1B1F25, active #282D36).
- Text colours unchanged.
- Updated the dark `theme-color` meta to #14171C.
- Contrast: muted text 6.42:1 on cards, 6.05:1 on inset, 6.97:1 on the canvas; sidebar 7.23:1; accent 6.53:1; success tint 6.45:1; error tint 5.54:1.

**Next Steps:** User review.

## 2026-10-14 03:42:00 PM

**Task:** Dark mode "more dim, near dark".

**Description:**
- Darkened the layers one step and made them more neutral (less blue): canvas #111317, card #171A1E, inset #1C1F24 / #22252B, borders #25282E / #30343B, sidebar #0D0F12 (raised #171A1E, active #23272E, rule #1E2126), track #272A31.
- Dark `theme-color` set to #111317.
- Contrast: muted text 6.78:1 on cards, 6.42:1 on inset; error tint 5.91:1.

**Next Steps:** User review.

## 2026-10-14 03:45:00 PM

**Task:** Light theme: darker border lines.

**Description:** Darkened the light theme's border tokens. `--color-rule` (card outlines, table and section dividers, chips) went from #E4E8EF to #D3D9E1. `--color-rule-strong` (inputs, buttons, dashed placeholders, version and load chips) went from #D0D5DD to #B8C0CC. Dark theme unchanged. Checked the Operations Overview in the light preview at 1440 px.

**Next Steps:** User review.

## 2026-10-14 03:50:00 PM

**Task:** Agent Detail: make the header icon tile match the height of the text beside it.

**Description:**
- At ≥48rem the identity block is a 2-column grid. The text wrapper uses `display: contents`, so the eyebrow, title and description each get their own row.
- The tile spans the eyebrow and title rows, is square (`aspect-ratio: 1`) and its icon scales to 46%.
- First attempt: stretching inside a flex row collapsed the width to 7 px.
- Second attempt: a grid spanning the whole text block grew in a feedback loop (166 px), because the wider tile made the text wrap taller.
- Measured at 1440 px: tile 72 × 72, top 181 = eyebrow top, bottom 253 = title bottom. Description below at 260–305.
- Phones (<48rem) keep the 52 px tile with no horizontal overflow (390 px).

**Next Steps:** User review.

## 2026-10-14 03:56:00 PM

**Task:** Agent Detail header: remove the description line, then re-match the icon tile height.

**Description:**
- Removed "Current status, seven-day metric trends, and historical records for this monitored server." from `AgentDetailPage.tsx`. The user chose the description over the "Agent Detail" pill. Also removed the now-orphaned `h1 + p` grid rule.
- At ≥48rem the tile spans the two remaining rows, so it matches the full text block. Measured at 1440 px: tile 181–253 equals eyebrow top 181 to title bottom 253; size 72 × 72.
- Phones (<48rem) keep the 52 px top-aligned tile. A trial at 390 px showed the 2-line wrapped title would push the tile into the same growth feedback loop.
- Ran Hallmark (component-scope amendment, existing tokens preserved).
- Type check passes. 2 focused agent-detail cases ran (see next log entry).

**Next Steps:** User review.

## 2026-10-14 03:57:00 PM

**Task:** Verification note for the header change above.

**Description:** Focused tests `agent-detail-page`: "offers four independent interval selectors defaulting to 30 minutes" and "hides URL actions when no middleware URL is configured" both pass (2/2). Full suite not run.

**Next Steps:** None.

## 2026-10-14 04:00:00 PM

**Task:** Agent Detail header: slightly smaller server name.

**Description:** `.page-header__identity h1` is now `clamp(1.75rem, 2.8vw, 2.2rem)`: 31.7 px at 1440, down from 37.4 px. Other page titles are unchanged. The icon tile still spans the eyebrow + title exactly: 181–246, now 66 × 66.

**Next Steps:** User review.

## 2026-10-15 06:20:00 PM

**Task:** Decision recorded — panel header tone.

**Description:**
- The user chose **Option A · Neutral Band** for panel header strips (Agent Status, Health Checks, chart headers, roster toolbar, History).
- Light band #F0F3F7 with rule #D3D9E1; dark band #24282F with rule #30353D; neutral titles.
- **Constraint from the user: do not shift the colour tone to blue.** Header and surface bands stay neutral grey. Blue remains only the accent (buttons, links, active nav, charts).
- Option B (blue accent band) and C (ink header) were rejected.
- Mockups: the canvas board "Header Tone Options" and a Header Tone tweak on both Agent Detail boards (default A).

**Next Steps:** Preview the white theme with Option A, then implement it in `styles.css` / `tokens.css` once approved.

## 2026-10-15 06:30:00 PM

**Task:** Header tone decision revised per theme.

**Description:**
- The user chose **Option B · Accent Band for the white (light) theme**: #EDF2FD band, #C7D7FE rule, #14306E title, #3E5683 secondary.
- The dark theme keeps **Option A · Neutral Band**: #24282F / #30353D.
- The earlier "do not modify the colour tone to blue" rule now applies to the dark theme. In light, the blue tint is limited to panel header bands.
- Memory, plan and log updated.

**Next Steps:** Preview the light theme with B and dark with A (preview `?header=b` for light), then implement once approved.

## 2026-10-15 06:33:00 PM

**Task:** Implement panel and modal header bands in the real app (light = Option B, dark = Option A), covering all pages and modals.

**Description:**
- `tokens.css`: new `--color-header-band`, `--color-header-rule`, `--color-header-title` and `--color-header-muted`.
  - Light: #EDF2FD / #C7D7FE / #14306E / #3E5683.
  - Dark: #24282F / #30353D / #EEF0F3 / #9AA2AE, neutral with no blue.
- `styles.css`: one rule set bands every surface heading — `:is(.data-surface, .form-surface, .chart-surface, .agent-health-checks) > .section-heading` — plus the Agent Status header, the agent roster toolbar and the agent-setup dialog heading.
  - Inside a band, `--color-muted` is remapped to the header muted colour. The theme muted #667085 would only reach 4.2:1 on the light band.
  - Headings in form surfaces get rounded top corners.
- Excluded on purpose:
  - status-coloured confirmation dialogs (Delete Agent / Delete Project / Rotate Secret confirmations keep their red and amber surfaces)
  - page-level headings (All Projects, sort toolbar, History Records title)
  - project cards
  - the single-row Script Configuration panel
- **Bug fix found during verification** (introduced by the 2026-10-14 identity-tile change, already pushed):
  - At about 1000 px the Agent Detail header grid gave the title a 0 px column. The server name stacked one letter per line and the tile stretched to 657 px.
  - The header is now a wrapping flex row (identity `flex: 1 1 22rem`, actions wrap below) and the tile is capped at 5.5rem.
  - Verified: 864 px (one-line title, 58 px tile), 1000 px (62 px tile), 1440 px (66 px tile matching the eyebrow and title), 390 px (52 px). No horizontal overflow.
- **Verified the light band** (#EDF2FD, navy title) via computed styles:
  - Agent Detail: status, health, charts and history, plus the Server State, Raw Log, Raw DB, Manage and Schedule Maintenance modals.
  - Projects: Create Project and View All Agents modals; the page-level heading stays unbanded.
  - Overview: roster toolbar plus the Register Agent, Edit Agent and Rename Project modals.
  - Change Password settings panel, with rounded top corners.
- **Dark mode** verified at #24282F with #EEF0F3 titles.
- **Screenshot limits:** modals were checked by computed style only, because this screenshot mode does not capture the top layer.
- No TSX changes. Unit tests not run (CSS and tokens only).
- Not committed.

**Next Steps:** User review. Commit on request.

## 2026-10-15 06:36:00 PM

**Task:** Agent Status notice spacing.

**Description:** The alert notice ("Agent Requires Attention / Heartbeat overdue") sat flush under the new header band. Added `margin-block-start: var(--space-md)`. Measured 14 px above and 14 px below (dark, 1440 px).

**Next Steps:** User review. Commit on request.

## 2026-10-15 06:40:00 PM

**Task:** Modal header title spacing not even (Manage Agent modal).

**Description:**
- Modal `.section-heading` used `align-items: start`, so a one-line title sat at the top of the band (14 px above, 35 px below) while the 44 px close button set the band height.
- Added `.agent-dialog__surface > .section-heading { align-items: center; }`, which applies to every modal heading.
- Measured (dark, 1440 px):
  - Manage: 25 px above and 25 px below; title centre equals close-button centre (177).
  - Schedule Maintenance (title plus description): 22 px / 22 px, centred on the close button.

**Next Steps:** User review. Commit on request.
