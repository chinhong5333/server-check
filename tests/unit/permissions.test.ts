import { describe, expect, it } from "vitest";
import { hasPermission, PERMISSIONS, permissionsSchema, readPermissions } from "../../src/shared/permissions";
describe("team permissions", () => {
  it.each(PERMISSIONS)("preserves full-admin access and denies ungranted $key", ({key}) => {
    expect(hasPermission({role:"admin"},key)).toBe(true);
    expect(hasPermission({role:"sub_admin",permissions:[]},key)).toBe(false);
    expect(hasPermission({role:"sub_admin",permissions:[key]},key)).toBe(true);
    expect(hasPermission(null,key)).toBe(false);
  });
  it("does not combine edit, delete, and secret privileges", () => {
    const user = { role:"sub_admin", permissions:permissionsSchema.parse(["view_projects","edit_agent_settings","edit_project_settings"]) };
    expect(hasPermission(user,"delete_agents")).toBe(false);
    expect(hasPermission(user,"delete_projects")).toBe(false);
    expect(hasPermission(user,"rotate_agent_secrets")).toBe(false);
  });
  it("rejects unknown, duplicate, and invalid dependent grants", () => {
    for (const value of ['["superuser"]','not-json',null,'["delete_agents"]','["view_projects","view_projects"]']) expect(readPermissions(value)).toEqual([]);
    expect(readPermissions('["view_projects","delete_agents"]')).toEqual(["view_projects","delete_agents"]);
  });
});
