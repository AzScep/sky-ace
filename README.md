# Sky Ace — Open World Flight Simulator

A browser-based 3D flight simulator with four open-world minigames, scoring, and a ranked leaderboard. Built with Three.js (loaded via CDN — no install step).

## Run it

Because the game uses ES modules + an import map, you need to serve the folder over HTTP — opening `index.html` directly with `file://` will not work.

Pick one:

```bash
# Python (already on macOS)
python3 -m http.server 8000

# Or Node
npx serve .
```

Then open <http://localhost:8000> in any modern browser.

## Controls

| Key            | Action                |
|----------------|-----------------------|
| `W` / `S`      | Pitch down / up       |
| `A` / `D`      | Roll left / right     |
| `Q` / `E`      | Yaw left / right      |
| `Shift` / `Ctrl` | Throttle up / down  |
| `Space`        | Boost                 |
| `F`            | Fire / Drop bomb      |
| `C`            | Cycle camera          |
| `R`            | Reset position        |
| `M`            | Mute / unmute sound   |
| `Esc`          | Pause                 |

## Minigames

Fly into the colored beams scattered around the map:

- **Ring Run** (cyan) — Fly through 12 floating rings before time runs out
- **Canyon Dash** (orange) — Low-altitude pylon gates
- **Precision Drop** (red) — Bomb a ground target. 3 bombs, accuracy matters
- **Dogfight** (purple) — Down 4 enemy aces with cannon fire

## Ranking

Each run is graded **D / C / B / A / S / SS** based on score. Top scores per mode (and overall) are saved to `localStorage` and visible from the menu.

## Sound & art

Build 2.0 adds a full audio layer and cinematic menu art, all generated with
[Higgsfield](https://higgsfield.ai):

- **Music** — an epic menu theme and a high-energy action theme (play during missions),
  plus a victory fanfare on the result screen.
- **SFX** — a reactive jet-engine drone (pitch/volume follow throttle + speed),
  cannon fire, explosions, afterburner whoosh, and a ring/gate success chime.
- **Menu key art** — a cinematic fighter-jet backdrop on the start screen.

Audio uses the Web Audio API and unlocks on first interaction (browsers block
autoplay). Toggle it any time with the on-screen speaker button or the `M` key;
the preference is saved to `localStorage`.

Generated assets live in `assets/audio/` and `assets/img/`.

## Files

| File              | Purpose                                          |
|-------------------|--------------------------------------------------|
| `index.html`      | Markup, screens, HUD overlays                   |
| `style.css`       | Aviation-themed UI (Orbitron + Share Tech Mono) |
| `game.js`         | Main loop, screen state, camera, minimap, audio wiring |
| `audio.js`        | Web Audio sound manager (music, SFX, engine, mute) |
| `plane.js`        | Aircraft model + arcade physics + input         |
| `world.js`        | Terrain (value-noise heightmap), sky, mission markers |
| `minigames.js`    | The four minigame classes                       |
| `leaderboard.js`  | localStorage scores + grade thresholds          |
| `assets/`         | Higgsfield-generated audio + menu art            |
