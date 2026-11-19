# Design gaps after M5 (audit of 14 Nov 2026)

After M5, five read-only agents compared `docs/DESIGN.md` section by section against `main` at `57606ce`. Every M0–M5 gate was green, but some features the design names had been left as follow-ups during the build and never picked up. This file lists them.

- **"M6-Pn" means the gap is scheduled in that package** (see PLAN Milestone 6).
- **"kept" means it stays as built, recorded in DECISIONS.**
- **"owner" means it waits for the owner (a decision or a real-world check).**

## Gaps

| # | DESIGN | Gap | Severity | Plan |
| --- | --- | --- | --- | --- |
| 1 | Card manipulation (Attach); Combat (Attachment) | No way to attach a card. `attach`/`detach` exist in the reducer, but no drop, key or menu sends them, and an attacking creature leaves its stacked Auras behind. | high | M6-P1 (tuck, carry, clips: owner decisions) |
| 2 | Table model (command / emblem area) | The command zone is drawn, but nothing can be put into it. | medium | M6-P3 |
| 3 | Other table objects | Generic counter objects (emblem, monarch, initiative, day/night) and text sticky notes have no UI. | medium | M6-P3 |
| 4 | Other table objects | Dice are d6 only. | low–medium | M6-P3 |
| 5 | Placement and piles | No count or summed power/toughness for a selection on the table. | low–medium | M6-P3 |
| 6 | Players and seats | The lobby has no random seat shuffle, and no public random first player. | low | M6-P3 |
| 7 | Combat and annotation | Lines cannot carry a label, and there is no desktop Settle button. | low | M6-P3 |
| 8 | Turn flow | Only life changes merge within 2 s in the log; poison and named counters do not. | low | M6-P3 |
| 9 | Table model | The "teammate's hand visible" setting cannot be changed. | low | M6-P3 |
| 10 | Multiplayer architecture, secrecy | A card failing its commitment is marked `suspect` in state, but nothing shows it. | medium | M6-P4 |
| 11 | Multiplayer architecture; Tech stack | BitTorrent trackers are missing as a second signalling strategy; only Nostr exists. | medium | M6-P4 |
| 12 | Card data, packs | No audit replays pack records, for any format. | low–medium | M6-P4 |
| 13 | Pre-game | A timed draft stalls behind an away drafter. "New draft?" passes on silence and wipes pools. | medium | M6-P4 (consent: owner decision; the away drafter where secrecy allows) |
| 14 | Card data and images | There is no printing chooser per card. | medium | M6-P5 |
| 15 | Pre-game | Search-and-build exists only in the builder reached between games; there is no standalone builder for constructed decks. | medium | M6-P5 |
| 16 | Card data spec | Commander and Companion sections are parsed, then silently dropped. | low–medium | M6-P5 |
| 17 | Input ("every action has three routes") | Touch cannot make a temporary move or a persistent mark. The keyboard cannot draw lines or marks, make temporary moves, attach, or place freely. | medium | M6-P6 |
| 18 | Turn flow | The pass timer can only be changed in the lobby, not mid-game. | medium | M6-P6 |
| 19 | Themes | Line styles per theme are declared but not drawn: ribbons, Wyrm flicker, Stonetable flow and runes, Paper's creation pulse. | low–medium | M6-P7 |
| 20 | Accessibility ("nothing depends on hue alone") | In the lit themes, the line glow fills the dash gaps, so seat lines rely on hue. | medium | M6-P7 |
| 21 | Effect stack | The stack lane overflows into the battlefield from 8 items. In the far-zoom badge an ability shows no source name. | low | M6-P7 |
| 22 | Chat and voice | The "who is typing" indicator and the spectator chat tab are missing. | low | M6-P2 |
| 23 | Camera / LOD | At far zoom, cards carry no seat-colour mark. | low | M6-P7 |
| 24 | Card manipulation | Face-down exile and morph (`hide`) have no UI. A custom counter kind and choosing which counter to remove are missing. | low | M6-P3 |

## Kept as built (recorded in DECISIONS)

- Ego view pulled back to show the piles (owner, M5).
- The three-player shape and 4-player pinwheel corners.
- Ctrl as the talk key (owner, M5).
- Procedural textures instead of downloaded CC0 materials.
- No sound set in Paper and Wyrm.
- Presence on Trystero's reliable channel.
- The ability marker as the whole source card at 0.6×, keeping faces uncropped.
- The pick timer only for pass formats.
- The builder's own gestures.
- Basics printings limited to the pool's sets.
- Lazy card fetch instead of a set preload.
- Camera easing instead of springs.
- `welcome` carrying the handshake signature.
- Unsigned actions with a trusted sequencer (DESIGN "Handshake").

## Waiting for the owner

- **Real-world checks:**
  - frame rate on a real GPU;
  - connectivity between two homes;
  - shuffle latency with four players;
  - speech quality (DESIGN's riskiest-pieces checklist).
- **Decisions:**
  - the Grid deal;
  - a custom domain;
  - whether "verified: nothing to check" should read neutral.
- **Stays a known limit:** the audit cannot prove a single card moved to the top of a library.
