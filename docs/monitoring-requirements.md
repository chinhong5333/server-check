# Monitoring Requirements

## Scope

The system is a centralized, internal-only server monitoring service. Multiple projects use the same central service while keeping their agents, settings, metric history, incidents, and dashboard views separated by project.

## Project ownership

- Monitoring configuration is agent-scoped within its owning project, not global or project-wide.
- Each registered agent is associated with a project.
- The admin panel must provide a project selector and must scope all server, incident, and history queries to the selected project.
- The Projects login landing page must show all active projects as responsive cards. Each card displays total agents and a text-plus-icon health light: Healthy only when every registered agent is healthy; Error when at least one agent is warning, critical, or stale; Awaiting Data when no errors exist but at least one agent is new; and No Agents when the project is empty. The icon-only Rename action uses a gear icon and the same neutral outlined secondary treatment as Manage without adding visible wording; Delete remains a separate red destructive icon action.
- Threshold changes affect only the selected agent.
- Each agent installation has its own customizable `health_api_url`, selected in the backoffice script generator.
- Project access is limited to authenticated internal users; there is no public registration.

## Agent monitoring setting

Each agent configures these canonical threshold values:

- `ram_available_threshold_percent`: raise a RAM incident when available RAM falls below this percentage.
- `disk_available_threshold_percent`: raise a storage incident when available capacity on a monitored filesystem falls below this percentage.
- `load_5_per_core_threshold`: raise a high-load incident when the five-minute load average divided by logical CPU count reaches or exceeds this value.
- `heartbeat_interval_seconds`: the maximum time permitted between accepted agent heartbeats.
- `telegram_alert_cooldown_seconds`: the minimum time between successful Telegram deliveries for this agent. The accepted range is 300 to 86400 seconds and the default is 900 seconds.

Threshold and interval values remain configurable per agent. The implementation must validate values within explicitly documented ranges and must reject missing or invalid canonical field names rather than guessing aliases. There is no heartbeat grace-period field.

## Platform Telegram alerts

Telegram configuration is platform-scoped. An administrator supplies one BotFather token and one Chat ID or channel username through the authenticated global Setting page. Every project incident and recovery is delivered to that shared channel or group. Telegram settings are not read from environment variables.

The bot token is a write-only secret. The API accepts a new token but never returns it, stores only AES-256-GCM encrypted ciphertext, excludes it from audit metadata, and reports only whether a token is configured. Leaving the token input blank during an update keeps the existing encrypted token. A null Chat ID disables platform Telegram delivery.

When both values are saved and the form has no unsaved changes, Settings exposes Send Test Message. The authenticated, CSRF-protected endpoint decrypts the saved token server-side, sends one clearly marked test message to the saved Chat ID, and returns safe incomplete-configuration or delivery-failure feedback without creating an agent incident or agent Telegram log entry.

Telegram Alerts presents two independent, full-width form sections without separate Configured/Not Configured labels. At standard desktop widths, Platform Sender aligns its Bot Token textbox and Save Platform Sender action on one row; Alert Destination aligns its Chat ID textbox, Save Alert Destination, and Send Test Message on one row. Helper text stays beneath its owning textbox, while the disabled test reason stays beneath only Send Test Message. These controls stack below 80rem so inputs and action labels remain usable without overlap. Saving one form preserves the other form's stored value. Only disabled Send Test Message renders a specific visible reason connected through `aria-describedby`; Save buttons use their ordinary disabled state without reason text.

Telegram rate limiting is agent-scoped even though the destination is platform-scoped. After a successful delivery, later queued messages for the same agent must wait until that agent's `telegram_alert_cooldown_seconds` interval expires. Delayed messages remain pending and are not discarded. Only a successful Telegram API response advances the cooldown; failed attempts retain the existing bounded retry and backoff behavior.

## Backoffice agent script generator

The internal backoffice must provide a project-scoped Overview that combines current monitoring status with the complete agent roster. One selected project owns zero or more registered agents, and an authorized operator can repeatedly register additional agents without replacing existing registrations. Each registration supplies these canonical values:

