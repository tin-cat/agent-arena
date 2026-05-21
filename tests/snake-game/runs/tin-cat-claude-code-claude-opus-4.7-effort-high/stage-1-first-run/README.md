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
- On **Game Over**, your score is shown with a **Restart** button to play again.

## Files

- `index.html` — page structure (HUD, canvas, game-over overlay).
- `styles.css` — layout and theme.
- `app.js` — game state, loop, rendering, and input handling.
