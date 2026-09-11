# Project Development Instructions

These instructions apply to all work inside this repository and supplement higher-level safety and platform instructions.

## Fast Verification

- After completing a requested change, run only the smallest test set directly related to the changed behavior.
- Focused verification is limited to **10 individual test cases maximum per requested amendment**, not 10 files or 10 cases per command. Do not split runs into batches to bypass this limit.
- Prioritize cases by direct relevance and risk: the requested behavior first, then security/authorization, data integrity, critical failure paths, and closely related regressions. Skip lower-priority or unrelated cases.
- Check the selected case count before running. Use explicit file paths and Vitest `-t` name filters when a file contains more cases than the remaining allowance. Each parameterized case counts separately; reruns also count toward the limit.
- If adequate verification requires more than 10 cases, explain why and ask for explicit approval before exceeding the limit. Report the selected cases and any important coverage left unrun.
- Use explicit Vitest file paths, for example: `npx vitest run tests/unit/projects-page.test.tsx`.
- Do not use `npm run test:unit -- <file>` for targeted verification because this project's script can still run the complete unit suite.
- Do not automatically run `npm test`, `npm run test:unit`, or any other command that executes the complete test suite.
- If a change affects shared infrastructure or is risky enough to justify the full suite, explain why and ask the user for approval before running it.
- Run the full suite immediately only when the user explicitly requests it in the current turn.
- Keep type checking, builds, runtime probes, and other verification proportionate to the files and behavior changed.
- Report exactly which targeted tests were run and clearly state when the full suite was not run.

## Development Pace

- Prefer focused code discovery over repository-wide inspection when the relevant file, component, route, or error is already known.
- Make surgical changes and avoid unrelated refactors, formatting, or cleanup.
- Stop once the requested behavior and its focused verification are complete unless additional work is required for correctness or safety.
- For a small, well-scoped request, perform only the minimum discovery needed and begin the implementation immediately.
- Complete the requested behavior and its targeted verification before doing documentation maintenance.
- If a targeted test or verification command has not completed within 30 seconds, immediately tell the user what is still running and check whether it is progressing or actually hung.
- Never describe a test as hung unless its process state or repeated lack of progress confirms that diagnosis.
- Keep progress updates short and do not leave the user waiting silently during implementation or verification.

## Preserve UI Design Intent

- Treat an existing designed screen as an established product artifact. Fix the reported defect while preserving its visual identity, content hierarchy, brand character, and useful composition.
- Do not replace a styled or multi-region screen with a generic centered card, stripped-down form, or template layout unless the user explicitly requests simplification or a full redesign.
- Before changing layout direction, identify which existing visual qualities should remain and which specific defects need correction. Keep the amendment proportional to those defects.
- For UI changes, verify the real rendered result at representative desktop and mobile widths. Semantic markup and unit tests alone are not sufficient visual verification.
- Compare the result with the prior screen or supplied screenshot before handoff. If the page lost identity, hierarchy, or useful context, revise it before reporting completion.

## Admin UI Wording

- Use Title Case for every visible page title, section heading, modal title, chart title, tab title, summary header, fieldset legend, and table column header in the admin panel, for example `All Projects`, `Operations Overview`, `Server State`, and `Last Heartbeat`.
- Use Title Case for every standalone interface label: page and section headings, form labels, buttons, links, tooltips, accessible control names, metric labels, status badges, tabs, table headers, and collection/section counts. Examples include `Copy Raw Log`, `Create Project`, `Server Name`, `Total Agents`, `No Agents`, and `Awaiting Data`.
- Keep only complete descriptive sentences, toast messages written as sentences, validation messages, helper copy, and raw API-provided diagnostic values in sentence case unless the user explicitly requests otherwise.
- When changing a heading, update its accessible name, responsive `data-label`, and focused UI test expectation in the same amendment.

## UI/UX Pro Max Runtime

- Run the UI/UX Pro Max search tool with `python`; Codex's bundled Python 3.12 runtime is configured ahead of the broken Microsoft Store launcher.
- If command lookup is unavailable in a newly provisioned environment, invoke `C:\Users\Zetta\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe` directly with `C:\Users\Zetta\.codex\skills\ui-ux-pro-max\scripts\search.py`.