- `server_name`: the internal display name for the monitored server.
- `health_api_url`: the customizable HTTP or HTTPS URL that this agent calls on its own server or project application.
- `ram_available_threshold_percent`: the agent's available-RAM incident boundary, displayed to operators as RAM utilization above `100 - value`.
- `disk_available_threshold_percent`: the agent's available-storage incident boundary, displayed to operators as storage utilization above `100 - value`.
- `load_5_per_core_threshold`: the agent's five-minute CPU-load-per-core boundary.
- `heartbeat_interval_seconds`: the agent's heartbeat deadline and generated cron interval.
- `telegram_alert_cooldown_seconds`: the minimum delay after one successful Telegram send before another message for this agent may be delivered.

The health-probe timeout is an internal fixed value of 30 seconds. It is not displayed as a form control and is not accepted from create or update API callers.

The heartbeat schedule is taken from the agent's configured interval and converted into an exact crontab entry. The central ingestion URL is taken from trusted central-service configuration and displayed read-only; operators do not retype it for every agent.

Agent Register and Edit do not contain `health_api_url`. Registration first captures the agent name and monitoring settings without creating a database row. It then opens Generate Agent Script, whose first and only step requires Server Health API URL; only that final submission creates the agent, credential, stored URL, and script. General Edit cannot change the URL. Every replacement-script rotation requires the URL again, prefilled from the latest generated script, and atomically stores the normalized replacement URL with the new credential.

Generating an installation must:

- Create a registered agent owned by the selected project.
- Create a unique agent credential and bind it to that agent and project.
- Render a complete, self-contained `.sh` script containing the normalized health API URL, central ingestion URL, agent identifier, credential, configured timeouts, monitoring logic, and agent version.
- Record the owning project name and agent/server name in sanitized, single-line `# Project:` and `# Agent:` shell comments. These comments are informational only and must never be used for authentication, authorization, command construction, or central ownership lookup.
- Auto-detect Apache without operator input: prefer the standard `/opt/lampp/lampp` controller for LAMPP/XAMPP, otherwise detect the `apache2` or `httpd` systemd unit. Report `unknown` when no supported manager can be identified.
- Render the exact crontab entry that invokes the saved script at the agent's monitoring interval.
- Provide separate keyboard-accessible actions to copy the script, download the `.sh` file, and copy the crontab entry.
- Show the generated credential and secret-bearing script only during the installation flow. The page must not persist either in browser local storage and responses must use `Cache-Control: no-store`.
- Place the Back to overview action before the one-time installation content. Leaving must use a two-step confirmation modal that explicitly states the access secret and generated script cannot be reopened after the page is closed.
- Provide an explicit credential rotation and script-regeneration path if the operator loses or exposes the script.
- Allow project administrators to update an agent's canonical server name, monitoring thresholds, heartbeat interval, and Telegram send interval without rotating its credential, resetting current monitoring data, changing incident state, or changing the stored script URL. Retain the fixed 30-second timeout.
- Keep Agent Register/Edit compact on standard desktop viewports: server details occupy the first row; three alert thresholds share one group on the second row; Heartbeat and Telegram alerts sit alongside that group. Preserve 44px controls and responsive stacking, with modal scrolling retained only for small screens, zoom, or unusually constrained viewport height.
- Keep credential rotation as a separate confirmed replacement-script action. Rotation must require and validate Server Health API URL, prefill the latest stored value in the backoffice, atomically record the URL used by the new script, invalidate the previous script, reset current agent observations, close open incidents, cancel pending notifications, and return the replacement script only once with `Cache-Control: no-store`.
- Allow project administrators to delete an agent through explicit confirmation. Deletion must soft-delete the agent, revoke its credential immediately, resolve open incidents, cancel pending notifications, and retain historical telemetry.
- Record an internal audit event when an installation is generated, rotated, revoked, or downloaded.

The generator must parse and validate `health_api_url` as an HTTP or HTTPS URL, but the central service must not request the supplied URL while generating or previewing the script. The URL is called only from the installed agent, preventing the generator from becoming a server-side request-forgery mechanism.

User-controlled values must be serialized with shell-safe quoting. The generated script must never use `eval`, interpolate untrusted values into command positions, or allow a health URL, server name, project name, or error text to become executable shell syntax.

## Installation model

### Central service

The central application is distributed as one Node.js package containing the API, background workers, database migrations, and prebuilt admin-panel assets. It must not require a separately installed frontend project.

`npm install` installs and prepares application dependencies, but it cannot by itself configure MySQL or keep a service running. The minimal supported installation flow is:

