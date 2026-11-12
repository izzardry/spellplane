export const meta = {
  name: 'spellplane-milestone',
  description: 'One Spellplane milestone: contracts, parallel package pipelines with adversarial review and fix loops, sequential integration, gate verification',
  phases: [
    { title: 'Contracts', detail: 'shared types and compiling stubs on the milestone branch' },
    { title: 'Packages', detail: 'implement, review, fix (3 rounds max) in worktrees' },
    { title: 'Integrate', detail: 'merge one package at a time, full suite after each' },
    { title: 'Gate', detail: 'gate spec, screenshot review, one fix round, rerun' },
  ],
}

// ---------------------------------------------------------------------------
// args: { milestone:'M0', branch:'m0', repo, wtRoot, contracts?:{brief, sections}, packages:[...], gate:{brief, sections} }
// package: { id:'M0-P1', slug:'m0-p1', name, owns:[...], tests:[...], sections:[...], brief, deep:boolean, deps:[ids], e2e:boolean,
//            maxRounds?, reviewFocus?, resume? (skip the implementer; review the existing branch) }
// ---------------------------------------------------------------------------
const A = args
const M = A.milestone
const BR = A.branch
const REPO = A.repo
const WT = A.wtRoot

const COMMON = [
  `Project: Spellplane, repository ${REPO} (CLAUDE.md there has the commands, hard rules and harnesses — follow it).`,
  `Milestone ${M}. Sources of truth: docs/DESIGN.md (what to build) and docs/PLAN.md (packages, acceptance tests, gates). Read the sections named below yourself with the Read tool (use grep -n '^## ' to find them); they are not pasted here.`,
  `This is an unattended overnight run: never ask questions or wait for input. When the design is silent, choose the simplest behaviour consistent with it and report the decision in your return value.`,
  `Never force-push, never rewrite pushed history, never touch another repository, never use the network in tests.`,
  `Playwright runs are limited to four per machine and one per worktree (scripts/pw-guard.mjs, see CLAUDE.md): give pnpm e2e / e2e:gate / shots a 10-minute Bash timeout, never start two at once in one worktree, and if one exits with code 3 (macOS security or privacy prompt) or 4 (machine short of memory) report it instead of retrying.`,
].join('\n')

const secList = (s) => s.map((x) => `"${x}"`).join(', ')

const DECISIONS = { type: 'array', items: { type: 'string' }, description: 'One line each: "[pkg] decision — reason"' }

const CONTRACTS_SCHEMA = {
  type: 'object',
  properties: {
    committed: { type: 'boolean' },
    commit: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    check_green: { type: 'boolean' },
    summary: { type: 'string' },
    decisions: DECISIONS,
  },
  required: ['committed', 'check_green', 'summary', 'decisions'],
}

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['green', 'blocked'] },
    worktree: { type: 'string' },
    branch: { type: 'string' },
    commit: { type: 'string' },
    check_green: { type: 'boolean' },
    e2e_green: { type: 'boolean', description: 'true if pnpm e2e passed (or package has no browser tests and you ran it anyway)' },
    tests_added: { type: 'number' },
    acceptance: { type: 'array', items: { type: 'object', properties: { test: { type: 'string' }, file: { type: 'string' }, passing: { type: 'boolean' } }, required: ['test', 'passing'] } },
    contract_changes: { type: 'array', items: { type: 'string' }, description: 'Additive changes made to contract files, if any' },
    decisions: DECISIONS,
    blocked_reason: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['status', 'check_green', 'summary', 'decisions'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocking', 'minor'] },
          file: { type: 'string' },
          line: { type: 'number' },
          issue: { type: 'string' },
          design_ref: { type: 'string' },
          suggested_fix: { type: 'string' },
        },
        required: ['severity', 'issue'],
      },
    },
    verdict: { type: 'string', enum: ['approve', 'changes_required'] },
  },
  required: ['findings', 'verdict'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'string' } },
    not_fixed: { type: 'array', items: { type: 'string' } },
    check_green: { type: 'boolean' },
    e2e_green: { type: 'boolean' },
    commit: { type: 'string' },
    decisions: DECISIONS,
  },
  required: ['fixed', 'not_fixed', 'check_green', 'decisions'],
}

