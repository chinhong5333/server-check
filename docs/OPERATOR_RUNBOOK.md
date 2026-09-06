# Operator Runbook

## Central service

- Liveness: `GET /api/v1/health/live`
- Database readiness: `GET /api/v1/health/ready`
- Monitor the central URL from an independent system. A failed central service cannot send its own Telegram alert.
- Run one central worker set unless multi-instance leader coordination is added.

## Alert interpretation

An incident appearing in history means Server Check detected the condition and queued a notification. It does not confirm Telegram delivery. Open the agent's **Telegram delivery log** to see whether each alert or recovery is pending, sent, or permanently failed, together with attempts, delivery time, next attempt, and any final error.

- **Heartbeat overdue**: the server, cron, agent, outbound network path, or central ingress may be unavailable. It does not prove the server is powered off.
- **Health API unhealthy**: the agent reached the central service, but the configured server-local API returned non-200 or a transport error.
- **RAM low**: operating-system available memory fell below the project threshold.
- **Storage low**: available capacity on at least one reported filesystem fell below the project threshold.
- **Five-minute load high**: five-minute load average divided by logical CPU count reached the project threshold.
- **Apache inactive**: the generated agent auto-detected LAMPP/XAMPP, `apache2`, or `httpd` and that detected Apache service reported inactive. An unavailable or unrecognized manager reports `unknown` and does not open this incident.

## Credential exposure

1. Open the affected project and choose **Rotate access secret** for the agent.
2. Confirm rotation to revoke the current credential and generate a one-time replacement script.
3. Replace the server script, retain `chmod 700`, and replace the crontab entry when its filename changed.
4. Confirm a new heartbeat and check the audit log. The previous script must fail authentication.

Choosing **Edit** and saving agent settings does not rotate the access secret. If the Health API URL or heartbeat interval changes, apply the matching URL in the installed script and schedule in crontab.

The agent's **Telegram send interval** is an anti-spam minimum gap between successful Telegram messages. Messages raised during that interval remain queued until delivery is allowed. A failed Telegram request does not start a new cooldown and continues through bounded retry/backoff.

If the agent should no longer exist, choose **Delete** instead. Deletion revokes the credential immediately and soft-removes the agent while retaining its historical records.

## Backups and recovery

- Back up the MySQL database with encrypted, tested backups.
- Test restoration into an isolated local MySQL instance.
- Retain `.env` and JWT signing keys in the site's secret-management system, not inside database backups or source control.
- A signing-key loss invalidates all active internal sessions.

## Updates

1. Back up MySQL.
2. Install dependencies and build assets.
3. Run `npm run migrate` against the verified target.
4. Restart through the process supervisor.
5. Verify `/live`, `/ready`, login, project list, and one synthetic agent heartbeat.
6. Roll back application files if verification fails; database rollback requires a migration-specific plan.
