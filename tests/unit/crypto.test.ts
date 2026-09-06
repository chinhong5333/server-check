import { describe, expect, it } from "vitest";
import {
  createAgentCredential,
  csrfTokenForSession,
  hashPassword,
  sha256,
  verifyPassword
} from "../../src/server/security/crypto.js";

describe("security primitives", () => {
  it("hashes and verifies internal passwords", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(encoded).not.toContain("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", encoded)).resolves.toBe(false);
  });

  it("derives stable CSRF tokens per session", () => {
    expect(csrfTokenForSession("a".repeat(32), "session-1")).toBe(
      csrfTokenForSession("a".repeat(32), "session-1")
    );
    expect(csrfTokenForSession("a".repeat(32), "session-1")).not.toBe(
      csrfTokenForSession("a".repeat(32), "session-2")
    );
  });

  it("creates a credential that can be stored only as a hash", () => {
    const result = createAgentCredential("2eaac131-76e2-4d36-b1f4-54ddf5a17a6f");
    expect(result.credential).toMatch(/^ag_2eaac131-76e2-4d36-b1f4-54ddf5a17a6f\./);
    expect(result.credentialHash).toBe(sha256(result.credential));
    expect(result.credentialHash).not.toContain(result.credential);
  });
});
