# Implementation Plan

## Overview

Build a production-oriented, centralized server monitoring service for multiple internal projects. Linux agents will send heartbeats and optional telemetry to a Node.js API; MySQL will retain seven days of liveness and metric history; a central evaluator will detect project-specific RAM, storage, load, service, and heartbeat incidents; Telegram will deliver alerts; and an authenticated admin panel will support diagnosis and historical review.

## Implementation Plan

1. **Finalize contracts and open decisions**
   - Confirm initial project threshold values, agent-to-project ownership, incident retention, response validation, supported cron intervals, central service-manager target, and undelivered-report policy.
   - Finalize the canonical heartbeat and telemetry JSON schemas and error responses.
2. **Create the Node.js service foundation**
   - Establish a single deployable package with Node.js API code, React and TypeScript backoffice code, prebuilt admin assets, runtime configuration validation, structured logging, health endpoints, explicit setup and migration commands, and professional JSDoc for all backend routes and middleware.
3. **Design and migrate the MySQL schema**
   - Add projects, internal users, revocable internal sessions, agents, monitored servers, heartbeat events, metric samples, filesystem samples, service samples, incidents, and notification outbox records.
   - Give every table an auto-increment `id` and final `created_at`, `updated_at`, and `is_delete` columns in the required order.
   - Add project-and-time indexes and agent sequence idempotency constraints.
4. **Implement agent authentication and heartbeat ingestion**
   - Bind each credential to one registered agent and project.
   - Support heartbeat-only and heartbeat-with-telemetry requests, including healthy and unhealthy health probe results.
   - Maintain separate heartbeat and metric freshness while enforcing strict canonical inputs.
5. **Implement the backoffice agent script generator**
   - Create agents and one-time credentials under the selected project.
   - Request one canonical agent-specific `health_api_url` only in the script-generation step, record the normalized URL used by the latest script, derive the central ingestion URL and schedule from trusted configuration, and generate the complete shell script and exact crontab entry.
   - Add script copy, `.sh` download, crontab copy, credential rotation, revocation, no-store responses, audit events, strict URL validation, and shell-safe serialization without server-side URL probing.
6. **Implement the Linux collector**
   - Probe the configured white-label health API first and classify valid HTTP 200, non-200, DNS, connection, TLS, timeout, and response-validation outcomes.
   - Collect structured load, CPU, RAM, swap, filesystem, inode, Apache, Node API, and safe process-name measurements, then report the probe result and telemetry to the central API even when the probe is unhealthy.
   - Keep the generated `/bin/sh` script self-contained, cron-ready, versioned, free from runtime package installation, and protected against overlapping runs and unsafe shell evaluation.
7. **Implement incident evaluation**
   - Apply project-scoped RAM, storage, five-minute load, white-label application health, service, and heartbeat policies.
   - Add incident state transitions, deduplication, recovery handling, reminders, and maintenance support.
8. **Implement history retention and query aggregation**
   - Retain heartbeat and metric history for seven days.
   - Purge expired records in bounded batches and downsample dashboard chart queries by requested time range.
9. **Implement Telegram delivery**
   - Use one platform-owned encrypted Bot Token and Chat ID with a durable notification outbox, retry, delivery status, deduplication, and recovery messages.
10. **Implement the internal admin panel**
   - Build the backoffice with React and TypeScript and add JWT-cookie internal authentication, project selection, operations overview, server diagnostics, seven-day charts, incident history, project settings, and the focused agent-installation workflow.
   - Implement login, session restoration, logout, revocation, CSRF protection, signing-key rotation support, and server-side authorization without exposing JWTs to browser storage or application JavaScript.
   - Implement responsive, keyboard-accessible loading, empty, error, stale, and authorization states.
11. **Verify production behavior**
   - Run unit, API, worker, security, accessibility, and browser tests.
   - Run every database-integrated test only against a verified, dedicated local MySQL test database.
   - Exercise realistic heartbeat loss, invalid telemetry, threshold, recovery, retention, restart, Telegram failure, script injection, credential exposure, one-time generation, cron overlap, agent installation, JWT validation, revocation, CSRF, and browser-storage scenarios.
12. **Prepare deployment and operations**
   - Document the minimal `npm install`, `npm run setup`, interactive `npm run create-admin`, and `npm start` central workflow plus JWT signing-key management, secrets, migrations, backups, restore, process supervision, TLS, central-service monitoring, upgrades, rollback, agent regeneration, and credential rotation.

## Progress

- 2026-09-08: Replaced the Sort button's up/down arrows with the stepped horizontal-line ListFilter icon per user preference; label and sorting behaviour are unchanged. Five focused project-page tests passed.