const INTEGRATE_SCHEMA = {
  type: 'object',
  properties: {
    merged: { type: 'boolean' },
    parked: { type: 'boolean' },
    parked_note: { type: 'string', description: 'path of docs/gates/<M>-parked-<pkg>.md if parked' },
    reason: { type: 'string' },
    check_green: { type: 'boolean' },
    e2e_green: { type: 'boolean' },
    unit_tests: { type: 'number' },
    e2e_tests: { type: 'number' },
    commit: { type: 'string' },
    pushed: { type: 'boolean' },
    integration_fixes: { type: 'array', items: { type: 'string' } },
  },
  required: ['merged', 'parked', 'check_green'],
}

const GATE_SCHEMA = {
  type: 'object',
  properties: {
    gate_green: { type: 'boolean' },
    gate_spec: { type: 'string' },
    passed: { type: 'number' },
    failed: { type: 'number' },
    failures: { type: 'array', items: { type: 'string' } },
    screenshots: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, verdict: { type: 'string' } }, required: ['file', 'verdict'] } },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { severity: { type: 'string', enum: ['blocking', 'minor'] }, area: { type: 'string' }, issue: { type: 'string' }, design_ref: { type: 'string' } },
        required: ['severity', 'issue'],
      },
    },
    check_green: { type: 'boolean' },
    e2e_green: { type: 'boolean' },
    unit_tests: { type: 'number' },
    e2e_tests: { type: 'number' },
    commit: { type: 'string' },
    decisions: DECISIONS,
    summary: { type: 'string' },
  },
  required: ['gate_green', 'failures', 'findings', 'summary'],
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------
let contracts = null
if (A.contracts) {
  phase('Contracts')
  contracts = await agent(
    [
      COMMON,
      ``,
      `ROLE: contracts agent for ${M}-C. You work directly in ${REPO} on branch ${BR} (already checked out; verify with git branch --show-current).`,
      `Read: docs/PLAN.md rows for ${M}-C and every ${M} package, plus the later milestones' package rows so the types will not need breaking changes later. Design sections: ${secList(A.contracts.sections)}.`,
      ``,
      A.contracts.brief,
      ``,
      `Rules: contracts are shared types, interfaces, constants and compiling stubs (stub functions may throw new Error('not implemented: <pkg>') or return trivial values, and must name the package that implements them). Document every exported type with a one-line comment that cites the design section. Keep the B0 smoke e2e test passing.`,
      `Finish: pnpm check green and pnpm e2e green; commit on ${BR} with message "${A.contracts.message || `feat(${M.toLowerCase()}-c): contracts`}" (plus the Co-Authored-By trailer: "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"); git push origin ${BR}. Return the schema.`,
    ].join('\n'),
    { label: `contracts:${M}`, phase: 'Contracts', schema: CONTRACTS_SCHEMA },
  )
  if (!contracts || !contracts.committed) {
    log(`Contracts for ${M} failed: ${contracts ? contracts.summary : 'agent died'}. Packages will still try against whatever is on ${BR}.`)
  }
}

// ---------------------------------------------------------------------------
// Integration chain: one merge at a time into BR, in the order packages finish.
// ---------------------------------------------------------------------------
const mergedResolvers = {}
const mergedPromises = {}
for (const p of A.packages) mergedPromises[p.id] = new Promise((r) => (mergedResolvers[p.id] = r))
let chain = Promise.resolve()

