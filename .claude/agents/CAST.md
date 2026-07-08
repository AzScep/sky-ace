# Sky Ace — agent cast

Proposed 2026-07-07 by claude-subagent-creation (discovery lane). Existing agents `flight-sim-gameplay-implementer` and `flight-sim-test-engineer` are kept as-is; this cast fills the non-engineering dimensions around them.

## Existing (kept)

- **flight-sim-gameplay-implementer** — implementer. Owns code edits to game/flight/FX/perf. All specs land here.
- **flight-sim-test-engineer** — QA. Owns `tests/`. Covers the catalog's game-qa-engineer role; no duplicate created.

## Proposed roster

| role | dimension | type | why this project needs it |
| --- | --- | --- | --- |
| ~~flight-sim-gameplay-designer~~ | design | designer/spec | Proposed, declined by user 2026-07-07 — fun/feel authority stays with the user + main conversation for now. |
| flight-sim-art-director | art | reviewer (read-only) | Locked 5-color NEON palette + bloom look is a hard invariant with no taste enforcer; `tests/shots/` gallery exists but nobody judges readability (minimap, HUD, night-phase contrast after the new day/night cycle). |
| flight-sim-level-designer | content/spatial | designer/spec | Open world mid-expansion (living-open-world plans on disk); minigame course placement already burned the project twice (bounds + terrain-height invariants) — spatial decisions need an owner who designs inside `±3600` and `terrainHeight+120` from the start. |
| flight-sim-audio-director | audio | implementer | `audio.js` exists but no agent owns it; audio feedback timing, mix hierarchy, and the mobile AudioContext-unlock trap are unclaimed territory. |
| user-critique | taste | reviewer (read-only) | Mandatory cast member: judges shipped looks/feel against TASTE.md and apex dossiers. |

## Handoff boundaries (ownership map)

- **Specs flow:** gameplay-designer + level-designer write specs → gameplay-implementer edits code → test-engineer proves it → art-director + user-critique judge the result.
- **File ownership (edit rights):** gameplay-implementer: all game source except `audio.js` and `tests/`. audio-director: `audio.js` + the minimal wiring calls in `game.js` (flag any wider `game.js` edit to gameplay-implementer). test-engineer: `tests/` only. Everyone else: read-only.
- **Perf:** stays with gameplay-implementer (its invariant #3) + test-engineer's `perf.spec.js`; no separate optimizer role — revisit only if perf work starts crowding out feature work.
- **Conflict rule:** user specs (TASTE.md, apex) outrank researched best practice; the NEON palette outranks any art-director preference.