- 2026-09-08: Shortened the project sort trigger to Sort with a decorative ArrowUpDown icon; sorting behaviour is unchanged. Five focused project-page tests passed.

- 2026-09-08: Corrected project sorting to remain in the existing card grid. Browsing and sorting now share ProjectCard; sort mode preserves card identity, health, count, and description, adds drag feedback and Earlier/Later alternatives, and retains explicit Save Order/Cancel. Thirteen focused tests, typecheck, and synthetic desktop/mobile native-drag/save verification passed. No API/schema changes.

- 2026-09-08: Shortened the Settings sidebar/page title to Telegram and added the standard leading UserPlus icon to Add Admin. Thirteen focused UI/navigation tests and desktop/mobile rendering checks passed; no behavior or API changes.

- 2026-09-08: Renamed visible Admin Management navigation/page to Teams. Replaced the email bullet list with responsive Team Members rows (Email Address, Role, Joined) and count. Add Admin now opens a focused modal; cancel/success clear sensitive values and return focus. Eleven focused UI/navigation tests, type checking, build, and desktop/mobile synthetic verification passed. No backend/schema changes or real account writes.

- 2026-09-08: Settings gear now enters a dedicated sidebar workspace with Telegram Management, Admin Management, and Change Password on independent routes. Preserved existing forms/permissions, added admin-only route guards, legacy redirects, and account shortcut to password page. Eighteen focused tests, type checking, client build, and synthetic desktop/mobile navigation checks passed. Frontend-only change; no migration.

- 2026-09-08: At the user's explicit direction, applied pending 007/008 migrations to the existing local XAMPP database without backup and started the latest backend. Backend readiness and frontend returned HTTP 200. Initial cleanup completed in 67 ms with zero deletions and no expired backlog. This is local MariaDB runtime operation, not the still-pending dedicated MySQL 8 integration test. Opened live login and a clearly identified sample-data interactive preview.

- 2026-09-08: Implemented agent-scoped Clear Pending Messages with two-step confirmation and retained Cancelled logs, admin-only global project Sort Projects mode with drag/move controls and Save/Cancel, and Account Settings full-access admin creation with current-password verification. Added project-order migration 008, admin/CSRF enforcement, transactional audits, stale-order conflicts, and worker row locking/rechecking against cancellation races. Thirty-seven focused tests, type checking, and build passed; synthetic browser verification covered desktop/mobile, native dragging, saving, and cancellation. Guarded MySQL integration added but not run because `.env.test`/dedicated MySQL target is absent; no real accounts, orders, messages, or migrations changed. Existing scroll/retention work remains uncommitted.

- 2026-09-08: Replaced single-batch hourly retention with ten-minute, 500-row round-robin cleanup, a 30-second scheduling budget, 100-round cap, dedicated-connection advisory locking, and short row-lock waits. Retains raw history seven days, sent deliveries 30 days, failed deliveries/resolved incidents 90 days, and audit records 180 days; pending deliveries/open incidents are protected. Added retention indexes and structured backlog/allocation warnings. Nine focused unit tests, type checking, and server build passed. Guarded real-MySQL retention test added but not executed because `.env.test`/dedicated local MySQL configuration is absent. No migration or deletion was run against existing data; deploy only after backup, index migration, and MySQL validation. This controls retention, not an absolute disk quota.

- 2026-09-07: Added shared route-entry scroll reset across all pages, including repeated route navigation and back/forward. Background refreshes do not reset scroll; explicit hash anchors remain intact. Five focused navigation tests and type checking passed, with desktop/mobile browser checks of the actual App using synthetic fixtures.

- 2026-09-07: Aligned the active Registered Agents roster with Agent Detail: Load Average (5 Min) uses latest_load_5 from the current heartbeat, not load_5_per_core. Added nullable raw load to the project agents response while retaining normalized fields and thresholds. Twenty focused tests and type checking passed; actual-component synthetic desktop/mobile previews verified raw, zero, and missing values. No data migration or alert changes.

- 2026-09-07: Agent Detail now charts raw five-minute load, with latest heartbeat load displayed independently of 30-minute bucket averages. Existing normalized history, alert calculations, stored samples, and agent scripts are unchanged. Threshold wording explicitly says Load Per Core Threshold. Focused unit/API-mock tests, type checking, build, and desktop/mobile synthetic browser verification completed; dedicated MySQL integration remains unavailable.