```text
npm install
npm run setup
npm run create-admin
npm start
```

`npm run setup` validates the required environment, verifies the MySQL target, and runs explicit migrations. `npm run create-admin` is a separate interactive JavaScript CLI that prompts for an email and masked password, requires password confirmation, hashes the password with scrypt, rejects duplicate active email addresses, and records an audit event. Administrator email and password values must not be accepted through `.env`. Database migrations must not run silently from `postinstall`. A production deployment additionally requires TLS and a process supervisor or service manager so the central application restarts after failure or reboot.

### Monitored server

The agent has no npm, Node.js, Python, container, or package-install requirement. Its expected installation flow is:

1. Generate the agent installation in the backoffice.
2. Copy or download the generated `.sh` script to a chosen path on the monitored server.
3. Restrict the script file to its operating-system owner, using permissions such as `chmod 700` because it contains an agent credential.
4. Run the script once manually to verify its local health probe and central report.
5. Add the exact generated entry to the appropriate crontab.

The script targets Linux `/bin/sh`, uses `curl` and standard Linux command-line utilities, prevents overlapping executions, applies bounded timeouts, and always attempts the central report after its health probe. It runs as a scheduled script rather than a resident daemon. Every payload includes an agent version so the backoffice can identify scripts that require regeneration.

Central-report failures receive bounded retries during the current cron run. The single-file agent does not maintain a persistent local queue or companion spool. If every retry fails, the script exits non-zero, cron captures the failure, and the central missed-heartbeat rule remains the independent detection path.

Supported generated schedules are 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, or 60 minutes.

## Agent probe and reporting workflow

Every scheduled agent run follows this sequence:

1. The agent calls the agent-specific `health_api_url` embedded by the backoffice generator.
2. The agent records whether the call produced an HTTP 200 valid response or an unhealthy result.
3. The agent collects the server telemetry configured for the project.
4. The agent calls the central API and reports the health probe result together with the available telemetry.

The central report must be attempted even when the white-label health API returns an error. A failed application probe is information to report; it must not stop the agent before the central call.

A health probe is healthy only when all configured success conditions pass:

- The request completes within the configured timeout.
- The HTTP response status is exactly 200.
- Any explicitly configured response validation passes.

All other outcomes are unhealthy, including non-200 status codes, DNS failure, connection failure, TLS failure, timeout, or invalid response content. The agent must preserve the HTTP status code when one was received and use `null` when the request failed before receiving an HTTP response.

The canonical health-probe object in a telemetry payload is:

```json
{
  "health_probe": {
    "checked_at": 1788252764000,
    "outcome": "healthy",
    "http_status_code": 200,
    "latency_ms": 42,
    "error_code": null,
    "error_message": null
  }
}
```

Canonical `outcome` values are `healthy` and `unhealthy`. Canonical non-null `error_code` values are `dns_error`, `connection_error`, `tls_error`, `timeout`, `http_status_error`, `invalid_response`, and `unknown_error`.

“Pass back all the info” means the structured diagnostic fields needed to investigate the result. Agents must not forward authorization headers, cookies, unrestricted response headers, or the full response body by default. Any `error_message` must be sanitized and length-limited before transmission and storage.

## Heartbeat contract

The canonical ingestion route will be `POST /api/v1/agent/heartbeats`.

- Authentication and successful agent registration lookup determine whether a request counts as a heartbeat.
- An authenticated request from a registered agent updates `last_heartbeat_at` whether the request has no body or includes a body.
- An empty body is a valid heartbeat-only request and does not create a metric sample.
- A valid telemetry payload updates `last_metrics_at` and creates a metric sample in addition to counting as a heartbeat.
- A non-empty invalid telemetry payload still proves agent connectivity after authentication, but it does not update `last_metrics_at` or create a metric sample. The API must return a clear telemetry validation error and record the validation failure for operators.
- A reported unhealthy health probe still counts as valid telemetry when its fields satisfy the schema. “Unhealthy application” is a monitored result, not a malformed payload.
- Failed authentication and unknown, revoked, or deleted agents do not count as heartbeats.
- Heartbeat freshness and telemetry freshness are separate states. The dashboard must be able to show “agent online, telemetry stale or invalid.”
- The heartbeat deadline is `last_heartbeat_at + heartbeat_interval_seconds`.
- Every accepted heartbeat immediately resets the deadline to one complete interval from its central receive time.
- When central time reaches the deadline without another accepted heartbeat, the service opens one `heartbeat_missed` incident and queues Telegram notification. No additional grace period is applied.
- A heartbeat received after a missed-heartbeat incident resolves that incident and starts a new full interval.

