# Server Check

## Admin Controls

### Recurring Telegram Alerts

Alert collection is independent of delivery timing. Each observed non-healthy condition queues a Telegram alert: resource thresholds, unhealthy middleware, inactive/unknown monitored services, invalid/missing telemetry, and awaiting the first heartbeat. The five-second heartbeat evaluator collects awaiting/overdue conditions; normal telemetry conditions are collected when reports arrive. Disabled checks do not create errors.

One pending message is retained per incident/error identity. Identity includes the condition/cause and stable diagnostics such as HTTP status, error code, service, filesystem mount, or validation reason; changing timestamps, latency, and metric values do not create duplicates. Repeated observations refresh pending payload details without resetting retry counts or next-attempt timing. After a message is sent, failed, or cancelled, a subsequent observation can collect another. Manual Clear Pending Messages therefore clears the current queue, not future observations of an ongoing error.

Delivery obeys the agent's Telegram Send Interval across all its errors and recoveries, measured from the last successful send. Agent row locking serializes collection, recovery, cancellation, and delivery, and delivery rechecks the current interval under that lock. Individual worker tasks do not overlap in one process. Delivery failures retain the existing retry/backoff policy; a continuing observed condition can enqueue a new record after the previous record exhausts its attempts. An uncertain network response can still result in an at-least-once duplicate delivery; queue deduplication cannot provide Telegram-side exactly-once delivery.

Recovery cancels unsent alerts for that incident, retains their Cancelled logs, and queues a recovery message. Invalid/missing telemetry cannot prove recovery of earlier resource or service incidents; a valid report is needed. Awaiting-first-heartbeat alerts are superseded without a false recovery message when the initial heartbeat becomes overdue. Existing pending rows without an identity are reused when next observed.

**Deployment:** stop all backend instances, build, run `npm run migrate` to apply `009_pending_alert_identity.sql`, and restart. Back up production before migration. Do not run the new collector against the old schema or mix old/new worker versions during rollout. Existing agent scripts remain compatible. Dedicated local MySQL integration (including concurrent collection) is in `tests/integration/retention.test.ts`; use the documented isolated `.env.test` command below, never production data.

The sidebar gear opens the Settings workspace. Its individual pages are Telegram Management (`/settings/telegram`), Teams (`/settings/admins`), and Change Password (`/settings/password`). Teams displays member email, full-access role, and joined date; Add Admin opens the creation modal. The first two pages require admin access; signed-in operators can access only Change Password. `/settings` redirects to the first permitted settings page, and the old `/account` URL redirects to Change Password. Each page includes Back To Projects.

- **Agent Detail → Telegram Delivery Log → Clear Pending Messages:** two confirmation steps cancel pending Telegram items for that agent only. Records remain visible as Cancelled; future alerts and other agents are unaffected. Messages already being sent may still arrive. The worker locks/rechecks a queued row before sending, so cancellation cannot be overwritten by a stale queue selection. Delivery is still at-least-once: an upstream timeout or a process/database failure after Telegram accepted a message can result in an uncertain delivery. Cancelled logs expire after 90 days under the retention policy.
- **All Projects → Sort Projects:** drag the list or use its move buttons, then Save Order. Cancel discards the draft. The saved order is global for all users, up to 2000 projects. A stale list is rejected with a conflict; cancel and refresh before retrying. Existing projects initially retain alphabetical order; newly created projects appear ahead of manually ordered projects until the next save.
- **Settings → Admin Management:** existing admins can list and create full-access admins. Creation requires the acting admin's current password and a new 15–128 character password with confirmation. Email addresses are unique and normalized to lowercase. Passwords are stored using the existing scrypt hashing mechanism and never returned in API responses or audit metadata. Share initial credentials securely; the new admin can change their password through Settings → Change Password. Creation is limited to five requests per admin per 15 minutes. No restricted/sub-admin role management is included.

These actions are enforced as admin-only on the backend; writes also require CSRF protection and create audit records. New API contracts are `GET/POST /api/v1/admins`, `PUT /api/v1/projects/order` (`ordered_ids`, `expected_ids`), and `POST /api/v1/agents/:agent_id/telegram-deliveries/cancel-pending` (`confirm: true`). Admin creation accepts only `email`, `password`, and `current_password`; callers cannot select a role. All new endpoints reject extra query/body inputs as documented in their route JSDoc.

