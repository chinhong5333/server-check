# Implementation Plan — Server Check UI Asset Revamp

## Overview

Server Check is an internal monitoring admin panel (React + Vite client, plain CSS design tokens in `tokens.css` and `src/client/styles.css`). This plan covers the approved **visual asset revamp**: the page layouts stay exactly as they are, while the visual assets change to match the approved Design canvas mockup ("Server Check UI Revamp", Proposal 02 + Dark Mode row).

Approved direction:

- Light enterprise canvas (`#F3F5F9`) with a deep navy sidebar; dark variant keeps the same assets on navy-black surfaces.
- Typeface: Plus Jakarta Sans for UI and numbers; IBM Plex Mono only for identifiers (server names in chips, versions, URLs, code).
- Solid filled Critical / Warning badges with icons; soft tinted Healthy / idle badges.
- Status-tinted icon tiles (agent rows, project cards, stat cells, health checks, incidents).
- Pill (segmented) tabs and filters; elevated white cards with soft shadows; 8 px resource meters that turn amber at 70% and red at 90%.
- Per-metric chart series colors (RAM blue, Storage violet, Load teal, Latency amber).
- Segmented Light / Dark / System theme control in the sidebar.

## Implementation Plan

1. Fonts — add `@fontsource/plus-jakarta-sans` and `@fontsource/ibm-plex-mono`; switch imports in `src/client/main.tsx`.
2. Tokens — rewrite the palette, font, radius and shadow tokens in `tokens.css` (light + dark); add fill/line/sidebar/series tokens; add `--color-accent-text` for readable accent text in both themes.
3. Base CSS — point text uses of the accent at `--color-accent-text`, drop the dot-grid canvas, append a documented "Asset Revamp" layer to `styles.css` covering shell, buttons, badges, cards, tabs, roster, project cards, agent detail, charts, history, notification bar.
4. Markup assets (no layout moves):
   - `AppShell`: brand mark tile, project initials tile + agent count, account initials avatar.
   - `ThemeToggle`: segmented Light / Dark / System control.
   - `ProjectsPage` / `InstallAgentPage`: breadcrumb above the title.
   - `ProjectCard`: status top bar + stacked agent health bar with legend.
   - Agent roster row: status icon tile, live heartbeat dot.
   - `AgentDetailPage`: status icon tile beside the title; chart series modifier classes.
   - `AgentHealthChecks`, `AgentIncidentHistory`: icon tiles.
   - `TradingViewMetricChart`: read `--chart-series` for the line color.
5. Tests — update the focused unit tests for changed markup (theme toggle, etc.); run only the affected files (≤10 cases per AGENTS.md).
6. Verification — typecheck/build, then a mocked-API HTML preview under `output/` checked at desktop and mobile widths in light and dark.

## Progress

- [x] Mockup approved by the user (Design canvas, 2026-10-13).
- [x] 1 Fonts · 2 Tokens · 3 Base CSS + revamp layer · 4 Markup assets · 5 Focused tests · 6 Typecheck, build and preview verification.
- Challenges:
  - CRLF line endings introduced by Python edits; normalized back to LF.
  - The avatar selector lost a specificity clash with the footer `span` rule; fixed.
  - The chart line colour was hard-wired to the accent token and now reads `--chart-series`.
- Known issue that predates this work: `agent-detail-page.test.tsx:188` expects state-definition text that is no longer in source.

## Conclusion

The approved asset revamp is implemented:
- **Layout:** every page keeps its existing structure and breakpoints.
- **What changed:** tokens, typography, badges, icon tiles, controls, meters and surfaces, in light and dark.
- **Preview:** `output/asset-revamp-preview.html` previews the real app with synthetic data at any theme and width.

Recommendations:
- Restyle the login wordmark with the brand-mark tile.
- Fix the outdated assertion in `agent-detail-page.test.tsx`.
- Run the full suite once before release, with approval.
