---
name: frontend-start
description: Use whenever starting to build, design, scaffold, or redesign an app frontend, website, landing page, dashboard, screen, or user-facing feature. Also use for requests to build an app when UI is included. Not for backend-only work or a tiny isolated UI correction.
---

# Frontend Start

Start frontend work with a deliberate visual direction and an evidence-based delivery plan. Follow the host's instructions, approvals, and repository conventions; this skill routes work rather than replacing them.

## 1. Establish the actual surface

Inspect the repository with filesystem/code tools: existing UI, package versions, components, routes, instructions, and product/design documents. Context7 supplies external library documentation, not local repository inspection.

Record the audience, primary task, requested scope, existing stack, and visual authority. Preserve the installed framework, component family, brand, and behavior for an extension; an explicit redesign may replace visual direction. Ask only for material information unavailable from the project or request. Do not invent business claims, app features, or a framework to fill a vague brief.

For backend-only tasks, stop this workflow. For an isolated UI correction, make the targeted change and targeted verification without project-wide initialization or redesign.

## 2. Choose one direction

Load **impeccable** as the primary design skill and follow its applicable context and design workflow. If unavailable, state that once and apply the brief directly; never claim the skill ran.

For a new visual identity, compare distinct compositions before implementation and commit to one through the host's approval process. For an approved existing identity, extend it instead of reopening art direction. Reuse or record the chosen typography, semantic colors, spacing, surfaces, and motion rules in the project's established design documentation. Use real content and relevant, licensed imagery; identify any provisional content.

## 3. Route only the relevant specialists

Load installed skills by name through the current agent's supported mechanism. Discover actual tool names and connections before calling MCP tools.

| Condition | Skill or tool |
|---|---|
| Typography or component-detail decisions | **better-typography**, **better-ui**, scoped to those decisions; Impeccable remains the design authority. |
| React project | **vercel-react-best-practices**, **vercel-composition-patterns**. Skip both for Vue, Svelte, native, and other stacks. |
| Library/API uncertainty | **Context7**, matching installed versions. |
| shadcn-compatible project needs a component | **shadcn MCP** and the project's configured registries. Reuse existing primitives first. |
| Animation work | **motion**; use the platform-appropriate API and reduced-motion behavior. Motion is optional, purposeful, and not a requirement to decorate every element. |
| Interface review | **web-design-guidelines**. |
| Runtime, network, or rendering diagnosis | **Chrome DevTools MCP**, when needed. |
| Human visual annotations | **Agentation**. Confirm the app's development-only toolbar and matching local endpoint; a global MCP registration alone does not install the toolbar. |

Use one available browser driver for ordinary interaction and screenshots; reuse a host-provided browser or Playwright instead of launching competing controllers. Use Figma, reference libraries, or asset services only when available and relevant. Paid access, tool installation, and publication are not implied by this skill.

## 4. Build and prove the requested experience

Implement the scoped UI and its relevant loading, empty, error, disabled, focus, overflow, and mobile states. Preserve keyboard access, meaningful semantics, contrast, and reduced motion. Resolve visual feedback in a bounded critique/fix pass.

Run the actual app. Exercise changed interactions and inspect desktop/mobile rendering with the available browser, including screenshots when permitted. Run relevant existing checks; use performance/accessibility diagnostics where warranted. A component catalog or successful build is not visual proof.

If browser tooling is unavailable or visual inspection is declined, perform reachable runtime/checks and explicitly report the unverified visual surface. Never fabricate screenshots, tool availability, test results, or accessibility compliance.

Deliver the implemented scope, selected direction, exercised verification, and concrete limitations. Keep development feedback tooling out of production, and obtain human approval before changing visual-test baselines or publishing.
