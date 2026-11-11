# Execution prompt

Paste this into Claude Code in the repository root. It runs all milestones unattended in one go. Paste it again only if the session ends early, or with playtest feedback above it.

```text
Implement Spellplane by executing its implementation plan. Run the bootstrap and all six milestones (B0, then M0 to M5) continuously in this one session, unattended, without waiting for me between milestones. The prompt is also resumable: if the session ends for any reason, I paste it again and you continue from the first unticked item.

SOURCES OF TRUTH
- docs/DESIGN.md (what to build) and docs/PLAN.md (order, packages, acceptance tests, gates) in this repository. The repo copies win.
- If either file is missing, export both as Markdown through the Claude Docs connector from
  https://claude.ai/artifact/2zC6USXNUoSeHKvYDQYS8A (design) and
  https://claude.ai/artifact/B47rkXo5Wsv5iUJuEtMyDG (plan),
  save them under docs/, and commit. If you cannot read them, stop and tell me.

STANDING AUTHORISATIONS (they hold for every run of this prompt)
- Use a workflow: orchestrate each milestone with one multi-agent workflow of up to about 50 agents, as described in the plan's "Agent orchestration" section. Use subagents in isolated git worktrees for parallel packages.
- Git and deploy: the remote is git@github.com:izzardry/spellplane.git (public, MIT). You may commit, create and push branches, merge milestone branches into main, enable and deploy GitHub Pages, and run CI, all without asking. Never force-push, never rewrite pushed history, never touch any other repository.
- Dependencies: install what the plan names. If another runtime dependency is clearly needed, add it and record why in docs/DECISIONS.md.
- Unattended: I am away. Never wait for my input, never ask me a question, never stop for confirmation. Every decision is yours; record it.

HARD CONSTRAINTS
- Static site only: no backend, no serverless function, no TURN server, no accounts, no analytics.
- No rules enforcement in the game. No bundled card data, card images, Wizards logos or official card back.
- Card faces are never recoloured, cropped or distorted.
- Hidden information never leaves its owner's browser except through the reveal paths in the design. The leak tests are not optional.
- Tests never use the network.

PROCEDURE FOR EACH RUN
1. Read docs/PLAN.md and docs/DECISIONS.md. Find the first unticked item.
   - If bootstrap B0 is unfinished, do it yourself inline, then continue.
   - If I gave playtest feedback in this message, turn it into fix tasks, do them first (inline or with a few subagents), and record them in the previous gate report.
   - If the next milestone has a spike or check that needs a second machine or a human (for example the real-network connectivity test), skip it and list it under "Owner checks" in that milestone's gate report.
2. Run the milestone workflow on branch m<n>:
   a. Contracts agent lands the M<n>-C types and stubs and commits them.
   b. Each package runs as an independent pipeline in its own worktree (branch m<n>/<package>): implement with its acceptance tests until `pnpm check` is green; then a reviewer that sees only the diff and the named design sections returns structured findings; a fixer resolves blocking findings; repeat review at most 3 times. core/, net/, draft/ and any secrecy code get a second reviewer focused on determinism and hidden-information leaks. A package that does not converge is parked with a written note, not merged.
   c. Packages that depend on another package of the same milestone start after that package is merged.
   d. An integrator merges finished packages one at a time in dependency order, running `pnpm check` and `pnpm e2e` after each merge, and parks any package that breaks the branch.
   e. A gate verifier runs `pnpm e2e:gate -- M<n>`, captures the screenshot matrix, judges it against the design, files findings, gets them fixed in one round, and reruns the gate.
   Give every agent its package id, the exact sections to read, the files it owns, the commands that must pass and a return schema. Do not paste the documents into prompts. Log anything the workflow skips or truncates.
3. When the workflow returns, read its result. Retry each parked package once yourself with full context.
4. Tick the finished items in docs/PLAN.md, append agent decisions to docs/DECISIONS.md, write docs/gates/M<n>.md (live URL, commit, test counts, screenshot review, decisions made beyond the design, parked packages, my playtest checklist), merge m<n> into main, push, and confirm the Pages deploy is live and CI is green.
5. Go straight back to step 1 for the next milestone. Do not pause for a playtest; owner playtests are deferred and listed in each gate report.
   - If a gate is still failing after its fix round and your own retry, record exactly what fails in the gate report, leave the affected items unticked, and continue with the next milestone on a best-effort basis.
   - If a blocker makes a whole milestone impossible (for example credentials or the remote are unavailable), keep working locally on everything that does not need it and record the blocker.
6. When M5 is done, or nothing further can be done, write docs/gates/SUMMARY.md and tell me in a few lines: the live URL, what is finished per milestone, what is parked or failing, the owner checks and playtests waiting for me, and the decisions you made that I should review.

QUALITY BAR
- A package is done only as the plan's "Definition of done" says. Passing tests that do not test the design's behaviour do not count.
- When the design does not specify something, choose the simplest behaviour consistent with it, write one line in docs/DECISIONS.md, and move on. Where a choice would contradict the design, follow the design; where it cannot be undone, take the reversible alternative and flag it in the gate report.
- Report failures plainly. Never mark a gate green that is not.

Start now with step 1.
```
