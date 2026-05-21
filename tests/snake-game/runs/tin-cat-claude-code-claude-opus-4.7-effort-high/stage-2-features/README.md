# Snake

The classic Snake arcade game as a single-page web app, built with vanilla
HTML, CSS, and JavaScript. No frameworks, no build step, no dependencies.

## Play

Open `index.html` in any modern browser:

```sh
open index.html
```

Or serve the folder over HTTP (handy if your browser restricts `file://`):

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Controls

- **Arrow keys** or **WASD** to steer.
- Pressing the direction opposite your current heading is ignored, so you can
  never reverse into yourself.

## Rules

- The snake moves on a 20x20 grid.
- Eat an apple to grow by one segment and score a point; a new apple then
  appears on a random empty cell.
- The game ends if the snake runs into a wall or into its own body.
- On **Game Over**, your score is shown with a **Play Again** button.

## Features

- **Levels.** Every 5 apples advances a level and speeds the snake up by ~15%,
  down to a floor (reached around level 6). The current level shows in the HUD
  next to the score.
- **Sound.** A soft "bite" blip on eating and a descending "game over" tone,
  synthesized with the Web Audio API (no sound files). The 🔊/🔇 toggle in the
  HUD mutes/unmutes and is remembered across reloads (`localStorage`).
- **Leaderboard.** The top 5 scores are kept in `localStorage` and shown on the
  main menu. If your run cracks the top 5, the Game Over screen prompts for a
  3-letter initial before recording it.

## Files

- `index.html` — page structure (HUD, canvas, menu + game-over overlay).
- `styles.css` — layout and theme.
- `app.js` — game state, loop, rendering, input, sound, and leaderboard.
