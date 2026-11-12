# Spellplane — notes for agents

A browser trading-card table (Magic: The Gathering), peer-to-peer, static site, no rules enforcement.
What to build: `docs/DESIGN.md`. Order, packages, acceptance tests, gates: `docs/PLAN.md`. Decisions beyond the design: `docs/DECISIONS.md` (append one line per decision: `- [M<n>-P<k>] decision — reason`).

## Commands

- `pnpm check` — tsc, svelte-check, eslint (incl. module boundaries), vitest run. Must be green before you hand anything back.
- `pnpm e2e` — Playwright on Chromium and WebKit against a test build (`dist-test/`, served on a port derived from the worktree path). Excludes `@network` and `@gate` tests.
- `pnpm e2e:gate -- M<n>` — runs `tests/e2e/m<n>.gate.spec.ts`; `pnpm shots -- M<n>` also writes screenshots to `artifacts/shots/M<n>/`.
- Playwright runs only through these pnpm scripts (the config refuses a bare `playwright test`). `scripts/pw-guard.mjs` allows at most four runs per machine and one per worktree, so a run may first print `[pw-guard] … waiting`: give e2e commands a long timeout (10 min) or run them in the background, and do not start a second one in the same worktree meanwhile. Exit code 3 means macOS showed a security/keychain prompt and the run was aborted; never store or post a `CryptoKey` object (store JWK), and report the prompt instead of retrying in a loop. Exit code 4 means the machine ran short of memory and 5 that its load average stayed far too high; while the load is high the guard waits before starting.
- In a git worktree, run `pnpm install --frozen-lockfile` first. Each worktree gets its own e2e port; set `PW_PORT` only if it collides.

## Hard rules

- Static site only: no backend, serverless function, TURN server, accounts or analytics.
- No rules enforcement. No bundled card data, card images, Wizards logos or official card back in the app (test fixtures under `tests/fixtures/` are fine).
- Card faces are never recoloured, cropped or distorted.
- Hidden information never leaves its owner's browser except through the design's reveal paths. Any code touching hidden information adds its scenario to the shared leak test.
- Tests never use the network. Card data comes from `tests/fixtures/`; card faces from `?faces=placeholder`.
- `core/` is pure: no DOM, clock, randomness, network, Three.js or Svelte. The reducer is deterministic and total.
- No `any` in `core/`, `net/`, `draft/`. TypeScript strict.
- Module direction (lint-enforced in `eslint.config.js`): ui → scene → core; net, store, data, draft, games → core; util is importable by all. Do not loosen the boundary rules to make an import pass; ask the integrator via your return value.
- Do not edit contract files (`*/types.ts`, `core/actions.ts`, `net/messages.ts`) outside a contracts package; report a needed change instead.
- A flaky test is a failing test. Never add retries to get green.
- Never force-push; never rewrite pushed history; never touch another repository.

## Test harnesses

- URL flags (`src/util/flags.ts`): `?profile=a` (namespaced IndexedDB/caches), `?transport=local` (BroadcastChannel), `?faces=placeholder`, `?speech=fake`.
- Module test pages (dev/test builds): `?harness=scene` or `?harness=ui` mounts `src/<name>/harness.ts` (`mount(target)`) instead of the app (`src/main.ts`).
- `window.__spellplane` debug hook (dev/test builds): modules register their part with `registerDebug()` from `src/util/debug.ts`. Playwright helpers in `tests/e2e/helpers/app.ts` (`openApp`, `hook`, `shot`).
- `LoopbackNetwork` (`src/net/loopback.ts`): N in-process transports with seeded delay, drop, reordering and `kill`/`revive`; use Vitest fake timers.
- Fixtures: `tests/fixtures/README.md`.

## Conventions

- English everywhere. Conventional commit messages. Units in table space are millimetres (see DESIGN "Specification: geometry, layout and motion").
- Engine behaviour is asserted on state hashes and the debug hook, never on pixels. Screenshots are evidence, not baselines.
- `TableState`, `SecretStore` and every `Action` are plain JSON (rules at the top of `src/core/types.ts`); hash with `stateHash`/`canonicalJson` from `src/core/hash.ts`. Zone ids are `<kind>:<seatId>` or `<kind>` (`src/core/ids.ts`).
- The HUD and scene dispatch `ActionDraft`s; the session stamps `by`, `cid` and `seq`. A gesture over a selection dispatches one action per card with a shared `group` (undone as one step).
