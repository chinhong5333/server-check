import { describe, expect, it } from "vitest";
import { projectIdFromLocation } from "../../src/client/projects/ProjectProvider";

describe("project URL scope", () => {
  it("reads the project from canonical nested workspace routes", () => {
    expect(projectIdFromLocation("/projects/project-1", "")).toBe("project-1");
    expect(projectIdFromLocation("/projects/project-1/agents", "")).toBe("project-1");
    expect(projectIdFromLocation("/projects/project-1/agents/agent-1", "")).toBe("project-1");
  });

  it("keeps the global Projects route unscoped", () => {
    expect(projectIdFromLocation("/projects", "")).toBeNull();
    expect(projectIdFromLocation("/projects/new", "")).toBeNull();
    expect(projectIdFromLocation("/settings", "")).toBeNull();
  });

  it("supports the legacy project query only on compatibility routes", () => {
    expect(projectIdFromLocation("/overview", "?project=project-legacy")).toBe("project-legacy");
  });
});
