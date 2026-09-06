// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectOverviewRedirect } from "../../src/client/App";

afterEach(cleanup);

describe("merged project overview route", () => {
  it("redirects the former Agents page to the owning project Overview", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/project-1/agents"]}>
        <Routes>
          <Route path="/projects/:projectId/agents" element={<ProjectOverviewRedirect />} />
          <Route path="/projects/:projectId" element={<p>Merged overview</p>} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Merged overview")).toBeInTheDocument();
  });

  it("redirects the former project Incidents page to the owning project Overview", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/project-1/incidents"]}>
        <Routes>
          <Route path="/projects/:projectId/incidents" element={<ProjectOverviewRedirect />} />
          <Route path="/projects/:projectId" element={<p>Merged overview</p>} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Merged overview")).toBeInTheDocument();
  });
});