function integrate(pkg, outcome) {
  const run = chain.then(() =>
    agent(
      [
        COMMON,
        ``,
        `ROLE: integrator for package ${pkg.id} (${pkg.name}). You work in ${REPO} on branch ${BR} (verify it is checked out; never switch the main checkout to another branch).`,
        outcome.park
          ? [
              `This package is PARKED, not merged. Reason from its pipeline: ${outcome.reason}`,
              `Write docs/gates/${M}-parked-${pkg.slug}.md on ${BR}: what the package was supposed to do (cite its docs/PLAN.md row), what fails and why (inspect branch ${pkg.slug} in worktree ${WT}/${pkg.slug} if it exists: git log, git diff ${BR}...${pkg.slug} --stat, run its tests if useful), the open review findings below, and what a retry should do first. Commit it ("docs(${M.toLowerCase()}): park ${pkg.id}") and push ${BR}.`,
              `Open findings: ${JSON.stringify(outcome.findings || []).slice(0, 6000)}`,
              `Return merged=false, parked=true.`,
            ].join('\n')
          : [
              `Merge branch ${pkg.slug} into ${BR}: git merge --no-ff ${pkg.slug} -m "merge(${M.toLowerCase()}): ${pkg.id} ${pkg.name}". Resolve conflicts by keeping both sides' intent; contract files take the union of additive changes.`,
              `In the same merge commit (amend the merge commit before pushing), also: tick "- [ ] ${pkg.id} " in the Progress list of docs/PLAN.md, and append these decision lines under the "## ${M} " section of docs/DECISIONS.md (create the section if missing): ${JSON.stringify(outcome.decisions || [])}`,
              `Then run pnpm install --frozen-lockfile (if the lockfile changed), pnpm check, and pnpm e2e. If something fails because packages meet for the first time (wiring, a renamed export, a test that assumed a stub), fix it with the smallest change, add a test if behaviour changed, and commit "fix(${M.toLowerCase()}): integrate ${pkg.id}". You may spend real effort here, but do not rewrite the package.`,
              `If the branch cannot be made green without rewriting the package, undo the merge (it is not pushed yet: git reset --hard ORIG_HEAD or to the pre-merge commit), write docs/gates/${M}-parked-${pkg.slug}.md explaining exactly what breaks, commit it, and return merged=false, parked=true.`,
              `When green: git push origin ${BR}. Report unit and e2e test counts from the runs.`,
            ].join('\n'),
        `Return the schema.`,
      ].join('\n'),
      { label: `integrate:${pkg.id}`, phase: 'Integrate', schema: INTEGRATE_SCHEMA },
    ),
  )
  chain = run.catch(() => null)
  return run.then(
    (res) => {
      mergedResolvers[pkg.id](!!(res && res.merged))
      return res
    },
    (e) => {
      mergedResolvers[pkg.id](false)
      return null
    },
  )
}

// ---------------------------------------------------------------------------
// Package pipeline
// ---------------------------------------------------------------------------
function implPrompt(pkg) {
  return [
    COMMON,
    ``,
    `ROLE: implementer of package ${pkg.id} — ${pkg.name}.`,
    `Setup: create your own worktree from the current ${BR}: git -C ${REPO} worktree add ${WT}/${pkg.slug} -b ${pkg.slug} ${BR}  (if the branch or worktree already exists from an earlier attempt, reuse it and continue from its state; if git reports a lock, wait a few seconds and retry). Work ONLY inside ${WT}/${pkg.slug}. Run pnpm install --frozen-lockfile --prefer-offline there first.`,
    `Read: docs/PLAN.md row and acceptance tests for ${pkg.id} (and the "Definition of done"), the contracts committed on ${BR} (git log ${BR} -5; the contract files), and design sections ${secList(pkg.sections)}.`,
    `You own: ${pkg.owns.join(', ')}. Your tests go in: ${pkg.tests.join(', ')}. Do not edit files owned by other packages. Contract files (*/types.ts, core/actions.ts, net/messages.ts) may only receive additive changes (new optional fields, new exports) when unavoidable; list each one in contract_changes.`,
    ``,
    pkg.brief,
    ``,
    `Write the package's acceptance tests from docs/PLAN.md against the DESIGN's behaviour first-class (not against your implementation's quirks), then implement until they pass. Tests that do not test the design's behaviour do not count. Cover edge cases a reviewer would probe.`,
    pkg.e2e ? `This package has browser behaviour: add focused Playwright specs and make pnpm e2e green.` : `Run pnpm e2e once at the end to make sure you did not break the app.`,
    `Done means: pnpm check green${pkg.e2e ? ' and pnpm e2e green' : ''}, committed on branch ${pkg.slug} with conventional commit messages ending in the trailer "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". Do not merge or push. If you truly cannot finish, commit what works, set status=blocked and explain.`,
    `Return the schema (acceptance: one entry per acceptance test in the plan).`,
  ].join('\n')
}

