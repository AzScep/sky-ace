# Brief — Living Open-World Sky Ace (soul rework)

_Status: confirmed 2026-07-04. Multi-session. Next: writing-plans._

## Vision

Sky Ace is over-polished and under-designed: gorgeous juice (bloom, shake, tracers,
adaptive music, medals) bolted onto a world with **no stakes, no momentum, and nothing to
react to**. This rework turns it from an empty score-attack sandbox into a **living open
world you actually want to fly around in** — a sky that feels *alive* (air traffic,
wildlife, weather, day/night) and terrain that can finally **kill you** (real crashes, no
combat), so low flying has teeth. First we fix the control that ruins it, then commit the
look, then build the living world around the best of the existing activities.

## Done criteria

- [ ] **Flight holds a turn.** Bank, release, and the plane *keeps* the bank instead of
      snapping level (kill/soften the `rollCorrection = -bankSin*3.0` auto-level spring,
      `plane.js:183`). Tuned live with the user at the stick and approved by hand-feel.
- [ ] **Pitch + throttle feel right** to the user driving (W/S convention; snappier
      throttle/speed response). Live-tuned, user is the grader.
- [ ] **Art direction committed live.** Mock synthwave vs. painterly-realistic on the real
      game; user picks by driving it. (Neon art was dropped in a prior merge — this revisits it.)
- [ ] **The world is visibly alive (atmosphere)** — ambient entities that move and react on
      their own (air traffic / flocks / weather / day-night), not a static stage.
- [ ] **A few emergent activities** the living world triggers give you something to *do*
      between minigame destinations (e.g. buzz/tail traffic, chase a flock, race a storm) —
      directly answering the "nothing to do" complaint, not just scenery. Atmosphere +
      emergent activities + minigame destinations = the three layers of "something to do."
- [ ] **Real crash consequence.** You can hit terrain/obstacles and get reset; the
      soft-floor bailout (`game.js:825`) and its "can't fail" safety net are gone. Nothing
      hunts you in free flight.
- [ ] **Kept minigames are diegetic** — fly up to them and enter, **no teleport-skip**
      (`resultNext`, `game.js:1095`). Flying between things IS the game.
- [ ] **Leveling/unlocks change something the player sees** (the dead `unlocked`/`equipped`
      cosmetic scaffolding in `progression.js` finally does something).
- [ ] **Perf budget honored** — or its test thresholds raised deliberately and noted. Full
      Playwright suite green.

## Feel / references

- **Core vibe:** "a sky that feels alive and worth wandering" — calm low-altitude flow with
  spikes of activity. Ambient life over a to-do-list.
- **Look:** OUTRUN synthwave **vs.** painterly-realistic — **undecided, chosen live** from a
  real mockup. No reference images supplied by user.
- Control feel is a **taste judgment graded by the user's hands**, not by code-reading or
  screenshots. Serve it live; chat feedback is the grade.

## Out of scope

- Full flight-sim energy/stall/lift physics — keep the arcade model, just add crash consequence.
- Roaming enemies that hunt you in free flight — combat stays **bounded inside the Dogfight
  activity** you opt into; the open world itself is non-combat.
- Multiplayer. New engine / bundler / build step (stay **no-build**, importmap + ES modules).
- A monetization / unlock store beyond wiring the cosmetics that already exist.

## Verification

- `npx playwright test` green (thresholds updated deliberately where world density grew).
- **Driven flow** (the real grade): serve the repo, user flies the open world and confirms by
  hand — (1) the plane holds a turn, (2) the world visibly lives, (3) crashing is possible,
  (4) activities are entered by flying, not teleport, (5) the chosen look reads as intentional.

## Resolved crack (2026-07-04)

- **"Living ecosystem" vs. the "nothing to do" complaint.** Resolved: **atmosphere +
  emergent activities + minigame destinations** (three layers). The living world is both
  scenery *and* a trigger for light emergent activities — it must give the player verbs, not
  just motion. Richest scope, accepted knowingly (appetite = rework the soul).

## Deferred / blindspot decisions (chosen risks, resolve during planning)

- **Crash-loop fairness.** No-combat but crashable → where do you respawn, do you lose
  progress/score, is a 5-min explore-then-clip-a-hill fair or rage-inducing? Design the
  failure loop to be *fair* (checkpoint / near respawn / small cost), not punitive.
- **Ecosystem MVP.** Which *one* system sells "alive" for the least work — build that first,
  prove the feel, then layer. Don't build all four (traffic/flocks/weather/day-night) blind.
- **Session shape.** What a session is / why you keep playing — should fall out of the
  activity + progression layer; confirm it actually does.

- **Minigame keep-set.** "Keep the good ones." Recommend: keep **Ring Run**, **Dogfight**
  (opt-in bounded combat), **Canyon Dash** (synergizes with new terrain-can-kill stakes);
  cut or rework **Precision Drop** + **Flux Run**. Confirm at planning.
- **Ecosystem staging:** likely day/night → weather → traffic/wildlife, built incrementally.
- **Perf:** thresholds in `tests/perf.spec.js` will probably rise as entities/shaders grow —
  each raise is noted, not silent. Instancing/LOD/culling discipline required.
- **Regression tests** asserting the soft-floor + world-clamp behavior must be updated when
  crash consequence lands (they currently encode the "can't fail" net we're removing).
- **Progression payoff:** what leveling actually unlocks — decide at planning.

## Deviations

_(append here as reality forces changes: planned → what happened → why)_