## History and retention

- Accepted heartbeat events are retained for seven days so liveness history includes heartbeat-only calls.
- Valid metric samples and their filesystem and service measurements are retained for seven days.
- The most recent heartbeat and valid metric state remain available on the monitored server record for the current-status view.
- Incident records are retained independently from raw seven-day telemetry; their final retention period remains to be confirmed.
- Retention cleanup must run in bounded batches and must not operate against an unverified database target.

## Incident evaluation

- RAM incidents use available RAM percentage, not the misleading raw “free” memory value.
- Storage incidents are evaluated separately for every configured filesystem or mount point.
- High-load incidents use the five-minute load ratio defined in `CONTEXT.md`.
- White-label health API incidents use the agent-reported health probe outcome and preserve its status code, latency, and safe error classification.
- Liveness incidents use only the affected agent's heartbeat interval. The expiry worker checks deadlines every five seconds; this polling resolution is not a configurable grace period.
- Threshold evaluation occurs centrally. An agent reports measurements but does not decide whether the project is healthy.
- Notifications describe a probable cause. A missed heartbeat alone cannot prove whether the server, agent, network path, or central ingress failed.

## Admin panel requirements

- Internal login only; no self-service signup.
- Use `/projects` as the global collection. Project workspaces use canonical nested routes for the merged Overview and agent detail; project ownership must not depend on a hidden global selector or query string. The former project Settings, Agents, and Incidents routes redirect to Overview.
- Use `/settings` as the global administrator-only Setting page for the platform Telegram destination.
- The default Projects screen displays existing project information and provides `Create project`, `Rename project`, and double-confirmed `Delete project` actions. Create and Rename open modals over the project list, focus Project name, ignore Escape and backdrop dismissal, close only through their visible close buttons before submission, and restore focus to the triggering action. Renaming updates only the display name and preserves the stable project ID, slug, agents, history, and configuration. The former `/projects/new` URL redirects to `/projects`.
- Project-card names must remain on exactly one line. Names truncate with an ellipsis when space is exhausted, keep the complete accessible heading text, and expose the full value through the native title disclosure. Folder icons, names, and health badges remain aligned without moving the card actions.
- Project-scoped Overview with the agent count, open-incident count, unhealthy servers first, and one diagnostic server roster.
- The merged Overview owns the repeatable agent registration action, selected-project agent count, validated inputs, one-time secret presentation, script preview, `.sh` download, script copy, crontab copy, history, Edit, and Delete actions.
- Open agent registration in a native modal that traps focus, ignores Escape and backdrop dismissal, closes only through its visible close button, and restores focus to the Register Agent button. The settings stage excludes Server Health API URL and advances to a dedicated Generate Agent Script stage that requests the URL before the agent is created.
- Agent roster actions for reading Agent Detail, editing non-script configuration without secret rotation, generating a replacement script through confirmed credential rotation with a required health URL, and confirmed deletion with immediate credential revocation. The arrow action uses `View Agent Detail` for its tooltip and a project-specific accessible label. Edit, rotation, and Delete use native popup modals that trap focus, ignore Escape and backdrop dismissal, close only through their visible close buttons before completion, and restore focus to the originating row action.
- Agent Detail displays Latest Script Configuration with the Server Health API URL recorded for the current generated script, followed by aligned seven-day RAM Utilization, Storage Utilization, CPU Load, and Health Latency graphs. Every graph header displays the newest valid metric as a directly labelled Latest Value using the metric's standard percentage, ratio, or latency format.
- Clear differentiation among server unreachable, high load, RAM pressure, storage pressure, service failure, and telemetry staleness.
- White-label health API status showing the latest probe time, HTTP status when available, latency, and failure classification.
- Agent Detail must show the current agent status summary before the seven-day metric graphs. The summary includes Server State, Last Updated using the newer heartbeat or metric timestamp, Heartbeat Expected Every, and Agent Version. Last Updated shows relative time as the primary value and the exact local date and time as muted semantic `<time>` subtext. Server State includes a help control that opens a close-button-only reference modal for Awaiting Data, Healthy, Warning, Critical, and Stale, with plain-language explanations matching central evaluation behavior. Below all graphs, accessible tabs focus the view on either Incident History or Telegram Delivery Log, with only the selected panel rendered. Incidents must remain available when the agent has no metric samples in the selected range. Telegram history must distinguish Pending, Sent, and permanently Failed messages and show attempts, queue time, delivery or next-attempt time, and the final error where applicable.
- Every Agent Incident History row must expose a read-only View Raw Log action. The modal returns the complete normalized incident API record, including severity, lifecycle timestamps, notification timestamp, and parsed `details_json`, provides Copy Raw Log, prevents Escape/backdrop dismissal, and restores focus to the triggering row action when closed.
- Incident and Telegram history tables must use the shared compact timestamp presentation: `DD Mon YYYY` on the first line and local `h:mm:ss AM/PM` on the second. Telegram timing state such as Delivered or Next Attempt must appear as its own label above the timestamp rather than being concatenated into a long sentence.
- Operations Overview and Agent Detail must share one Server State presentation. Healthy shows only the Healthy badge and hides any stale probable cause; Awaiting Data, Warning, Critical, and Stale show the backend probable cause when meaningful or use status-specific fallback text when missing. The roster omits the Application API column. Last Heartbeat compares `last_heartbeat_at` with the selected agent's `heartbeat_interval_seconds`; once the deadline is reached, it renders a red danger icon and `Exceeds Heartbeat Interval` beneath the relative time. Application-probe evidence remains available in Agent Detail.
- Status must use text and iconography in addition to color.
- Every backoffice save or submit action must report its result through an accessible success or error toast. Toasts must not steal focus, must remain visible across route changes, must pause auto-dismiss while hovered or focused, and must keep inline validation or recovery errors at the owning form.
- Loading, empty, error, stale-data, and authorization states must be implemented explicitly.
- The backoffice uses a global 90% rem scale for a denser desktop presentation. Typography, spacing, navigation width, cards, tables, charts, and modal dimensions inherit that scale consistently, while interactive controls retain a minimum 44px height and responsive layouts continue to reflow without clipping.

