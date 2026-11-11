# Test fixtures

Recorded once with `node scripts/record-fixtures.mjs` (the only script that touches the network). Tests read these files and never fetch.

| Path | Content |
| --- | --- |
| `scryfall/m19.json`, `scryfall/tm19.json` | Every Core Set 2019 card and token, trimmed to the fields in docs/DESIGN.md "Specification: card data, packs and draft formats" |
| `scryfall/<set>.json` | About 24 sample cards each of M10–M15, ORI, M20, M21 (every double-faced card included) |
| `mtgjson/<SET>.json` | MTGJSON v5 `data.booster` for the ten target sets, plus `data.cards`: uuid → `{scryfallId, name, colors, rarity, types, number, manaCost}` |
| `decklists/gw-m19-60.txt` | 60-card plain list with a `Sideboard` header (deck A) |
| `decklists/ur-m19-60.mtga.txt` | 60-card MTGA list with set and collector numbers, counterspells and a double-faced card (deck B) |
| `decklists/mixed-40.mtgo.txt` | 40-card list with `2x`, `SB:` lines, a comment and one unresolvable name |

Card data © Wizards of the Coast, provided through Scryfall and MTGJSON; used only as test input, never bundled into the app.
