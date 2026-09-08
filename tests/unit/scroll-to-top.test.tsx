// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScrollToTop } from "../../src/client/components/ScrollToTop";

function Navigation() {
  const navigate = useNavigate();
  return <>
    <ScrollToTop />
    <button onClick={() => navigate("/settings")}>Setting</button>
    <button onClick={() => navigate(-1)}>Back</button>
    <button onClick={() => navigate("#main-content")}>Skip To Content</button>
  </>;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("page navigation scroll", () => {
  it("resets initial entry, new routes, repeated route clicks, and back navigation", () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<MemoryRouter initialEntries={["/projects"]}><Navigation /></MemoryRouter>);
    expect(scroll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Setting"));
    fireEvent.click(screen.getByText("Setting"));
    fireEvent.click(screen.getByText("Back"));
    expect(scroll).toHaveBeenCalledTimes(4);
    expect(scroll).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: "instant" });
  });

  it("does not reset on rerender or override an accessibility anchor", () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const view = render(<MemoryRouter><Navigation /></MemoryRouter>);
    scroll.mockClear();
    view.rerender(<MemoryRouter><Navigation /></MemoryRouter>);
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Skip To Content"));
    expect(scroll).not.toHaveBeenCalled();
  });

  it("disables browser restoration while mounted and restores it on cleanup", () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    window.history.scrollRestoration = "auto";
    const view = render(<MemoryRouter><ScrollToTop /></MemoryRouter>);
    expect(window.history.scrollRestoration).toBe("manual");
    view.unmount();
    expect(window.history.scrollRestoration).toBe("auto");
  });
});