- Added Select Telegram Chat beside the destination field heading. Its modal always shows the direct first-message guide, uses the saved bot username, provides Refresh List, and lists selectable group/channel names, types, and IDs. Selection fills the field without saving. Added an admin-only, rate-limited, no-store discovery endpoint using the encrypted platform bot; it does not send messages, acknowledge updates, alter subscriptions, or disable webhooks. Eighteen focused tests, TypeScript, production build, and synthetic desktop/mobile/light/dark UI checks passed. Local backend restarted successfully; live Telegram validation was not performed. Changes remain uncommitted.

- Updated README central installation with nvm installation guidance, nvm install/use 24, version checks, Node 16 troubleshooting, lockfile-based installation with build dependencies, and supervisor/systemd Node-path requirements. Documentation-only; diff check passed, no commit or push performed.

- Initialized Git on main and configured origin as https://github.com/chinhong5333/server-check.git after confirming the remote is empty. Expanded ignore rules to exclude all real .env variants/backups, .runtime agent credentials, browser artifacts, dependencies, build output, and retained local test data. Environment examples remain eligible. Added LF normalization for Windows/WSL/Linux portability. Build passed and candidate-file secret scanning found no configured-secret, long agent-credential, JWT, private-key, or GitHub-token matches. Initial commit/push awaits explicit approval.

- Changed the overdue timer label from Overdue By to the user's exact requested wording, Overdued, and synchronized existing test expectations.

- Removed the redundant Apache/Nginx service-name and Running/Stopped detail line from health cards. Kept status badges, Last Updated timestamps, and useful Middleware API HTTP diagnostics. Three focused health-check tests passed.

- Added Last Updated above each available health-check timestamp for Apache, Nginx, and Middleware API. Timestamp values and monitoring behavior are unchanged.

- Changed Agent Status's live due/overdue duration to zero-padded hours, minutes, and seconds (00 Hr 06 Min 50 Sec). The one-second timer remains local to the summary; elapsed age/expected-interval labels remain concise. Five focused tests and desktop/mobile checks passed.

- Merged Agent Detail's state, heartbeat timestamp, and configured interval into one Agent Status panel. It explains Within Heartbeat Interval, shows Last Heartbeat/Expected Every together, and displays a live Next Heartbeat Due In or red Overdue By value, plus exact Last Received time. Agent Version and the existing help modal remain. Timing uses last_heartbeat_at only, changes to Critical at expiry without waiting for a refresh, and does not hide service/API failures on a timely heartbeat. Seven focused tests and frontend TypeScript passed; light/dark desktop and mobile verified.

- Rechecked all 13 retained WSL agents after the user questioned 20-minute-old Healthy results. Confirmed the test fixtures' 60-minute intervals and one-shot execution explain the display: no heartbeat-deadline/state mismatch was found; the dedicated 60-second case is Critical. Five focused deadline/health-display tests passed. Added HEARTBEAT-RECHECK.md and clarified that the prior acceptance run does not prove continuous short-interval scheduled reporting. No intervals or retained data were changed.

- Completed the explicitly requested real WSL acceptance run in a new retained project (f4fedabb-944a-448f-ac08-8eb88091bc28), using 13 scenario agents and the production 1.3.0 generator. Executed real Ubuntu Apache/Nginx binaries, actual HTTP requests, central ingestion, persisted telemetry/incidents, heartbeat expiry, deduplication, and recovery. All 15 final assertions passed; 22 observations, 21 metric samples, 14 incidents, and 20 unsent notification records were retained, including two setup failures and successful reruns. Report and scoped raw-data export are under output/wsl-acceptance-f4fedabb-944a-448f-ac08-8eb88091bc28. No agent cron installed; most snapshots use a one-hour interval and will naturally become overdue later. WSL test services and keep-alive PID 27984 remain running for review. This user-authorized live local acceptance run does not replace the separate dedicated MySQL 8 integration suite.

- Implemented agent script 1.3.0 with individually selectable Apache, Nginx, and Middleware API checks during registration/script replacement. The former Server Health API URL is now the optional Middleware API URL; canonical health_api_url must be null when disabled. Legacy scripts retain Apache/API defaults and may omit Nginx telemetry.
- Added independent Agent Detail health indicators with Healthy/Error/Unknown/Not Monitored/Awaiting Data/Stale states, receipt timestamps, service names, and HTTP/latency/error diagnostics. Stale success is not shown as current health. Script configuration remains plain display text.
- Applied migration 006 to the local runtime after a full backup: nullable URL plus saved check configuration/latest-result JSON, without deleting history. Ingestion persists both service samples and validates selections against reports; optional disabled API results do not enter the success average. Unknown service detection is Warning and cannot falsely resolve a prior Critical outage.
- Verified 57 distinct focused tests across contracts, generator, real shell execution, mocked route/ingestion, incident semantics, and UI; frontend/backend TypeScript and production build passed. Live UI checked on desktop/mobile without submitting a credential rotation. Backend restarted and readiness returned HTTP 200. Dedicated local MySQL integration and deployment on real target services remain acceptance gates; .env.test is absent. Rollout details: docs/optional-health-checks.md.

