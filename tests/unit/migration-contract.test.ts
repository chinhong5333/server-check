import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("database table contract", () => {
  it("gives every table the required lifecycle columns in the required order", async () => {
    const sql = await readFile(path.resolve("migrations/001_initial.sql"), "utf8");
    const tableBlocks = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\) ENGINE=/g)];
    expect(tableBlocks.length).toBeGreaterThan(0);

    for (const [, tableName, block] of tableBlocks) {
      expect(block, `${tableName} must have an auto-increment id`).toMatch(
        /id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT/
      );
      const createdIndex = block.indexOf("created_at BIGINT");
      const updatedIndex = block.indexOf("updated_at BIGINT");
      const deleteIndex = block.indexOf("is_delete TINYINT");
      expect(createdIndex, `${tableName}.created_at missing`).toBeGreaterThan(-1);
      expect(updatedIndex, `${tableName}.updated_at missing`).toBeGreaterThan(createdIndex);
      expect(deleteIndex, `${tableName}.is_delete missing`).toBeGreaterThan(updatedIndex);
    }
  });

  it("models one project owning multiple agents", async () => {
    const sql = await readFile(path.resolve("migrations/001_initial.sql"), "utf8");
    const agentsBlock = sql.match(/CREATE TABLE IF NOT EXISTS agents\s*\(([\s\S]*?)\) ENGINE=/)?.[1];

    expect(agentsBlock).toBeDefined();
    expect(agentsBlock).toContain("project_id BIGINT UNSIGNED NOT NULL");
    expect(agentsBlock).toContain(
      "CONSTRAINT fk_agents_project FOREIGN KEY (project_id) REFERENCES projects (id)"
    );
    expect(agentsBlock).toContain("KEY idx_agents_project_status (project_id, is_delete, status)");
    expect(agentsBlock).not.toMatch(/UNIQUE KEY[^\n]+\(project_id\)/);
  });

  it("stores one platform Telegram configuration with required lifecycle columns", async () => {
    const sql = await readFile(
      path.resolve("migrations/003_platform_telegram_settings.sql"),
      "utf8"
    );

    const block = sql.match(
      /CREATE TABLE IF NOT EXISTS platform_telegram_settings\s*\(([\s\S]*?)\) ENGINE=/
    )?.[1];
    expect(block).toBeDefined();
    expect(block).toContain("id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT");
    expect(block).toContain("scope_key VARCHAR(20) NOT NULL");
    expect(block).toContain("telegram_bot_token_encrypted VARCHAR(1024) NULL");
    expect(block).toContain("telegram_chat_id VARCHAR(64) NULL");
    expect(block!.indexOf("created_at BIGINT")).toBeLessThan(block!.indexOf("updated_at BIGINT"));
    expect(block!.indexOf("updated_at BIGINT")).toBeLessThan(block!.indexOf("is_delete TINYINT"));
  });

  it("moves monitoring policy to agents and backfills existing rows", async () => {
    const sql = await readFile(path.resolve("migrations/004_agent_monitoring_policy.sql"), "utf8");

    expect(sql).toContain("ADD COLUMN ram_available_threshold_percent");
    expect(sql).toContain("ADD COLUMN disk_available_threshold_percent");
    expect(sql).toContain("ADD COLUMN load_5_per_core_threshold");
    expect(sql).toContain("ADD COLUMN heartbeat_interval_seconds");
    expect(sql).toContain("INNER JOIN projects p ON p.id = a.project_id");
    expect(sql).toContain("MODIFY COLUMN heartbeat_interval_seconds INT UNSIGNED NOT NULL");
  });

  it("reads runtime thresholds and heartbeat timing from agents", async () => {
    const [heartbeatRoute, workers, projectRoutes] = await Promise.all([
      readFile(path.resolve("src/server/routes/heartbeat.ts"), "utf8"),
      readFile(path.resolve("src/server/workers.ts"), "utf8"),
      readFile(path.resolve("src/server/routes/projects.ts"), "utf8")
    ]);

    expect(heartbeatRoute).toContain("a.ram_available_threshold_percent");
    expect(heartbeatRoute).toContain("a.disk_available_threshold_percent");
    expect(heartbeatRoute).toContain("a.load_5_per_core_threshold");
    expect(heartbeatRoute).not.toContain("p.ram_available_threshold_percent");
    expect(workers).toContain("a.heartbeat_interval_seconds");
    expect(workers).not.toContain("p.heartbeat_interval_seconds");
    expect(projectRoutes).toContain("cronForInterval(body.heartbeat_interval_seconds, scriptPath)");
    expect(projectRoutes).not.toContain("/:project_id/policy");
  });

  it("adds an agent-level Telegram delivery cooldown and supporting outbox index", async () => {
    const sql = await readFile(path.resolve("migrations/005_agent_telegram_cooldown.sql"), "utf8");

    expect(sql).toContain("ADD COLUMN telegram_alert_cooldown_seconds INT UNSIGNED NULL");
    expect(sql).toContain("SET telegram_alert_cooldown_seconds = 900");
    expect(sql).toContain("MODIFY COLUMN telegram_alert_cooldown_seconds INT UNSIGNED NOT NULL");
    expect(sql).toContain("idx_outbox_channel_status_sent");
  });
});
