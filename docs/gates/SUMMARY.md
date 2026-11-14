# Spellplane: summary of the unattended build

- **Live URL:** https://izzardry.github.io/spellplane/
- **Repository:** github.com/izzardry/spellplane (public, MIT). `main` carries B0 and M0–M5. CI runs a check job plus Chromium and WebKit e2e in eight shards, and every push to `main` deploys to GitHub Pages.
- **Plan:** every item in `docs/PLAN.md` is ticked. Each milestone gate is green with its owner playtest still pending. Nothing is parked or failing.

## Milestones

| Milestone | Gate | What it delivers | Report |
| --- | --- | --- | --- |
| B0 Bootstrap | done | Vite, Svelte and three.js app, strict TypeScript, lint-enforced module boundaries, Vitest and Playwright (Chromium and WebKit), CI, Pages deploy | `docs/PLAN.md` |
| M0 Solo table | green | Goldfish table: deck import, Scryfall images, drag and snap, tap and flip, piles, counters, tokens, zoom and inspect, undo | `M0.md` |
| M1 Networked 1v1 | green | Peer-to-peer table: lobby, sequencer and hashed state, commit-reveal shuffles and dice, hidden zones, stack, holds, combat, chat, reload and away | `M1.md` |
| M2 Draft evening | green | Booster, Rochester, sealed, Winston and Grid; deck builder (table and list); the evening loop of draft, build, play and next game; deck library | `M2.md` |
| M3 Four seats and voice | green | Free-for-all for three and four players, Two-Headed Giant, spectators, WebRTC voice (push-to-talk, team talk, open mic), dictation captions | `M3.md` |
| M4 Themes and 3D | green | Paper, Dusk, Wyrm and Stonetable themes; lit pipeline; bird's-eye and ego camera rigs; signal conformance; performance budgets | `M4.md` |
| M5 Polish | green | iPad touch, automatic end-of-game audit, offline and installable app, accessibility, settings and key remapping, hardening (protocol version, soak), the owner's table and voice decisions | `M5.md` |

All gates pass on the final tree: M0 2/2, M1 4/4, M2 2/2, M3 2/2, M4 12/12, M5 12/12. CI on `m5` passed before the merge.

## How it was built

- **One workflow run per milestone.** A contracts package came first, then packages in parallel, each through implementation and up to three adversarial review-and-fix rounds. Integration followed, then a gate round (first check, fix round, final check).
- **Parked packages.** Packages that did not converge were parked and later merged by the gate fix round. The main session then had each one reviewed independently.
  - At M4 and M5 those reviews found real blocking defects every time: an M4 camera defect; in M5, two audit bypasses, a solo-action loss and Paper contrast.
  - Every finding was reproduced before it was fixed.
- **Machine safety.** Playwright runs went through `scripts/pw-guard.mjs`. It allows at most two browser runs per machine, aborts on macOS security prompts, and waits on low memory or high load. This followed two machine crashes on 11–12 Nov.

## Owner checks and playtests waiting

1. **M0:** goldfish a real deck on the live URL in Chrome and Safari, and judge the feel (drag, snap, tap animation, zoom, hand fan).
2. **M1:**
   - the two-home network check (two machines on different networks; reload one side);
   - a 1v1 playtest;
   - the lost-save recovery check.
3. **M2:** a real core-set draft with a friend, start to finish, plus sealed, Rochester, Winston and Grid.
4. **M3:** a Two-Headed Giant or free-for-all evening with real voice, plus dictation on your own turn.
5. **M4:** an evening in each theme on real hardware, in both camera rigs, judging frame rate and mood.
6. **M5:** an evening on a real iPad in Safari, by touch only: install to the Home Screen, draft, build, play, then the audit. Also:
   - offline resume;
   - update between games;
   - Ctrl to talk;
   - the three-player view;
   - a spectator listening.

Each report's checklist has the details.

## Decisions to review

The full log is `docs/DECISIONS.md`, about 1,200 lines. These are the ones that most need your eye:

1. **Audit limits (M5).**
   - A modified client can move a single card to the top of its library without the audit proving it; everyone's log shows the move.
   - A cheater can mark their own records incomplete and get the neutral "could not be checked".
   - A table closed mid-match is not audited.
   - Winston and Grid pack records are not replayed by any audit (M2).
2. **The sequencer is trusted for order (M1).** Actions are unsigned (DESIGN "Handshake"). The sequencer can mark a peer away and clear their chair before a shuffle commit; the log shows it, but nothing refuses it.
3. **Identity (M1).** A player who clears all site data or switches device cannot reclaim their chair: the key pair is lost with the save. M5's backup file includes the identity as a JWK when tables are exported, which is the workaround.
4. **Solo actions after a reload (M5).** These are lost only if already folded into a stored snapshot, after more than 600 actions alone or in the sequencer's first 6 s after a cut.
5. **Ego framing (M5).** The default ego view is pulled back to keep your piles clear of the HUD. With the log open, your cards are 23% smaller on desktop and 38% smaller on an iPad than at M4.
6. **Grid draft deal (M2).** Each grid is dealt from its own booster; the alternative reading pools the boosters.
7. **On-device speech engine (M3).** It loads transformers.js and the ONNX runtime from jsDelivr at runtime, without integrity checks; the alternative is bundling them as a lazy chunk.
8. **Protocol version 2 (M5).** Players on the old M4 page see a generic "reload" message until they reload.
9. **Still open:**
   - line styles per theme (Stonetable runes, animated Wyrm lines; M4);
   - whether "New draft?" passes on silence (M2);
   - "verified: nothing to check" for a player with no shuffle or draw (M5).

## Hard constraints: how they are kept

- **Static site only.** It is served by GitHub Pages. Peers meet through public WebRTC signalling relays (trystero). There is no server, function, TURN server, account or analytics.
- **No rules enforcement.** The reducer records what players do.
- **Nothing official bundled.** No card data, card images, Wizards logos or official card back ship with the app. The official back is opt-in and loaded from backs.scryfall.io.
- **Card faces are never recoloured, cropped or distorted.** The lit pipeline measures faces against their source.
- **Hidden information** leaves its owner only through the design's reveal paths. A shared leak test covers every path, including the M5 audit publication.
- **Tests never use the network.** Fixtures and placeholder faces only.
