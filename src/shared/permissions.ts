import { z } from "zod";

export const PERMISSIONS = [
  { key: "view_projects", label: "View All Projects & Agents" },
  { key: "edit_global_settings", label: "Manage Global Settings" },
  { key: "edit_project_settings", label: "Create & Edit Projects" },
  { key: "edit_agent_settings", label: "Register & Edit Agents" },
  { key: "delete_projects", label: "Delete Projects" },
  { key: "delete_agents", label: "Delete Agents" },
  { key: "rotate_agent_secrets", label: "Rotate Agent Secrets" }
] as const;
export const permissionSchema = z.enum(["view_projects", "edit_global_settings", "edit_project_settings", "edit_agent_settings", "delete_projects", "delete_agents", "rotate_agent_secrets"]);
export type Permission = z.infer<typeof permissionSchema>;
export const permissionsSchema = z.array(permissionSchema).max(PERMISSIONS.length)
  .refine(values => new Set(values).size === values.length, "Permissions must be unique.")
  .refine(values => values.every(value => ["view_projects", "edit_global_settings"].includes(value)) || values.includes("view_projects"),
    "View All Projects & Agents is required for project and agent actions.");

/** Fail closed for missing or malformed persisted permissions. Existing admins keep full access. */
export function readPermissions(value: unknown): Permission[] {
  try { return permissionsSchema.parse(typeof value === "string" ? JSON.parse(value) : value); } catch { return []; }
}
export function hasPermission(user: { role: string; permissions?: readonly Permission[] } | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role === "operator") return permission === "view_projects";
  return user.role === "sub_admin" && (user.permissions?.includes(permission) ?? false);
}
