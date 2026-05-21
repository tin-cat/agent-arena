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
- **Swipe** the board in any of the four cardinal directions on a touchscreen.
  A swipe registers the moment it passes a small threshold, so turns feel
  immediate, and you can chain turns within one continuous gesture.
- Pressing (or swiping) the direction opposite your current heading is ignored,
  so you can never reverse into yourself.

## Mobile

- The playfield scales to the largest square that fits the viewport, leaving
  room for the score/level/mute HUD; on landscape phones the HUD stays on
  screen and reachable.
- Touching the board never scrolls or zooms the page.

## Rules

- The snake moves on a 20x20 grid.
- Eat an apple to grow by one segment and score a point; a new apple then
  appears on a random empty cell.
- The game ends if the snake runs into a wall or into its own body.
- On **Game Over**, your score is shown with a **Play Again** button.

## Graphics

- **Sprite-based canvas rendering.** Every gameplay graphic is a cartoony,
  colorful SVG sprite drawn to the canvas: grass-tile background, a glossy
  apple, and the snake's head, body, corner, and tail pieces. The sprites are
  kept inline (as data URIs in `app.js`), so there are still no asset files.
- **Seamless, bending snake.** The body is drawn as a tube whose centerline is
  a stroked path; head, body, corners, and tail share stroke widths and meet
  flush at cell edges, so the snake reads as one continuous, outlined creature
  that bends correctly around every turn. Directional pieces are authored
  pointing "up" and rotated at draw time.
- **Animation.** The apple spins about its vertical axis with a gentle bob, and
  the snake flicks a forked tongue from time to time. A continuous
  `requestAnimationFrame` loop drives the animation independent of the
  movement ticks.
- **Crisp at any size.** The canvas backing store is sized to the device pixel
  ratio on resize, so sprites stay sharp on high-density and scaled displays.
- **Fun typography.** Text (HUD, menus, and the floating "+1" / "Level n"
  callouts drawn on the canvas) uses the rounded **Baloo 2** display font, with
  a graceful fallback when offline. The mute control is an inline SVG icon, not
  an emoji.

## Features

- **Levels.** Every 5 apples advances a level and speeds the snake up by ~15%,
  down to a floor (reached around level 6). The current level shows in the HUD
  next to the score, with a brief "Level n" flash on the board when you advance.
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
