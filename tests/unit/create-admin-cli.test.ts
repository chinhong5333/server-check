import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateAdminEmail,
  validateAdminPassword
} from "../../scripts/create-admin.mjs";

describe("interactive administrator CLI", () => {
  it("documents the interactive flow without requiring database access", () => {
    const result = spawnSync(process.execPath, ["scripts/create-admin.mjs", "--help"], {
      cwd: path.resolve("."),
      encoding: "utf8"
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("npm run create-admin");
    expect(result.stdout).toContain("masked");
    expect(result.stdout).not.toContain("INITIAL_ADMIN_PASSWORD");
  });

  it("normalizes and validates the administrator email", () => {
    expect(validateAdminEmail("  Admin@Example.com ")).toEqual({
      valid: true,
      value: "admin@example.com",
      message: null
    });
    expect(validateAdminEmail("not-an-email").valid).toBe(false);
  });

  it("requires an 8-character password", () => {
    expect(validateAdminPassword("1234567").valid).toBe(false);
    expect(validateAdminPassword("12345678").valid).toBe(true);
  });

  it("uses raw terminal input and never reads an admin password from the environment", async () => {
    const source = await readFile(path.resolve("scripts/create-admin.mjs"), "utf8");
    expect(source).toContain("setRawMode(true)");
    expect(source).toContain('output.write("*")');
    expect(source).not.toContain("INITIAL_ADMIN_EMAIL");
    expect(source).not.toContain("INITIAL_ADMIN_PASSWORD");
  });
});