Before deploying, back up the database, stop the backend, rebuild, apply pending migrations with `npm run migrate` (including `008_project_order.sql`), and restart the backend. Do not run the new project-list API against the old schema. If the retention amendment is also pending, review its irreversible retention policy and index migration before restarting. No agent-script reinstall is needed.

The focused real-database test requires an **empty, dedicated local MySQL 8+ test schema**, with `.env.test` configured; it refuses existing project/admin records:

```bash
node --env-file=.env.test node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/admin-controls.test.ts
```

This test verifies persistence and scope using synthetic fixtures and an injected test identity, not the live sign-in flow. Test authentication/CSRF enforcement separately through the focused unit tests and perform site acceptance before production use. Never run it against development or production data.

## Database Retention And Capacity

The backend runs cleanup on startup and every ten minutes. Retention is based on server timestamps:

| Records | Retention |
| --- | --- |
| Heartbeats and metrics, including linked filesystem/service samples | 7 days |
| Sent Telegram deliveries | 30 days after sending |
| Failed or cancelled Telegram deliveries | 90 days after their last update |
| Resolved incidents | 90 days after resolution, and only after all linked deliveries are removed |
| Audit events | 180 days |
| Open incidents and pending deliveries | Preserved; operator action may be required |

Cleanup uses 500-row autocommitted batches, cycling between categories, with up to 100 rounds and a 30-second scheduling budget. An in-progress database statement may finish after the budget; it is not forcibly cancelled. Row-lock waits are limited to two seconds on the dedicated cleanup connection and restored afterward. A database-scoped advisory lock prevents concurrent cleanup across backend instances connected to the same MySQL server. No automatic OPTIMIZE, TRUNCATE, or deletion of recent data is performed.

Structured backend logs under `worker: history-retention` record deleted parent-row counts (cascaded child deletions are not included), duration, remaining expired-record timestamps, estimated database allocation, and oldest pending delivery. Warnings flag any remaining eligible backlog, estimated allocation of at least 1 GiB (an advisory threshold, not a quota), and pending deliveries older than seven days. Errors record partial progress; successful batches stay committed and the next run retries remaining work. Monitor these logs for failures or an absent completion heartbeat across two cleanup intervals; these warnings are not Telegram messages.

### Deploying The Retention Amendment

Back up the production database before enabling the new retention policy. Stop the backend, build the updated source, run `npm run migrate` to apply `007_retention_indexes.sql`, then restart the backend. Index creation on large existing tables requires a maintenance window and temporary disk headroom. If migration fails partway, do not blindly rerun or edit a recorded migration: inspect the existing indexes and resolve the partial application first. Verify cleanup completion and backlog warnings after restart. Expired records are permanently deleted; recovery requires your backup.

For guarded integration validation, configure `.env.test` for a dedicated local MySQL 8+ instance, then run only:

```bash
node --env-file=.env.test node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/retention.test.ts
```

Never point that test at development, shared, or production data. It exercises real cleanup and cascading foreign keys in the disposable test database.

Retention limits record age, not total disk usage. Capacity still depends on agent count, report frequency, filesystems, and protected unresolved records. InnoDB generally reuses deleted space internally rather than shrinking its files automatically. Track free space on the actual MySQL data volume separately (for example, warn below 20% free, critical below 10%); database allocation estimates do not include MySQL binary logs, backups, or PM2/application logs. Configure their rotation/expiry separately with the database/backup operator, respecting replication and recovery requirements. Investigate persistent backlog or rising allocation rather than deleting protected or recent data to meet an arbitrary size cap. Any physical table rebuild requires a planned maintenance window, backup, and enough free disk space.

Server Check is an internal, multi-project server-monitoring service. A generated one-file Linux agent probes a server-local health API, collects host metrics, and reports to a central Node.js API. The central service retains seven days of raw history, evaluates agent-specific thresholds, records incidents, sends Telegram notifications, and serves a React/TypeScript backoffice.