function reviewPrompt(pkg, round, focus) {
  return [
    COMMON,
    ``,
    `ROLE: ${focus === 'deep' ? 'second reviewer (determinism and hidden-information leaks)' : 'adversarial reviewer'} for package ${pkg.id} — ${pkg.name}, review round ${round}. You are READ-ONLY: do not edit, commit or stash anything.`,
    `See only the change: run git -C ${WT}/${pkg.slug} diff ${BR}...${pkg.slug} (and --stat). You may read any file and run pnpm check / vitest / pnpm e2e in ${WT}/${pkg.slug} to confirm a suspicion. Do not look for or trust the implementer's own explanations.`,
    `Judge against docs/PLAN.md (${pkg.id} row, acceptance tests, Definition of done) and design sections ${secList(pkg.sections)}.`,
    focus === 'deep'
      ? `Focus ONLY on: (1) determinism — reducer/protocol code that depends on wall clock, Math.random, object key order, Set/Map iteration order where order matters, floating-point drift across peers, non-canonical JSON for hashes, async races; (2) hidden information — any path by which a card identity, library order, hand content, nonce or salt could reach another peer, the shared state, the log, the debug hook of another page, or a store that syncs. Each concrete defect is blocking.`
      : `Hunt for: behaviour that contradicts the design; acceptance tests from the plan that are missing, hollow, or test the implementation instead of the design; real bugs (edge cases, off-by-one, state that goes stale, leaks of listeners/GPU resources); hard-rule violations (CLAUDE.md); boundary-rule evasions; files edited outside the package's ownership (${pkg.owns.join(', ')}). Style nits are minor.`,
    pkg.reviewFocus
      ? `FOCUS (overrides the hunting brief above where they conflict): ${pkg.reviewFocus}`
      : `Severity rule: mark a finding blocking only if you can demonstrate it (a failing scratch test or an exact reproduction), it contradicts an explicit design sentence or acceptance test, or it breaks a CLAUDE.md hard rule. Hardening ideas, design-interpretation questions and polish are minor; they go to the gate report.`,
    `Blocking = must be fixed before merge. Be concrete: file, line, what is wrong, which design sentence it violates, how to fix. Do not report things you have not verified. Return the schema; verdict=approve only if there are no blocking findings.`,
  ].join('\n')
}

function fixPrompt(pkg, findings, round) {
  return [
    COMMON,
    ``,
    `ROLE: fixer for package ${pkg.id} — ${pkg.name}, round ${round}. Work only in ${WT}/${pkg.slug} on branch ${pkg.slug}.`,
    `Fix every blocking finding below (and cheap minor ones). For each behavioural fix add or strengthen a test. Read design sections ${secList(pkg.sections)} where a finding cites them. If you disagree with a finding because the design says otherwise, do not change the code; put it in not_fixed with the design quote.`,
    `Findings: ${JSON.stringify(findings).slice(0, 12000)}`,
    `Finish with pnpm check green${pkg.e2e ? ' and pnpm e2e green' : ''}; commit on ${pkg.slug} (trailer "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"). Return the schema.`,
  ].join('\n')
}

