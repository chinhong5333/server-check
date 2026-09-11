import { expect, it } from "vitest";
import { accountPasswordSchema, createAdminBodySchema, changePasswordBodySchema, loginBodySchema } from "../../src/shared/contracts";
import { validateAdminPassword } from "../../scripts/create-admin.mjs";
it.each(["Abcdef1!", "Ab1!"+"a".repeat(124)])("accepts complex passwords within the 8–128 character boundary", password => {
  expect(accountPasswordSchema.safeParse(password).success).toBe(true);
  expect(validateAdminPassword(password).valid).toBe(true);
  expect(createAdminBodySchema.safeParse({email:"test@example.test",password,current_password:"legacy"}).success).toBe(true);
  expect(changePasswordBodySchema.safeParse({current_password:"legacy",new_password:password}).success).toBe(true);
});
it.each(["Abcd1!", "abcdef1!", "ABCDEF1!", "Abcdefg!", "Abcdef12", "Abcdef1 ", "Ab1!"+"a".repeat(125)])("rejects passwords missing a required rule", password => {
  expect(accountPasswordSchema.safeParse(password).success).toBe(false);
  expect(validateAdminPassword(password).valid).toBe(false);
});
it("does not apply the new creation policy to existing sign-in passwords", () => {
  expect(loginBodySchema.safeParse({email:"test@example.test",password:"legacy",remember_session:false}).success).toBe(true);
});