## Backoffice technology and authentication

- The backoffice is implemented with React and TypeScript.
- Its production assets are compiled ahead of deployment and included in the single central Node.js package; the server does not require a separate frontend installation.
- Login uses a server-issued JWT as the internal user session token.
- Login accepts the canonical optional `body.remember_session` boolean. `false` or omission uses a browser-session cookie and the configured short server expiry; `true` uses a persistent cookie, JWT expiry, and server-side session expiry fixed at seven days.
- The JWT is delivered only through a host-scoped `HttpOnly`, `Secure`, `SameSite=Strict` cookie with `Path=/` and no `Domain` attribute in production.
- The JWT is never returned for React to persist and must not be stored in `localStorage`, `sessionStorage`, IndexedDB, a URL, or application logs.
- React obtains the current authenticated user from the canonical session endpoint and sends same-origin requests with cookies enabled.
- The API validates an explicit signing-algorithm allowlist, signature, expiration, issuer, audience, subject, and session identifier on every protected request.
- JWT claims are minimal and include canonical `sub`, `sid`, `iss`, `aud`, `iat`, `exp`, and `role` values. Project access remains server-authorized and is not trusted solely from mutable browser state.
- A server-side session record identified by `sid` supports logout, revocation, forced sign-out, credential changes, and compromised-session response before JWT expiration.
- State-changing authenticated requests require CSRF-token validation in addition to the cookie's SameSite policy. The central service does not maintain or enforce a trusted-origin allowlist.
- Login attempts are rate-limited and audited. Authentication failures use a generic response that does not disclose whether an internal account exists.
- JWT signing keys are environment-managed secrets with an explicit rotation procedure and are never included in frontend assets.

Canonical authentication routes are:

- `POST /api/v1/auth/login` with canonical `body.email`, `body.password`, and optional `body.remember_session`; success sets either a browser-session or seven-day persistent JWT cookie.
- `GET /api/v1/auth/session` with an empty request body; success returns the current internal user's safe profile and authorization context, not the JWT.
- `POST /api/v1/auth/logout` with an empty request body; success revokes the server-side session and clears the cookie.

## Acceptance scenarios

