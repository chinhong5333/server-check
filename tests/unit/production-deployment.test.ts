import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const ecosystem = require("../../ecosystem.config.cjs");
const script = readFileSync(new URL("../../scripts/update-production.sh", import.meta.url), "utf8");

describe("production deployment configuration", () => {
  it("runs one compiled backend with a sufficient shutdown grace period", () => {
    expect(ecosystem.apps).toHaveLength(1);
    expect(ecosystem.apps[0]).toMatchObject({ name: "server-check", script: "dist/server/server/index.js", instances: 1,
      exec_mode: "fork", watch: false, env: { NODE_ENV: "production" } });
    expect(ecosystem.apps[0].kill_timeout).toBeGreaterThan(10_000);
    expect(ecosystem.apps[0].interpreter).toBe(process.execPath);
  });

  it("orders the update safely and requires an explicit unattended acknowledgement", () => {
    const commands = ['git pull --ff-only', 'pm2 stop "$app_name"', 'npm ci --include=dev --ignore-scripts=false',
      'npm run migrate', 'pm2 startOrRestart', 'phase="readiness verification"', 'pm2 save'];
    const positions = commands.map(command => script.indexOf(command));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(script).toContain('flock -n 9');
    expect(script).toContain('git status --porcelain');
    expect(script).toContain('"${1:-}" != "--yes"');
    expect(script).toContain('ecosystem.local.config.cjs');
    expect(script).not.toContain('git reset');
    expect(script).not.toContain('pm2 stop all');
  });

  it("loads nvm and selects Node 24 before deployment commands", () => {
    expect(script).toContain('source "$NVM_DIR/nvm.sh" --no-use');
    expect(script.indexOf('nvm use 24')).toBeLessThan(script.indexOf('for tool in git node npm pm2 flock'));
    expect(script).toContain('Run nvm install 24');
    expect(script).toContain('!== 24');
  });
});