- Applied the approved compact Latest Script Configuration design only: smaller heading, shorter explanatory sentence, decorative link icon beside the URL label, a subtle desktop divider, and a plain selectable URL with no textbox border/background/padding. Mobile stacks the sections with a horizontal divider and wraps long URLs. Both Agent Detail tests and desktop/mobile visual checks passed.

- Converted all four Agent Detail metric charts to Recharts AreaChart/Area, retaining axes, latest values, tooltips, null gaps, and disabled animation. Added the existing accent-color fill at 16% opacity. Both agent-detail-page tests passed; desktop/mobile rendering verified.

- Applied the compact back-link/header grouping to Agent Detail, reducing the space beneath Overview to the shared space-2xs gap. Visually checked desktop/mobile; summary and graph spacing remain unchanged.

- Compacted the directional theme toggle by removing sidebar flex growth and reducing horizontal padding to space-sm. Verified desktop/mobile alignment beside Setting; control height and behavior are unchanged.

- Removed the explanatory green-health sentence beneath All Projects; retained the heading, count, and project health badges.

- Replaced the theme toggle's visible mode label with directional Lucide icons: Sun → Moon in light mode and Moon → Sun in dark mode. Tooltips read Light To Dark / Dark To Light; descriptive accessible names and saved preference behavior remain intact. Verified desktop/mobile and both theme-toggle tests.

- Tightened the gap beneath Back To Projects on Account Settings and Setting by grouping each back link with its page header in settings-page-intro (space-2xs instead of the page-stack space-xl gap). Preserved the back link's accessible target size and form spacing; visually verified desktop and mobile.

- Added the shared-style Back To Projects link above Account Settings and Setting, targeting /projects directly. Setting retains the navigation/header during loading and errors. Verified both routes in Chrome at desktop/mobile widths and passed the four existing focused account-page/platform-settings-page tests.

- Removed the Projects/Setting sidebar menu group. Setting is now an admin-only gear button beside the current-theme toggle, with an active-state indicator and accessible tooltip. The logo and current-project switch still link to Projects; the logo closes mobile navigation, and opening the mobile rail now focuses its first link even when no project is selected. Verified with 10 agents-page tests and desktop/mobile browser checks.

- Merged the sidebar email/profile display and Account Settings entry into one accessible account link with active, focus, and hover states. Removed the duplicate navigation item and retained the separate Sign Out control. ThemeToggle now displays the current mode and corresponding Sun/Moon icon; tooltip/accessibility text explains the next action. Verified with 12 focused tests in theme-toggle and agents-page plus desktop/mobile browser checks.

- Added Account Settings with current-password-verified self-service password changes, strict 15–128-character new-password validation, confirmation UI, per-account rate limiting, CSRF protection, atomic password hashing/session revocation/audit persistence, and sign-in redirection after success. Login now rechecks the stored hash under a user-row lock before creating a session to prevent a concurrent old-password login from surviving a password change.
- Password-change verification: nine focused tests across change-password-route, account-page, and auth-login-route passed; frontend/backend type checks passed; Account Settings was visually checked on desktop and mobile in both palette contexts. The backend was restarted and returned HTTP 200 from its database readiness endpoint. No real password was changed; isolated database validation remains unavailable because .env.test is missing.
- Pending: admin-only sub-admin registration/management and assigned feature/view permissions. Existing roles are admin/operator with no assignable permissions. Awaiting the user's requested access-scope decision: permissions across all projects versus only explicitly assigned projects. Do not silently choose broader project access; complete this after the scope is supplied.

- Added a persistent Light/Dark Mode toggle to the authenticated sidebar and login page, reusing the existing Cobalt palettes. The initial theme follows the operating system until manually selected; manual choices survive reloads and synchronize across tabs, with an in-memory fallback when storage is blocked.
- Moved project rename and delete actions from collection cards into Operations Overview through ProjectActions. Cards now offer Manage only. Existing validation, native dialogs, pending/error feedback, and two-step name-confirmed deletion remain intact; successful deletion returns to Projects and refreshes the collection.
- Replaced the current-project dropdown chevron with an ArrowLeftRight switch icon, Switch Project tooltip, and matching accessible label while retaining navigation to Projects.
- Verified this amendment with 18 tests across projects-page, agents-page, theme-toggle, and login-page, plus frontend TypeScript checking. Checked rendered desktop/mobile layouts in both themes, including 320/375/414/768/1024/1440 widths across the affected surfaces. No real project mutations or database tests were performed.