1. An authenticated agent sends no payload: its heartbeat becomes current, no metric sample is created, and telemetry freshness is unchanged.
2. An authenticated agent sends valid telemetry: heartbeat and telemetry timestamps advance and the sample is retained for seven days.
3. An authenticated agent sends invalid telemetry: heartbeat freshness advances, telemetry freshness does not, and operators can see the validation failure.
4. An agent changes its RAM threshold: only that agent's subsequent evaluations use the new threshold.
5. One project is in a high-load incident: another project's dashboard and alert state remain unaffected.
6. A filesystem crosses its agent's available-storage threshold: the incident identifies the exact filesystem.
7. A heartbeat arrives at 12:00 with a two-minute interval: the deadline is 12:02. A heartbeat at 12:01:20 replaces it with a 12:03:20 deadline. If no heartbeat arrives by the active deadline, the central service opens one liveness incident and queues Telegram; the next accepted heartbeat resolves it.
8. The white-label health API returns a valid HTTP 200 response: the agent reports a healthy probe and the central heartbeat remains current.
9. The white-label health API returns HTTP 503: the agent reports an unhealthy probe with status 503, still calls the central API, and the central service can open an application-health incident without declaring the agent offline.
10. The health probe encounters DNS, connection, TLS, or timeout failure: the agent reports the canonical error code with a null HTTP status code and sanitized details.
11. The health endpoint returns HTTP 200 but fails configured response validation: the agent reports `invalid_response` and an unhealthy outcome.
12. An operator generates an agent with a private or localhost health URL: the generator accepts a valid HTTP or HTTPS URL but does not request it from the central service.
13. An operator enters a value containing shell metacharacters: strict URL validation or shell-safe serialization prevents it from changing the generated script's command structure.
14. An operator copies the generated script to a server, restricts its permissions, runs it once, and adds the supplied crontab line without installing an agent package or runtime.
15. An operator leaves the generation page: the clear-text credential and complete secret-bearing script cannot be retrieved again without rotating the credential and regenerating the script.
16. The central package is installed: dependencies and prebuilt admin assets are prepared, while database migration remains an explicit verified setup action.
17. A generated script overlaps with a previous scheduled execution: the later run exits safely rather than launching a second concurrent collector.
18. An internal user logs in successfully: the API sets an HttpOnly JWT session cookie and the React application obtains the safe user profile from `/api/v1/auth/session`.
19. Browser JavaScript inspects local storage and application state: no JWT or refresh credential is present.
20. A user logs out or an administrator revokes a session: the matching `sid` is rejected even if the signed JWT has not yet expired.
21. A JWT has a disallowed algorithm, invalid signature, wrong issuer or audience, missing required claim, expired timestamp, or revoked session identifier: the API rejects it.
22. An agent create or update request contains `health_request_timeout_seconds`: strict validation rejects the caller-controlled field. Accepted requests always persist and generate the internal 30-second timeout.
23. A generated agent runs on LAMPP/XAMPP: it checks `/opt/lampp/lampp` without requiring an Apache service-name input. On a non-LAMPP host it detects `apache2` or `httpd` through systemd; no supported manager produces `unknown`, not a false inactive result.
24. An authenticated operator keeps Projects, Operations overview, or Agent history open: visible data refreshes every five seconds without replacing the current screen with a loading skeleton. Polling pauses while the browser tab is hidden, resumes on the next interval after it becomes visible, and never overlaps requests from the same resource.
25. Every standalone interface label uses Title Case, including page and section headings, form labels, buttons, links, tooltips, accessible control names, metric labels, status badges, tabs, table headers, and collection/section counts. Only complete descriptive sentences, toast and validation sentences, helper copy, and raw API diagnostic values retain sentence case.

## Open decisions

- Confirm the initial `X` values for RAM, storage, and five-minute load for each project.
- Confirm whether one physical server may belong to more than one project; the initial model assumes one project per registered agent.
- Confirm incident retention beyond the seven-day raw-data window.
- Confirm whether HTTP 200 alone is sufficient or whether projects can define a response-body validation rule.
- Confirm the production service-manager target for the central application.
- The remembered-session lifetime is fixed at seven days from successful login. Unticked sessions retain the configured short server expiry and browser-session cookie behavior; JWT renewal may not exceed the corresponding server-side session expiry.
