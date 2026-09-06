# Optional Agent Health Checks

Agent scripts generated as version 1.3.0 support independent Apache, Nginx, and Middleware API checks. The former Server Health API URL is the Middleware API URL; it is not a second endpoint.

## Configuration

During Register Agent → Generate Agent Script, choose the Health Checks to enable. Existing agents use the access-secret replacement dialog to choose checks and generate a replacement script. That action rotates the credential, so install the replacement script immediately. Changing monitoring policy in Edit Agent does not change these script selections or rotate credentials.

The canonical script-generation body includes:

```json
{
  "health_api_url": null,
  "checks": {
    "apache": false,
    "nginx": true,
    "middleware_api": false
  }
}
```

`health_api_url` must be an HTTP(S) URL without embedded credentials when `checks.middleware_api` is true, and must be null when false. The registration endpoint combines these fields with the documented agent settings. Every check flag is a boolean; aliases are rejected. All checks may be disabled while resource telemetry and heartbeats continue.

Existing installations and pre-1.3 callers without a `checks` object retain Apache=true, Nginx=false, Middleware API=true. Existing telemetry without `service_checks.nginx` remains accepted and is normalized to an unmonitored Nginx result at ingestion. No existing script is automatically regenerated or installed.

## Detection

- Apache uses the executable `/opt/lampp/lampp` status output first; otherwise it checks the loaded `apache2` or `httpd` systemd service. Unsupported installations or unavailable status information report Unknown.
- Nginx checks a loaded systemd unit first. If unavailable, it checks an exact local `nginx` process name with pgrep. A detected running process reports active; a known installed binary with no process reports inactive; unavailable detection reports unknown.
- Middleware API performs the existing bounded curl request. HTTP 200 means healthy; non-200, DNS, connection, TLS, timeout, and other curl failures mean unhealthy. It does not validate the response body.
- Disabled checks do not execute their probes. The middleware disabled result contains null HTTP status, latency, and error fields.

Web-server health is local service/process status, not proof that every virtual host or HTTP request works. See [systemd's service-state interface](https://github.com/systemd/systemd/blob/main/man/systemctl.xml) and [Nginx process control](https://nginx.org/en/docs/control.html) for the underlying service/process distinction.

## Agent Detail

Health Checks displays Apache Web Server, Nginx Web Server, and Middleware API independently. Labels are Healthy, Error, Unknown, Not Monitored, Awaiting Data, and Stale. Each reported result includes its latest receipt timestamp and available service name or HTTP/latency/error diagnostics.

Results become Stale if the latest heartbeat or valid telemetry exceeds the configured heartbeat interval, or telemetry is currently invalid/missing. Historical HTTP 200 is then marked as a last report, not current health. An agent with no persisted result shows Awaiting Data. Disabled checks show Not Monitored regardless of old results.

## Persistence And Alerts

Migration 006 adds nullable saved-configuration and latest-result JSON columns to agents and allows a null health_api_url. Existing rows retain their data and interpret null configuration using the legacy defaults. Lifecycle columns remain last. Latest snapshots are updated only for newly accepted, valid telemetry; duplicate samples do not refresh metric freshness. Enabled/disabled payload states must match the saved configuration, preventing a payload from silently dropping an enabled check.

Both web-server results are retained in service_check_samples. Middleware uses the existing health_probe and metric columns. Disabled HTTP results are excluded from the health-success average and have no latency sample. No earlier history is erased.

Inactive monitored services and failed middleware checks produce Critical incidents. Indeterminate monitored web-server status produces Warning. An existing inactive-service outage stays open and Critical when the next probe is Unknown; unknown detection is not proof of recovery. Existing incident deduplication and Telegram cooldown apply. Script replacement retains the existing incident closure/pending-message cancellation behavior and clears the previous latest health snapshot.

## Rollout And Validation

Deploy the backend and migration before installing 1.3.0 scripts. Existing 1.2 scripts remain compatible with their legacy configuration. Choose optional checks and install a replacement script only on servers whose configuration should change. A new result appears after the script reports. Do not roll back the server to the pre-1.3 telemetry contract while scripts are sending disabled/Nginx results; coordinate server and script rollback.

The local migration was applied after a full database backup. Focused unit/route tests use synthetic mocked database dependencies; generated scripts were executed through a real POSIX shell against synthetic HTTP servers and a simulated service manager. Existing live agents were not mutated or used for write-capable testing. Dedicated local MySQL integration tests remain pending because .env.test is absent; .env.test.example contains placeholder credentials. The local runtime uses XAMPP MariaDB, which is not a substitute for the project's dedicated MySQL test target. A production host's actual Apache/Nginx installation and middleware endpoint still require deployment acceptance.