- Implemented one Node.js/Express/TypeScript package with explicit environment validation, MySQL migration/setup commands, structured logging, readiness/liveness endpoints, background workers, and prebuilt Vite assets.
- Implemented the MySQL 8 schema for projects, users, revocable sessions, agents, heartbeats, metrics, filesystems, service checks, incidents, notification outbox, audits, and migration history. Every table follows the required lifecycle-column order.
- Implemented internal JWT-cookie login, session restoration, logout/revocation, scrypt password hashing, login throttling, CSRF validation, algorithm/issuer/audience/claim verification, and signing-key configuration. Per deployment requirement, no trusted-origin allowlist is configured or enforced.
- Added optional remembered login sessions. Unticked authentication uses a browser-session cookie and configured short server expiry; ticking Remember my session issues a revocable persistent HttpOnly cookie with matching JWT and server-side expiry fixed at seven days.
- Replaced plaintext environment administrator seeding with `scripts/create-admin.mjs`, which validates email, requires at least 8 password characters, masks and confirms the password in a TTY, hashes with scrypt, rejects duplicate users, and writes an audit event.
- Normalized the active `.env` to 15 canonical runtime keys, removed obsolete initial-administrator, trusted-origin, and Telegram values, grouped settings with operator-focused comments, and synchronized the environment templates without changing retained values.
- Implemented strict project creation and policy updates for RAM, storage, five-minute load, and a resettable interval-only heartbeat deadline with no grace-period input.
- Implemented one-time agent installation generation with agent-specific health URL, shell-safe serialization, hashed credentials, exact cron output, one persistent `/bin/sh` file, overlap locking, bounded retries, multi-filesystem/inode reporting, process metrics, Apache state, and safe health-probe diagnostics.
- Simplified new agent installations so the health-probe timeout defaults to 30 seconds and no Apache service name is requested. Agent version 1.1.0 auto-detects the standard LAMPP/XAMPP controller first, then the `apache2` or `httpd` systemd unit, and safely reports `unknown` when no supported manager can be identified.
- Implemented heartbeat-only, invalid-telemetry, duplicate, and valid-telemetry ingestion while keeping `last_heartbeat_at` separate from `last_metrics_at`.
- Implemented central incident opening/recovery for missed heartbeat, RAM, storage, five-minute load, white-label health API, and Apache; seven-day raw retention; downsampled history; and Telegram outbox delivery with retry/backoff.
- Implemented the React/TypeScript backoffice: login, project context, policy editing, operations overview, responsive severity-first server table, incident history, seven-day charts, and script generation/download/copy flow.
- Corrected the project-to-agent information architecture: each selected project now exposes a zero-to-many agent roster inside its unified Overview, agent counts appear in project management, and registration remains repeatable without a duplicate Agents page.
- Made project scope canonical in nested backoffice routes (`/projects/:project_id/...`), separated global Projects from the project workspace, and moved monitoring-policy editing into its own project page. The former nested Agents route redirects to Overview; legacy query-string routes remain compatible.
- Made `/projects` list-first by default and moved project creation into an accessible modal over the collection. The form focuses Project name, dismisses only through its visible close button, restores focus to the exact trigger, prevents dismissal while submitting, and opens the new project's Overview after success; the former `/projects/new` URL redirects to the collection.
- Generated agent version 1.1.1 scripts now record sanitized project and agent names in informational shell comments; database/API ownership continues to use immutable identifiers and credentials.
- Implemented project-scoped agent CRUD with explicit credential lifecycle controls. Settings updates preserve the current credential, monitoring observations, and incident state; a separate confirmed Rotate action revokes the prior credential and returns a no-store one-time replacement script. Deletes soft-remove the agent, revoke access, resolve open incidents, and cancel pending notifications while retaining history.
- Removed Server Health API URL from general Agent Register/Edit settings. Initial registration now advances to a dedicated URL-first script-generation stage before persistence, replacement-script rotation requires and records the URL, and Agent Detail displays the URL used by the latest script.
- Agent registration now opens in an accessible native modal, and health timeout is fixed internally at 30 seconds for create/update rather than exposed as a user or API input.
- Merged the duplicate Overview and Agents pages. The project Overview now combines policy/open-incident summary, diagnostic server fields, agent registration, history links, and modal Edit/Delete actions in one severity-ordered roster; the Agents navigation item was removed.
- Moved incident history from the project-level Incidents page into each agent detail page. The Incidents navigation item was removed, old project incident URLs redirect to Overview, and agent details render their own incidents even when metric history is empty.
- Simplified Agent Incident history into an occurrence log that presents only Incident, Details, and Occurred at. Open/resolved lifecycle state remains internal for alert deduplication and Telegram recovery handling but is no longer exposed in the historical table.
- Removed the redundant All projects shortcut from the selected-project context card. The primary Projects navigation item remains the single sidebar route to the project list.
- Reordered the sidebar hierarchy so global Projects and Setting navigation always appears first. When a project is selected, its Current project context and separately labelled Project workspace navigation appear beneath the global destinations.
- Implemented the approved layered sidebar treatment: a wider Cobalt operations rail, compact current-project selector with server icon and chevron, divided global/project regions, and a restrained active Overview row with a thin blue indicator.
- Generated agent version 1.2.0 removes non-portable escaped-quote awk regular expressions and supports a --dry-run collection mode that prints canonical telemetry without calling the central API. Execution regression tests reject GNU awk warning output, prove dry-run sends zero central requests, and run with either Linux /bin/sh or Git for Windows shell.
- Renamed the project navigation and page from Monitoring policy to Project setting. Added a global Setting page for one platform-owned Telegram Bot Token and Chat ID; the token is encrypted with AES-256-GCM, never returned by the API, and no Telegram setting remains in `.env`.
- Converted every agent Edit and Delete interaction from inline page content to native popup modals. A shared dialog component prevents Escape and backdrop dismissal, supports visible-close-button-only dismissal, provides initial focus and focus trapping, locks dismissal during submission, and restores focus to the exact triggering action.
- Added a global accessible toast layer for every backoffice save and submit result: sign-in, project creation, agent registration/update/delete, project thresholds, and Telegram settings. Success and error messages persist across route changes, auto-dismiss after five seconds, pause on hover/focus, and retain inline form errors for recovery.
- Added repository-level `AGENTS.md` instructions requiring surgical development and targeted Vitest files after each change. Full-suite execution now requires an explicit user request or a prior recommendation followed by user approval.
- Extended the repository instructions for small-task responsiveness: start after minimum discovery, finish functionality and targeted verification before documentation maintenance, report commands still running after 30 seconds, and never label a test hung without evidence.
- Completed a real Windows-to-WSL agent run using an isolated synthetic project. The generated agent collected live WSL metrics, reached the Windows health API, delivered a heartbeat to the central API, persisted healthy telemetry, and rendered its metric history in the authenticated admin panel.
- Moved RAM, storage, five-minute CPU-load thresholds, and heartbeat interval from project policy to each agent. Migration 004 backfills existing agents, project creation is name-only, Agent Register/Edit owns policy and cron timing, project Settings redirects to Overview, and roster/history surfaces present RAM and storage as used utilization.
- Enhanced the login page as a balanced Cobalt Split Studio composition: monitoring context and capability coverage establish product identity on the left, while the right keeps authentication dominant. Mobile collapses to one column while preserving branding, validation, password visibility, toast feedback, and keyboard focus behavior.
- Grouped Agent Register/Edit into Server details, Alert thresholds, and a separate Heartbeat section. RAM, storage, and CPU now share plain-language Telegram alert guidance while heartbeat explains the missed-report alert condition.
- Widened only the Agent Register/Edit modal and compacted its responsive layout into two rows at 768px and above: Server details spans the first row with both fields side-by-side, while equal-height Alert thresholds and Heartbeat fieldsets share the second row. Other modals retain their existing dimensions.
- Further compacted Agent Register/Edit for standard desktop viewports: removed the redundant Edit explanation, shortened helper copy, reduced modal-only spacing, placed RAM/Storage/CPU on one row, and placed Heartbeat/Telegram side-by-side so the complete form fits without internal scrolling. Responsive scroll fallback remains available.
- Corrected the monitored-server resource cell so full RAM, storage, and CPU labels occupy a flexible column while numeric values remain aligned in a protected column; the roster reserves sufficient desktop width without changing mobile card behavior.
- Refined the monitored-server roster into a compact operational table with clearer column labels, proportional desktop widths, aligned resource values, one-line health/report details, horizontal row actions, accessible action hints, and subtle row focus/hover feedback. The existing stacked mobile presentation remains unchanged.
- Combined roster severity and probable cause into one Server state column and removed the Application API column. Last heartbeat now detects expiry from each agent's own interval and renders the concise red `Exceeds heartbeat interval` warning beneath the relative time.
- Standardized the roster section terminology from Monitored servers to Registered agents across the heading, loading/error copy, empty state, accessible section relationship, and table caption.
- Renamed the Registered agents roster's Server column and responsive data label to Agent Name, matching the project's agent-based terminology without changing the stored `server_name` contract.
- Removed the redundant project summary strip from Overview. Registered agents now owns the sole `Total X agent(s)` count, and the client no longer requests project incidents solely to populate the removed open-incident counter.
- Replaced the Projects collection list with a responsive status-card grid. Cards show total agents and an honest project light derived from separate healthy, new, warning, critical, and stale counts; any warning/critical/stale agent makes the project red, while only fully healthy projects are green.
- Renamed the red project aggregate status label from Failure to Error without changing its underlying warning/critical/stale calculation.
- Compacted project status cards by placing the total-agent count and health explanation on one balanced row, reducing unused height while retaining a stacked narrow-screen layout.
- Bottom-aligned the project-card agent count and right-side health explanation so their wording shares one baseline even when project headings wrap to different heights.
- Renamed the project-card primary navigation action from Open project to Manage while preserving its project workspace destination.
- Stabilized project-card actions into one responsive row with a flexible outlined Manage action plus compact Rename and Delete icon controls. Compacted the Rename Project modal and made its name field span the full form width.
- Added single-line project-name truncation with ellipsis and full-name disclosure so long names cannot expand, wrap, or break project-card layout.
- Aligned project-card folder icons, single-line names, and health badges to one consistent header position.
- Extended Title Case consistency to short display labels and status badges, including No Agents, Awaiting Data, Total Agents, and collection/section count nouns, while retaining sentence case for explanatory copy.
- Added authenticated project renaming from each project card through a close-button-only modal, strict name validation, audit logging, and toast feedback while preserving the stable project identity and all monitoring data.
- Added five-second background refresh to Projects, Operations overview, and Agent history. Successful data remains visible during refreshes, hidden tabs skip polling, requests do not overlap, and the seven-day graph window advances with the current time.
- Renamed the agent page's visible context label from Agent history to Agent Detail while retaining history-specific terminology for its record tabs and API states.
- Standardized the agent-roster arrow action tooltip to View Agent Detail and aligned its accessible name with the destination terminology in every roster implementation.
- Consolidated Agent Detail's Last Heartbeat and Last Metrics summary tiles into one Last Updated tile using the newer of the two activity timestamps.
- Added the exact local date and time as muted semantic subtext beneath Agent Detail's relative Last Updated value.
- Renamed the Agent Detail summary label from Heartbeat Interval to Heartbeat Expected Every while retaining the same configured interval value.
- Centralized the five agent-status combinations into one shared presentation used by Operations Overview and Agent Detail: Healthy hides redundant or contradictory cause text, while Awaiting Data, Warning, Critical, and Stale show meaningful causes or status-specific fallbacks.
- Added an Agent Detail Server State help icon and close-button-only definitions modal explaining all five possible states with their existing badges.
- Added a Latest Value summary to every Agent Detail graph header, selected by newest valid metric timestamp and rendered through the shared metric formatters.
- Removed the redundant helper sentence beneath the Agent Detail History Records heading while retaining the accessible tablist label.
- Standardized visible admin titles and headers to Title Case across Projects, Operations Overview, Agent Detail, Login, Settings, modal, chart, tab, summary, legend, empty/error-state, and table-header surfaces; responsive data labels match their desktop headers.
- Extended Title Case to every standalone control and display label, including Copy Raw Log, form labels, action buttons, tooltips, accessible names, incident identifiers, Telegram delivery states, navigation labels, and transient loading labels; removed the CSS rule that forced mono labels to lowercase.
- Removed the Seven-Day Raw History footer label, leaving only the Server Check version.
- Restored UI/UX Pro Max search execution by configuring Codex's bundled Python 3.12 runtime as the real Windows user's preferred Python and adding immediate `python`/`python3` shims for the current Codex host.
- Made authenticated backoffice content fluid across the available viewport after the sidebar. Removed the former 90rem page cap and 54rem wide-form cap while retaining responsive gutters, readable prose measures, purpose-specific login sizing, and modal bounds.
- Added an agent-owned Telegram send interval, defaulting to 15 minutes, that delays later same-agent notifications after a successful delivery without discarding them. Added an authenticated agent-detail Telegram delivery log for pending, sent, and permanently failed messages with attempt and timing details.
- Added a shared Telegram sender and authenticated platform Send Test Message workflow. The action is enabled only after the encrypted Bot Token and receiver Chat ID are saved and disabled while the form contains unsaved changes.
- Reorganized Telegram Alerts into independent sender and destination save operations. Platform Sender contains Save Platform Sender; Alert Destination keeps Save Alert Destination and Send Test Message on one responsive action row. Each form owns its readiness indicator and preserves the other form's stored value.
- Added a specific disabled reason only beneath Send Test Message and linked it through `aria-describedby`; Save buttons retain clean disabled states without explanatory text.
- Removed the separate Configured/Not Configured labels from both Telegram forms; readiness is communicated through saved values, action states, and disabled reasons.
- Stacked Platform Sender and Alert Destination as separate full-width sections, then aligned each Telegram Settings textbox with its owning desktop actions: Bot Token with Save Platform Sender, and Chat ID with Save Alert Destination plus Send Test Message. Helper and disabled-reason text stays under its relevant control; rows stack responsively below 80rem to protect input width and prevent overlap.
- Reduced the entire backoffice rem-based visual system to 90% for a consistently denser interface across navigation, pages, cards, tables, charts, forms, and modals. Preserved the 44px minimum control height by compensating the shared control-height token.
- Applied Manage's neutral outlined secondary-button treatment to the project-card gear action while keeping it icon-only; Delete retains its separate red destructive treatment.
- Moved Back to overview to the top of the one-time access-secret result and added a two-step warning modal before that result can be discarded, clearly explaining that the access secret and generated script cannot be reopened.
- Reordered Agent History into current status summary, seven-day metric graphs, then accessible record tabs. Incident history and Telegram delivery log now share one focused tab surface with keyboard navigation and only the selected panel rendered.
- Added per-incident View Raw Log access inside Agent incident history. The authenticated incident response now includes the complete normalized record and parsed diagnostic details; a read-only close-button-only modal presents and copies the JSON without exposing internal database IDs.
- Standardized active admin interface titles to sentence case while preserving proper names and acronyms. Rebalanced Incident history so Details uses 28% of the desktop table, leaving clearer space for the compact occurrence timestamp and View Raw Log action.
- Aligned the RAM, storage, and CPU threshold controls in the Agent Register/Edit modal by preventing shorter helper text from stretching its field rows and displacing the input.
- Reordered the Registered agents roster so Resource use appears before Server state on desktop and in the responsive card sequence.
- Standardized history-table timestamps through one semantic DateTimeStamp component. Incident and Telegram tables now show compact date and local time lines, while Telegram delivery timing separates Delivered or Next attempt from the timestamp.
- Implemented the Cobalt Workbench design system, dark-mode tokens, responsive application rail, loading/empty/error/success states, mobile focus containment, reduced motion, tabular metrics, and accessible form contracts.
- Verification passed: TypeScript, production build, 62 tests, POSIX shell validation, synthetic generated-agent execution against local fake health/central endpoints, global toast feedback and lifecycle coverage, project-creation modal coverage, agent-scoped incident-history coverage, merged-route and roster coverage, modal focus/confirmation coverage, platform-secret encryption coverage, global and project Setting UI coverage, dependency audit, and the previously completed Playwright browser checks at 320/375/414/768/1280/1440 px with no horizontal overflow or current console errors.
- No database-integrated test was run because `.env.test` and a dedicated local MySQL 8 target are absent. The visible XAMPP client is MariaDB 10.4, which project rules do not permit as a MySQL substitute.
- Git is initialized on main with the requested GitHub origin; the initial commit and push remain pending explicit approval.

Next steps:

- Replace the loopback PUBLIC_BASE_URL with the real central monitor URL reachable by every remote agent, restart the backend, and generate replacement agent scripts.
- Configure a dedicated local MySQL 8 database and `.env.test`, then run `npm run test:db`.
- Run `npm run setup`, `npm run create-admin`, and runtime acceptance against the intended MySQL instance.
- Verify Telegram delivery in the intended channel using a synthetic incident.
- Deploy behind TLS and the chosen process supervisor, then add an independent external check for the central service.
- Resolve the remaining product decisions in `docs/monitoring-requirements.md`.

## Conclusion

The first production-oriented implementation slice is complete and passes every verification available without a configured MySQL test target. It is a production candidate, not production-ready: local MySQL 8 integration, target-site setup, Telegram delivery, TLS/process supervision, independent central monitoring, and backup/restore remain required acceptance gates.
