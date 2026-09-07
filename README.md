# Server Check

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