async function runPackage(pkg) {
  let settled = false
  try {
    if (pkg.deps && pkg.deps.length) {
      const ok = await Promise.all(pkg.deps.map((d) => mergedPromises[d] || Promise.resolve(true)))
      if (!ok.every(Boolean)) {
        settled = true
        return { pkg: pkg.id, impl: null, rounds: 0, integration: await integrate(pkg, { park: true, reason: `dependency not merged: ${pkg.deps.join(', ')}` }) }
      }
      log(`${pkg.id}: dependencies merged, starting`)
    }
    // resume: the implementation already exists on branch pkg.slug (e.g. after a crash); go straight to review.
    const impl = pkg.resume
      ? { status: 'green', check_green: true, decisions: [], summary: `resumed from existing branch ${pkg.slug}` }
      : await agent(implPrompt(pkg), { label: `impl:${pkg.id}`, phase: 'Packages', schema: IMPL_SCHEMA })
    if (!impl || impl.status !== 'green' || !impl.check_green) {
      settled = true
      return { pkg: pkg.id, impl, rounds: 0, integration: await integrate(pkg, { park: true, reason: impl ? impl.blocked_reason || impl.summary : 'implementer died', decisions: impl ? impl.decisions : [] }) }
    }
    let decisions = [...(impl.decisions || [])]
    let open = []
    let round = 0
    let approved = false
    let lastFix = null
    const maxRounds = pkg.maxRounds || 3
    while (round < maxRounds) {
      round++
      const reviewers = [() => agent(reviewPrompt(pkg, round, 'main'), { label: `review${round}:${pkg.id}`, phase: 'Packages', schema: REVIEW_SCHEMA })]
      if (pkg.deep) reviewers.push(() => agent(reviewPrompt(pkg, round, 'deep'), { label: `review${round}-deep:${pkg.id}`, phase: 'Packages', schema: REVIEW_SCHEMA }))
      const reviews = (await parallel(reviewers)).filter(Boolean)
      open = reviews.flatMap((r) => r.findings || []).filter((f) => f.severity === 'blocking')
      const minor = reviews.flatMap((r) => r.findings || []).filter((f) => f.severity !== 'blocking')
      if (!open.length) {
        approved = true
        break
      }
      log(`${pkg.id}: review ${round} found ${open.length} blocking finding(s)`)
      lastFix = await agent(fixPrompt(pkg, [...open, ...minor.slice(0, 8)], round), { label: `fix${round}:${pkg.id}`, phase: 'Packages', schema: FIX_SCHEMA })
      if (lastFix) decisions = decisions.concat(lastFix.decisions || [])
      if (!lastFix || !lastFix.check_green) {
        open = open.concat([{ severity: 'blocking', issue: `fixer round ${round} left pnpm check red or died` }])
      }
    }
    if (!approved && round === maxRounds && lastFix && lastFix.check_green && (lastFix.not_fixed || []).length === 0) {
      // Third fix claimed everything resolved; accept without a fourth review, but say so.
      log(`${pkg.id}: accepted after third fix round without a further review`)
      approved = true
      decisions.push(`[${pkg.id}] accepted after the third fix round without a fourth review (review limit)`)
    }
    settled = true
    if (!approved) {
      return { pkg: pkg.id, impl, rounds: round, open, integration: await integrate(pkg, { park: true, reason: `did not converge after ${round} review rounds`, findings: open }) }
    }
    return { pkg: pkg.id, impl, rounds: round, integration: await integrate(pkg, { park: false, decisions }) }
  } catch (e) {
    if (!settled) mergedResolvers[pkg.id](false)
    log(`${pkg.id}: pipeline error ${String(e)}`)
    return { pkg: pkg.id, error: String(e) }
  }
}

