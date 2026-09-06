---
status: accepted
---

# Use one central Node package and generated shell agents

The central monitoring service is distributed as one Node.js package containing its API, workers, migrations, and prebuilt admin panel, while each monitored server runs a self-contained backoffice-generated `/bin/sh` script from cron instead of installing an agent runtime or daemon. This deliberately favors a minimal operator installation surface and outbound-only agents, accepting that script updates require regeneration and that clear-text agent credentials must be handled as one-time secrets.

## Consequences

- The supported central workflow is `npm install`, explicit `npm run setup`, interactive `npm run create-admin`, then `npm start`; MySQL configuration, verified migrations, administrator input, TLS, and process supervision cannot safely be replaced by `npm install` alone.
- Database migrations do not run silently from npm `postinstall`.
- The backoffice owns script generation, agent credential creation, safe shell serialization, crontab generation, version visibility, rotation, revocation, and audit history.
- The monitored server needs `/bin/sh`, `curl`, and standard Linux utilities, but no Node.js, npm, Python, container, or agent package.
- A generated script must be copied again when its credential, health URL, schedule, or agent implementation changes.