## Current verification status

- Implemented: Node.js API, React backoffice, MySQL migrations, JWT-cookie login, agent-scoped monitoring settings, one-file agent generation, heartbeat/telemetry ingestion, incident transitions, retention, and Telegram delivery with per-agent cooldowns and delivery logs.
- Verified: TypeScript, production builds, unit tests, a real POSIX shell syntax check, synthetic shell-to-HTTP execution, and browser review at 320, 375, 414, 768, 1280, and 1440 px.
- Pending site acceptance: migrations and workflows against a dedicated local MySQL 8 test database, then the intended production MySQL instance, TLS endpoint, Telegram channel, and Linux hosts.

Do not describe this build as production-ready until the pending MySQL and deployment acceptance gates pass.

## Requirements

- Node.js 24 or newer
- MySQL 8 or newer
- A TLS-capable reverse proxy for production
- Linux monitored servers with `/bin/sh`, `curl`, and standard procps/core utilities

MariaDB is not used as a test substitute for MySQL. The XAMPP installation visible in the development environment provides MariaDB 10.4, so database-integrated tests require a separate local MySQL 8 test instance.

## Central installation

### Monitoring Charts

All four agent-detail graphs use TradingView Lightweight Charts (self-hosted npm package) with our existing authenticated history API. They retain independent 1m/5m/30m/1h controls and latest readings. Native mouse/horizontal-touch dragging is enabled; wheel, pinch, and axis zoom are disabled. Each chart initially displays about 60 samples and pans through its loaded seven-day history without fetching on pointer release. Non-default intervals refresh once per minute; the default 30m series reuses the page history. Historical viewing position is preserved during updates, and updates arriving during a pointer drag are deferred until release. Hover details appear in a bounded floating tooltip; the bottom caption shows only the visible date range. The TradingView attribution remains visible; see THIRD_PARTY_NOTICES.md. No agent-script or database migration is required.

### Telegram Bot Link

The Telegram page displays **Telegram Bot Link** under **Platform Sender** when a bot token has been saved. The admin-only `GET /api/v1/settings/telegram/bot-link` endpoint accepts no body or query fields, resolves the saved credential through Telegram `getMe`, and returns only `{ username, url }`. The link opens the bot's chat, not the alert group. Saving a replacement token refreshes it; unsaved token edits hide the old link. Lookup failures offer an inline retry without blocking settings. Requests are limited to six per minute per admin, responses are not cached, and raw upstream errors/tokens are never returned. No chat updates are read, messages sent, or database migrations required.

### 1. Select Node.js 24 with nvm