phase('Packages')
const results = await parallel(A.packages.map((p) => () => runPackage(p)))
await chain

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------
phase('Gate')
const gatePrompt = (rerun) =>
  [
    COMMON,
    ``,
    `ROLE: gate verifier for ${M}${rerun ? ' (second and final run, after the fix round)' : ''}. Work in ${REPO} on branch ${BR} (verify). Merged packages are on ${BR}; parked packages have notes under docs/gates/.`,
    `Read: docs/PLAN.md "${M}" section (gate description, owner playtest), "Quality gates", and design sections ${secList(A.gate.sections)}.`,
    rerun
      ? `The gate spec already exists. Run pnpm shots -- ${M} (runs the gate and captures screenshots), then pnpm check and pnpm e2e. Look at every screenshot in artifacts/shots/${M}/ with the Read tool and judge it against the design again. Do not change code except trivial test-harness fixes; report what still fails.`
      : [
          A.gate.brief,
          `Write or complete tests/e2e/${M.toLowerCase()}.gate.spec.ts: the whole gate scenario from docs/PLAN.md, with "@gate" in the describe title, assertions on state hashes and the debug hook (never pixels), and screenshots of the listed set via shot(page, '${M}', name, testInfo.project.name) from tests/e2e/helpers/app.ts. Each scripted step must use the real UI path where the design defines one (keys, drags, menus), falling back to __spellplane.dispatch only for things the UI cannot reach yet — list every such fallback in failures as a gap.`,
          `Run pnpm shots -- ${M}, then pnpm check and pnpm e2e. Look at every screenshot in artifacts/shots/${M}/ with the Read tool and judge it against the design (layout, theme, legibility, the specific signal the shot is about). Fix test-harness problems yourself. Product defects go into findings (do not fix product code yourself in this run).`,
          `Commit the gate spec on ${BR} ("test(${M.toLowerCase()}): gate") and push.`,
        ].join('\n'),
    `gate_green is true only if the gate spec passes on both Chromium and WebKit, pnpm check and pnpm e2e are green, and no blocking finding remains. Never call a red gate green. Return the schema.`,
  ].join('\n')

let gate1 = await agent(gatePrompt(false), { label: `gate:${M}`, phase: 'Gate', schema: GATE_SCHEMA })
let gateFix = null
let gate2 = null
const gateFindings = gate1 ? [...(gate1.failures || []).map((f) => ({ severity: 'blocking', issue: f })), ...(gate1.findings || [])] : [{ severity: 'blocking', issue: 'gate agent died' }]
if (!gate1 || !gate1.gate_green || gateFindings.some((f) => f.severity === 'blocking')) {
  gateFix = await agent(
    [
      COMMON,
      ``,
      `ROLE: gate fixer for ${M} (the one fix round). Work in ${REPO} on branch ${BR}.`,
      `Fix the failures and blocking findings below in the product code (and the gate spec where the spec itself is wrong per docs/PLAN.md). Add or adjust tests for every behavioural fix. Read design sections ${secList(A.gate.sections)} as needed.`,
      `Findings: ${JSON.stringify(gateFindings).slice(0, 14000)}`,
      `Finish with pnpm check and pnpm e2e green and pnpm e2e:gate -- ${M} as green as you can get it; commit ("fix(${M.toLowerCase()}): gate findings", trailer "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>") and push ${BR}. Return the schema.`,
    ].join('\n'),
    { label: `gate-fix:${M}`, phase: 'Gate', schema: FIX_SCHEMA },
  )
  gate2 = await agent(gatePrompt(true), { label: `gate-rerun:${M}`, phase: 'Gate', schema: GATE_SCHEMA })
}

return {
  milestone: M,
  contracts,
  packages: results.map((r, i) => r || { pkg: A.packages[i].id, error: 'pipeline returned null' }),
  gate: { first: gate1, fix: gateFix, final: gate2 || gate1 },
}