On Linux, install nvm if needed using its [official installation guide](https://github.com/nvm-sh/nvm#installing-and-updating). Open a new shell after installation, then run these commands as the deployment user before installing project dependencies:

```bash
nvm install 24
nvm use 24
node -v
npm -v
```

Confirm that `node -v` reports `v24.x.x`. Run `nvm use 24` again in new deployment shells. nvm selects Node for the current shell; other applications can retain their own Node versions.

Node.js 16 is incompatible with this project. `EBADENGINE` warnings and the TypeScript `ERR_UNKNOWN_FILE_EXTENSION` error during installation indicate that an unsupported runtime is being used. Switch to Node 24 and reinstall dependencies; do not rename files inside `node_modules` or bypass engine checks.

### 2. Configure the database and environment

Create a MySQL database and least-privilege application user. Copy `.env.example` to `.env` and replace every placeholder. Do not overwrite an existing deployment's `.env`.

### 3. Install, set up, and start

From the project directory, use the committed lockfile for a reproducible installation:

```bash
npm ci --include=dev
npm run setup
npm run create-admin
npm start
```

`npm ci --include=dev` installs the locked dependencies and runs `postinstall`, which compiles the server and prebuilt backoffice assets. Build dependencies are required even when `NODE_ENV=production`; do not omit them before building. For an ordinary non-locked installation, `npm install --include=dev` also runs the build. `npm run setup` verifies the configured database and applies explicit migrations. On a fresh deployment, `npm run create-admin` prompts for the administrator email and a masked password, hashes the password with scrypt, and inserts an audited administrator record. Skip administrator creation if the account already exists. Administrator credentials are never read from or retained in `.env`. Database mutation never runs from `postinstall`.

The central process listens on `HOST` and `PORT`. `npm start` runs in the foreground. Put it behind HTTPS and a process supervisor before production use. An example systemd unit is available at `deploy/server-check.service.example`.

### PM2 Setup And One-Command Updates

Use the same Linux deployment user for every PM2 command. Select Node 24 and install PM2 once:

```bash
nvm use 24
npm install --global pm2
```

The tracked `ecosystem.config.cjs` manages the `server-check` process. To customize its name, logging, or restart settings without creating Git conflicts, copy it once (do not overwrite an existing local file):

```bash
cp -n ecosystem.config.cjs ecosystem.local.config.cjs
```

Edit `ecosystem.local.config.cjs` as needed. Keep one fork-mode instance, `watch: false`, the existing `cwd`/`script`, and `env: { NODE_ENV: "production" }`. Keep HOST, PORT, and credentials in `.env`, not ecosystem environment overrides. The updater automatically prefers the local ecosystem file. One instance avoids duplicate background workers. The 15-second PM2 kill timeout allows the application's 10-second shutdown deadline. The interpreter follows the Node executable used to invoke PM2.

For an already installed/built/migrated deployment, start under the ecosystem file:

```bash
pm2 startOrRestart ecosystem.local.config.cjs --only server-check --update-env
pm2 save
pm2 startup
# Run the privileged startup command printed by PM2, then pm2 save again.
```

If an existing PM2 process wraps `npm start` rather than the compiled entry point, replace that old process once during a maintenance window before starting the ecosystem configuration. Stop/remove only this application's old PM2 entry, never other apps. If changing the app name, remove the old named instance first to avoid two monitoring workers. Regenerate PM2 startup integration after changing the nvm Node installation.

For subsequent updates, from the repository:

```bash
bash scripts/update-production.sh
```

The script loads nvm and runs `nvm use 24` automatically before checking npm/PM2 or changing the deployment. Install Node 24 once with `nvm install 24`; the updater does not install runtimes automatically. It respects `NVM_DIR`, otherwise uses the standard `$XDG_CONFIG_HOME/nvm` or `$HOME/.nvm` location. PM2 must be installed under the selected Node 24 environment. See the [official nvm loading instructions](https://github.com/nvm-sh/nvm#installing-and-updating).

The command is **`npm ci`**, not `npm run ci`. The updater checks Node/PM2/flock, requires a clean worktree and an upstream branch, obtains a repository update lock, pulls with `git pull --ff-only`, stops only the configured app, runs `npm ci --include=dev` (including the postinstall server/client build), runs `npm run migrate`, starts/restarts from the ecosystem file, checks local API/database readiness, and saves the PM2 process list. `pm2 save` persists the current user's entire PM2 list, not only this app. Existing `.env` is preserved. The reverse proxy remains unchanged.

This is a maintenance-window deployment, not zero downtime. The script runs directly without a backup prompt or confirmation flag. Migration/build failures stop the workflow; the app may remain stopped and no automatic code/database rollback is attempted. A readiness failure after startup leaves the app available for PM2 inspection. Use `pm2 logs server-check --lines 100` (or your configured name) to diagnose it. Do not blindly retry partially applied MySQL DDL migrations. Ensure no other supervisor or PM2 user is running this application.

References: [PM2 ecosystem options](https://doc.pm2.io/en/runtime/reference/ecosystem-file/), [PM2 environment updates](https://pm2.io/docs/runtime/best-practices/environment-variables/), and [npm ci](https://docs.npmjs.com/cli/commands/npm-ci/).

The supervisor must also use Node 24; it does not automatically inherit an interactive `nvm use` command. `nvm which 24` shows the selected executable. The example systemd unit uses `/usr/bin/node` and `ProtectHome=true`, so a runtime inside a user's nvm home directory is not accessible through that unit as written. Use a service-accessible Node 24 installation outside home directories and set `ExecStart` to its absolute executable path, retaining the service's hardening.

PUBLIC_BASE_URL must be the central monitor address that every monitored server can reach. Do not leave it as 127.0.0.1 when agents run on other servers because loopback points the agent back to itself.

Telegram does not use environment configuration. Open the global **Setting** page and enter the platform Bot Token and Chat ID for the channel or group that receives every project alert. The token is encrypted before MySQL storage, is never returned to the browser, and must be re-entered only when replacing it.

After saving Platform Sender, use **Select Telegram Chat** to discover available group/channel names and IDs. Send `/start@YourBotUsername` in your Telegram group first, then click **Refresh List** in the modal. The guide uses the saved bot's actual username once identified. Selecting a chat fills the Chat ID field; **Save Alert Destination** remains required. Manual Chat ID entry is still available.

Discovery reads at most 100 pending updates, not the bot's complete membership list. It does not acknowledge updates, change update subscriptions, disable webhooks, or send a message. An existing webhook or competing update consumer may prevent discovery; the modal explains the conflict instead of changing the bot integration. See [Telegram's getUpdates contract](https://core.telegram.org/bots/api#getupdates).

## Agent installation

1. Sign in to the backoffice.
2. Create or select a project.
3. Open the project **Overview** and choose **Register agent**.
4. Enter the server name, server-local health API URL, RAM utilization threshold, storage utilization threshold, CPU-load threshold, heartbeat interval, and Telegram send interval. Health requests always use the fixed 30-second timeout.
5. Generate and immediately save the one-time `.sh` script.
6. Copy it to the monitored server, apply `chmod 700`, run it once, and add the generated crontab line.

The agent is one persistent shell file. It requires no Node.js, npm, Python, container, daemon, `.env`, or companion module. It may use temporary lock/error files during a run, and removes them when it exits.

The first lines of every generated script include non-executable `# Project:` and `# Agent:` comments for operator reference. Runtime authentication and ownership continue to use the embedded agent identifier and credential.

Apache monitoring is automatic. The generated agent checks `/opt/lampp/lampp` first for LAMPP/XAMPP, then detects the `apache2` or `httpd` systemd unit. If none can be identified, it reports the Apache state as `unknown` rather than raising a false inactive-service incident.

Each project owns an agent roster and can register multiple agents. Registering another agent adds it to the selected project without replacing or reconfiguring existing agents.

Agents support create, read, update, explicit credential rotation, and delete from the project roster. Register, Edit, Rotate, and Delete open native popup modals with keyboard focus containment and focus restoration. Agent Register/Edit uses a compact two-row desktop layout that fits standard viewports without internal scrolling while retaining safe scrolling for small screens and browser zoom. Before an action completes, every modal ignores Escape and backdrop dismissal and closes only through its visible close button. The one-time access-secret result places Back to overview at the top and requires two confirmations before discarding the secret and generated script because they cannot be reopened. Updating settings preserves the existing credential and monitoring state. Because the Health API URL and heartbeat schedule are embedded in the installed script and crontab, operators must apply those values locally after changing them. Credential rotation is a separate confirmed action that revokes the old script and returns a one-time replacement. Deleting an agent requires modal confirmation, soft-removes it, revokes its credential immediately, closes its open incidents, and retains historical records.

Backoffice project scope is explicit in the URL: `/projects` is the login landing page and presents every active project as a status card with total agents and a health light. A card is green only when every registered agent is healthy, red when any agent is warning, critical, or stale, neutral while agents await their first report, and empty when none are registered. Project creation remains a name-only modal. `/projects/:project_id` is the merged monitoring and agent-management Overview. The former project Settings, Agents, and Incidents routes redirect to Overview. Agent Register/Edit owns monitoring thresholds, heartbeat timing, and the minimum delay between successful Telegram sends for that agent. Agent detail routes present the current agent status summary first, seven-day utilization graphs second, and tabbed Incident history or Telegram delivery history last. Each incident provides a read-only View Raw Log modal with the complete normalized incident record, parsed diagnostic details, and copy support.

The Overview roster combines overall severity and probable cause under **Server state**. **Last heartbeat** compares the latest central receipt time with that agent's configured interval. When the deadline has passed, a red icon-and-text warning shows the interval that was exceeded. Application-probe history remains available on the agent detail page rather than competing with overall state in the roster.

The global `/settings` page owns the single platform Telegram destination.

An incident record means the condition was detected and a notification was queued; it does not by itself prove Telegram accepted the message. The agent detail **Telegram delivery log** is the authoritative operator view for pending, sent, and permanently failed deliveries, including attempts, delivery time, next attempt, and the final error. A queued message that falls inside the agent's Telegram send interval is delayed rather than discarded.

Backoffice save and submit actions report success or failure through an accessible global toast. Toasts persist across route changes, auto-dismiss after five seconds, pause while hovered or focused, and can be dismissed manually; form validation and API recovery details remain inline.

History tables render timestamps as a compact two-line `DD Mon YYYY` and local `h:mm:ss AM/PM` value. Telegram delivery timing uses separate `Delivered` or `Next attempt` labels so dates do not wrap unpredictably inside narrow columns.

Heartbeat expiry uses each agent's interval. Every accepted heartbeat resets that agent's central deadline to `received_at + interval`; there is no grace-period setting.

To verify collection before the central API is available, run the replacement agent in dry-run mode:

    ./server-check-agent.sh --dry-run

The command still probes the configured white-label health API, prints the complete telemetry JSON to standard output, and skips the central heartbeat POST. If jq is installed, append a pipe to jq for formatted output.

## Commands

```text
npm run dev          Start the Vite client and TypeScript server watchers
npm run typecheck    Check client and server TypeScript
npm test             Run non-database unit and synthetic integration tests
npm run build        Build the server and backoffice
npm run setup        Verify the database and apply migrations
npm run create-admin Interactively create an internal administrator
npm run migrate      Apply pending database migrations
npm run test:db      Run guarded tests against .env.test
npm start            Start the built central service
```

## Database test safety

`npm run test:db` refuses to proceed unless:

- `NODE_ENV=test`
- `DB_HOST` is `127.0.0.1`, `localhost`, or `::1`
- `DB_NAME` ends in `_test`
- The server identifies itself as MySQL 8 or newer, not MariaDB

Create `.env.test` from `.env.test.example` using a dedicated disposable local database and credentials. Never point this file at development, staging, shared, or production data.

## Security model

- Internal login only; no public signup.
- JWT sessions are delivered in HttpOnly, Secure, SameSite=Strict cookies in production.
- Login offers an optional Remember my session control. Unticked logins use a browser-session cookie and the configured short server expiry; ticked logins use a revocable persistent cookie and matching JWT/server expiry fixed at seven days.
- JWTs are never exposed to React or browser storage.
- Server-side session records provide logout and revocation.
- State-changing authenticated backoffice requests require CSRF-token validation.
- Agent credentials are stored centrally only as SHA-256 hashes and shown in clear text once inside the generated script.
- Agent creation and explicit credential-rotation responses use `Cache-Control: no-store`. Settings updates preserve the credential, while rotation and deletion revoke it. Secret-bearing scripts must remain owner-readable only (`chmod 700`).
- Script generation validates URLs, never probes them centrally, applies shell-safe quoting, and never uses `eval`.

## Main routes

- `GET /api/v1/settings/telegram/chats` — admin-only discovery using the saved bot; empty body/query.

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/session`
- `POST /api/v1/auth/logout`
- `GET|POST /api/v1/projects`
- `PATCH /api/v1/projects/:project_id/policy`
- `GET /api/v1/projects/:project_id/agents`
- `PUT|DELETE /api/v1/projects/:project_id/agents/:agent_id`
- `POST /api/v1/projects/:project_id/agents/:agent_id/credential-rotation`
- `GET /api/v1/projects/:project_id/incidents`
- `POST /api/v1/projects/:project_id/agent-installations`
- `GET /api/v1/agents/:agent_id/history`
- `GET /api/v1/agents/:agent_id/incidents`
- `POST /api/v1/agent/heartbeats`

All backend routes and middleware carry synchronized JSDoc contracts in the source.
