"use strict";

// --- Configuration ---------------------------------------------------------

const GRID = 20;            // 20 x 20 cells
const BASE_TICK_MS = 110;   // movement interval at level 1
const SPEEDUP = 0.85;       // each level shrinks the interval ~15% (faster)
const MIN_TICK_MS = 55;     // speed cap; reached around level 6
const APPLES_PER_LEVEL = 5; // apples needed to advance a level

const LB_KEY = "snake.leaderboard"; // localStorage: top-5 scores
const LB_SIZE = 5;
const MUTE_KEY = "snake.muted";      // localStorage: sound on/off

const FONT = '"Baloo 2", "Comic Sans MS", system-ui, sans-serif';

// --- Canvas setup ----------------------------------------------------------

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = "high";

// CELL, viewSize and dpr are recomputed on every resize so the backing store
// matches the on-screen (CSS) size at full device-pixel density: sprites then
// rasterize crisply at any board size. All gameplay drawing works in CSS
// pixels; `resize()` installs a base transform that scales to device pixels.
let CELL = canvas.width / GRID;
let viewSize = canvas.width;
let dpr = 1;

const scoreEl = document.getElementById("score");
const levelEl = document.getElementById("level");
const finalScoreEl = document.getElementById("final-score");
const finalLevelEl = document.getElementById("final-level");
const overlay = document.getElementById("overlay");
const menuScreen = document.getElementById("screen-menu");
const overScreen = document.getElementById("screen-over");
const menuScoresEl = document.getElementById("menu-scores");
const overScoresEl = document.getElementById("over-scores");
const playBtn = document.getElementById("play");
const restartBtn = document.getElementById("restart");
const muteBtn = document.getElementById("mute");
const initialsForm = document.getElementById("initials-form");
const initialsInput = document.getElementById("initials-input");

// --- Direction vectors -----------------------------------------------------

const DIRS = {
	up:    { x: 0,  y: -1 },
	down:  { x: 0,  y: 1 },
	left:  { x: -1, y: 0 },
	right: { x: 1,  y: 0 },
};

const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

// Clockwise rotation, in degrees, for a sprite authored pointing "up".
const ANGLE = { up: 0, right: 90, down: 180, left: 270 };

// --- Game state ------------------------------------------------------------

let snake;          // array of {x, y}; head is the last element, tail is [0]
let direction;      // heading applied on the most recent tick
let nextDirection;  // heading queued for the next tick
let apple;          // {x, y}
let score;
let level;
let running;
let timer = null;

// Transient canvas effects (driven by the render loop, not game ticks).
let floaters = [];  // rising "+1" marks left when an apple is eaten
let flash = null;   // brief centered "LEVEL n" banner on level-up

// Level rises one step per APPLES_PER_LEVEL apples; level 1 is the first 5.
function levelFor(s) {
	return Math.floor(s / APPLES_PER_LEVEL) + 1;
}

// Interval shrinks ~15% per level, floored at MIN_TICK_MS.
function tickInterval(lvl) {
	return Math.max(MIN_TICK_MS, Math.round(BASE_TICK_MS * SPEEDUP ** (lvl - 1)));
}

function scheduleTick() {
	clearInterval(timer);
	timer = setInterval(tick, tickInterval(level));
}

// Set up a fresh game without starting the loop. The render loop draws the
// board continuously, so it sits (animated) behind the menu overlay.
function init() {
	const mid = Math.floor(GRID / 2);
	snake = [
		{ x: mid - 1, y: mid },
		{ x: mid,     y: mid },
	];
	direction = "right";
	nextDirection = "right";
	score = 0;
	level = 1;
	running = false;
	floaters = [];
	flash = null;
	placeApple();
	updateHud();
}

// Begin (or restart) play from a fresh board.
function start() {
	init();
	running = true;
	overlay.classList.add("hidden");
	resumeAudio(); // the Play click is a user gesture; unlock audio now
	scheduleTick();
}

// Place an apple on a random cell not occupied by the snake.
function placeApple() {
	const free = [];
	for (let x = 0; x < GRID; x++) {
		for (let y = 0; y < GRID; y++) {
			if (!snake.some((s) => s.x === x && s.y === y)) {
				free.push({ x, y });
			}
		}
	}
	// If the board is full the player has effectively won; keep the apple put.
	if (free.length === 0) return;
	apple = free[Math.floor(Math.random() * free.length)];
}

// --- Game loop -------------------------------------------------------------

function tick() {
	if (!running) return;

	direction = nextDirection;
	const head = snake[snake.length - 1];
	const move = DIRS[direction];
	const next = { x: head.x + move.x, y: head.y + move.y };

	// Wall collision.
	if (next.x < 0 || next.x >= GRID || next.y < 0 || next.y >= GRID) {
		return gameOver();
	}

	const eating = next.x === apple.x && next.y === apple.y;

	// Self collision. The tail cell is about to vacate (unless we grow), so it
	// is a legal target when we are not eating.
	const body = eating ? snake : snake.slice(1);
	if (body.some((s) => s.x === next.x && s.y === next.y)) {
		return gameOver();
	}

	snake.push(next);
	if (eating) {
		score++;
		playBite();
		floaters.push({ gx: next.x, gy: next.y, t0: performance.now(), text: "+1" });
		const newLevel = levelFor(score);
		if (newLevel !== level) {
			level = newLevel;
			flash = { text: "LEVEL " + level, t0: performance.now() };
			scheduleTick(); // speed up immediately
		}
		updateHud();
		placeApple();
	} else {
		snake.shift();
	}
}

function gameOver() {
	running = false;
	clearInterval(timer);
	playGameOver();

	finalScoreEl.textContent = score;
	finalLevelEl.textContent = level;

	// Offer to record the score if it cracks the top 5.
	if (qualifies(score)) {
		initialsInput.value = "";
		initialsForm.classList.remove("hidden");
		renderLeaderboard(overScoresEl);
		setTimeout(() => initialsInput.focus(), 0);
	} else {
		initialsForm.classList.add("hidden");
		renderLeaderboard(overScoresEl);
	}

	showScreen(overScreen);
	overlay.classList.remove("hidden");
}

function updateHud() {
	scoreEl.textContent = score;
	levelEl.textContent = level;
}

// Show exactly one overlay screen.
function showScreen(screen) {
	menuScreen.classList.toggle("hidden", screen !== menuScreen);
	overScreen.classList.toggle("hidden", screen !== overScreen);
}

// --- Leaderboard -----------------------------------------------------------

function loadLeaderboard() {
	try {
		const data = JSON.parse(localStorage.getItem(LB_KEY));
		if (Array.isArray(data)) {
			return data
				.filter((e) => e && typeof e.initials === "string" && Number.isFinite(e.score))
				.sort((a, b) => b.score - a.score)
				.slice(0, LB_SIZE);
		}
	} catch {
		// Corrupt or unavailable storage: fall through to an empty board.
	}
	return [];
}

function saveLeaderboard(list) {
	try {
		localStorage.setItem(LB_KEY, JSON.stringify(list.slice(0, LB_SIZE)));
	} catch {
		// Storage may be full or blocked; the in-session board still works.
	}
}

// A score qualifies if it is positive and beats the lowest of a full board.
function qualifies(s) {
	if (s <= 0) return false;
	const list = loadLeaderboard();
	if (list.length < LB_SIZE) return true;
	return s > list[list.length - 1].score;
}

function addScore(initials, s) {
	const list = loadLeaderboard();
	list.push({ initials, score: s });
	list.sort((a, b) => b.score - a.score);
	const trimmed = list.slice(0, LB_SIZE);
	saveLeaderboard(trimmed);
	return trimmed;
}

function renderLeaderboard(el) {
	const list = loadLeaderboard();
	el.innerHTML = "";

	if (list.length === 0) {
		const li = document.createElement("li");
		li.className = "empty";
		li.textContent = "No scores yet";
		el.appendChild(li);
		return;
	}

	list.forEach((entry) => {
		const li = document.createElement("li");
		const name = document.createElement("span");
		name.className = "lb-name";
		name.textContent = entry.initials;
		const val = document.createElement("span");
		val.className = "lb-score";
		val.textContent = entry.score;
		li.append(name, val);
		el.appendChild(li);
	});
}

// --- Sound (Web Audio, synthesized; no asset files) ------------------------

let muted = localStorage.getItem(MUTE_KEY) === "true";
let audioCtx = null;

function resumeAudio() {
	if (muted) return;
	try {
		if (!audioCtx) {
			audioCtx = new (window.AudioContext || window.webkitAudioContext)();
		}
		if (audioCtx.state === "suspended") audioCtx.resume();
	} catch {
		audioCtx = null; // Web Audio unavailable; sounds become no-ops
	}
}

// A short blip whose pitch rises slightly: a soft "bite".
function playBite() {
	const ctx = audioCtx;
	if (muted || !ctx) return;
	const t = ctx.currentTime;
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = "triangle";
	osc.frequency.setValueAtTime(660, t);
	osc.frequency.exponentialRampToValueAtTime(990, t + 0.08);
	gain.gain.setValueAtTime(0.0001, t);
	gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
	gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
	osc.connect(gain).connect(ctx.destination);
	osc.start(t);
	osc.stop(t + 0.13);
}

// A descending tone: "game over".
function playGameOver() {
	const ctx = audioCtx;
	if (muted || !ctx) return;
	const t = ctx.currentTime;
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = "sawtooth";
	osc.frequency.setValueAtTime(440, t);
	osc.frequency.exponentialRampToValueAtTime(110, t + 0.5);
	gain.gain.setValueAtTime(0.0001, t);
	gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
	gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
	osc.connect(gain).connect(ctx.destination);
	osc.start(t);
	osc.stop(t + 0.56);
}

// Speaker icons rendered as inline SVG (no emoji / glyph fonts). `currentColor`
// lets CSS tint them like the rest of the HUD.
const ICON_ON = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden="true">
	<path d="M4 9v6h4l5 5V4L8 9H4z"/>
	<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8 8 0 0 1 0 12"/>
</svg>`;
const ICON_OFF = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden="true">
	<path d="M4 9v6h4l5 5V4L8 9H4z"/>
	<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9l6 6M22 9l-6 6"/>
</svg>`;

function applyMuteUi() {
	muteBtn.innerHTML = muted ? ICON_OFF : ICON_ON;
	muteBtn.setAttribute("aria-pressed", String(muted));
	muteBtn.title = muted ? "Unmute sound" : "Mute sound";
}

function toggleMute() {
	muted = !muted;
	localStorage.setItem(MUTE_KEY, String(muted));
	applyMuteUi();
	if (!muted) resumeAudio();
}

// --- Sprites ---------------------------------------------------------------
//
// Every gameplay graphic is a small, cartoony SVG kept inline (as a data URI)
// rather than a committed asset file. The snake is drawn as a tube whose
// centerline is a stroked path: because the body, corner, head-neck and tail
// all use the same stroke widths and meet flush at the cell edges, the pieces
// join seamlessly into one continuous, outlined snake. All directional sprites
// are authored pointing "up" and rotated at draw time (see ANGLE).

const SNAKE = {
	outline: "#1c6b35",
	body:    "#4ccb6e",
	stripe:  "#7fe39a",
	eye:     "#21303a",
};

// Tube stroke widths (out of a 100-unit cell): a dark outline under the green
// body under a lighter dorsal stripe.
const W_OUT = 84;
const W_BODY = 72;
const W_STRIPE = 26;

function tube(d) {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
		<path d="${d}" fill="none" stroke="${SNAKE.outline}" stroke-width="${W_OUT}" stroke-linecap="butt" stroke-linejoin="round"/>
		<path d="${d}" fill="none" stroke="${SNAKE.body}" stroke-width="${W_BODY}" stroke-linecap="butt" stroke-linejoin="round"/>
		<path d="${d}" fill="none" stroke="${SNAKE.stripe}" stroke-width="${W_STRIPE}" stroke-linecap="butt" stroke-linejoin="round" opacity="0.85"/>
	</svg>`;
}

const SVG = {
	// Background: two grass tiles in a subtle checker, with a few blades.
	grassA: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
		<rect width="100" height="100" fill="#3f8f4f"/>
		<g stroke="#4aa45c" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.85">
			<path d="M22 84 Q19 66 24 54"/>
			<path d="M31 86 Q35 68 41 60"/>
			<path d="M74 82 Q71 64 77 53"/>
		</g>
	</svg>`,
	grassB: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
		<rect width="100" height="100" fill="#379046"/>
		<g stroke="#43a055" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.85">
			<path d="M64 86 Q61 68 66 56"/>
			<path d="M73 84 Q77 66 83 58"/>
			<path d="M20 80 Q17 64 23 53"/>
		</g>
	</svg>`,

	// A glossy cartoon apple with a leaf and stem.
	apple: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
		<defs>
			<radialGradient id="ag" cx="40%" cy="33%" r="75%">
				<stop offset="0" stop-color="#ff8275"/>
				<stop offset="0.5" stop-color="#f0463c"/>
				<stop offset="1" stop-color="#c5281f"/>
			</radialGradient>
		</defs>
		<path d="M50 30 C36 18 18 26 18 47 C18 70 33 90 50 90 C67 90 82 70 82 47 C82 26 64 18 50 30 Z"
			fill="url(#ag)" stroke="#a31f17" stroke-width="3.5"/>
		<path d="M50 31 C51 22 58 15 67 13 C66 23 60 31 50 33 Z" fill="#5fbf57" stroke="#2f8f37" stroke-width="3" stroke-linejoin="round"/>
		<path d="M50 31 C50 22 50 17 51 12" fill="none" stroke="#7a4a2b" stroke-width="5" stroke-linecap="round"/>
		<ellipse cx="38" cy="46" rx="9" ry="14" fill="#fff" opacity="0.45" transform="rotate(-25 38 46)"/>
	</svg>`,

	// Snake pieces. Centerlines run edge-to-edge so neighbours connect flush.
	body: tube("M50 0 L50 100"),                  // straight (vertical)
	corner: tube("M50 0 L50 50 L100 50"),          // bend connecting up + right

	// Tail: tapers to a rounded tip. The base is pushed below the cell edge so
	// its outline stroke is clipped away and the green meets the next piece.
	tail: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
		<path d="M14 112 C16 56 30 24 50 18 C70 24 84 56 86 112 Z"
			fill="${SNAKE.body}" stroke="${SNAKE.outline}" stroke-width="12" stroke-linejoin="round"/>
		<path d="M50 96 C50 60 50 42 50 26" fill="none" stroke="${SNAKE.stripe}" stroke-width="16" stroke-linecap="round" opacity="0.7"/>
	</svg>`,

	// Head: a neck stub (matching the tube) topped with a rounded face. The
	// stub runs off the bottom edge so it connects flush to the next piece.
	head: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
		<path d="M50 112 L50 54" fill="none" stroke="${SNAKE.outline}" stroke-width="${W_OUT}" stroke-linecap="butt"/>
		<path d="M50 112 L50 54" fill="none" stroke="${SNAKE.body}" stroke-width="${W_BODY}" stroke-linecap="butt"/>
		<ellipse cx="50" cy="46" rx="45" ry="42" fill="${SNAKE.body}" stroke="${SNAKE.outline}" stroke-width="9"/>
		<circle cx="40" cy="13" r="3" fill="${SNAKE.outline}"/>
		<circle cx="60" cy="13" r="3" fill="${SNAKE.outline}"/>
		<circle cx="31" cy="40" r="13" fill="#fff" stroke="${SNAKE.outline}" stroke-width="4"/>
		<circle cx="69" cy="40" r="13" fill="#fff" stroke="${SNAKE.outline}" stroke-width="4"/>
		<circle cx="33" cy="36" r="6.5" fill="${SNAKE.eye}"/>
		<circle cx="67" cy="36" r="6.5" fill="${SNAKE.eye}"/>
		<circle cx="30.5" cy="33.5" r="2.4" fill="#fff"/>
		<circle cx="64.5" cy="33.5" r="2.4" fill="#fff"/>
		<path d="M38 64 Q50 72 62 64" fill="none" stroke="${SNAKE.outline}" stroke-width="4" stroke-linecap="round"/>
	</svg>`,

	// Forked tongue, authored growing upward from its base (bottom-center).
	tongue: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 60">
		<path d="M20 60 L20 24" fill="none" stroke="#e23b6e" stroke-width="8" stroke-linecap="round"/>
		<path d="M20 27 L9 6" fill="none" stroke="#e23b6e" stroke-width="6" stroke-linecap="round"/>
		<path d="M20 27 L31 6" fill="none" stroke="#e23b6e" stroke-width="6" stroke-linecap="round"/>
	</svg>`,
};

const IMG = {};        // name -> HTMLImageElement, populated by loadAssets()
let bgCanvas = null;   // pre-rendered checker background (device pixels)

function svgToImage(svg) {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => resolve(img); // never block startup on a bad sprite
		img.src = "data:image/svg+xml," + encodeURIComponent(svg);
	});
}

async function loadAssets() {
	await Promise.all(
		Object.entries(SVG).map(async ([name, svg]) => {
			IMG[name] = await svgToImage(svg);
		})
	);
}

// --- Rendering -------------------------------------------------------------

// Recompute the backing-store resolution to match the on-screen size at the
// device pixel ratio, then install a base transform so all drawing can use CSS
// pixels. Rebuilds the cached background to the new size.
function resize() {
	const rect = canvas.getBoundingClientRect();
	if (!rect.width) return;
	viewSize = rect.width;
	CELL = viewSize / GRID;
	dpr = Math.min(window.devicePixelRatio || 1, 3);
	canvas.width = Math.round(viewSize * dpr);
	canvas.height = Math.round(viewSize * dpr);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	buildBackground();
}

// Render the static grass checker once into an offscreen canvas; the render
// loop then blits it each frame instead of drawing 400 tiles per frame.
function buildBackground() {
	if (!IMG.grassA || !IMG.grassB) return;
	if (!bgCanvas) bgCanvas = document.createElement("canvas");
	bgCanvas.width = canvas.width;
	bgCanvas.height = canvas.height;
	const b = bgCanvas.getContext("2d");
	const cell = CELL * dpr;
	for (let x = 0; x < GRID; x++) {
		for (let y = 0; y < GRID; y++) {
			const img = (x + y) % 2 === 0 ? IMG.grassA : IMG.grassB;
			// Overdraw by a pixel to hide hairline seams at fractional cell sizes.
			b.drawImage(img, Math.floor(x * cell), Math.floor(y * cell), Math.ceil(cell) + 1, Math.ceil(cell) + 1);
		}
	}
}

function cellCenter(seg) {
	return { x: seg.x * CELL + CELL / 2, y: seg.y * CELL + CELL / 2 };
}

// Draw a sprite centered in a cell, rotated `deg` degrees clockwise. `scale`
// grows the sprite past its cell (used for the slightly oversized head).
function drawRot(img, seg, deg, scale = 1) {
	const c = cellCenter(seg);
	const size = CELL * scale;
	ctx.save();
	ctx.translate(c.x, c.y);
	ctx.rotate((deg * Math.PI) / 180);
	ctx.drawImage(img, -size / 2, -size / 2, size, size);
	ctx.restore();
}

// Heading from cell `a` to an adjacent cell `b` (walls prevent wrap, so cells
// are always one step apart).
function dirBetween(a, b) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	if (dx === 1) return "right";
	if (dx === -1) return "left";
	if (dy === 1) return "down";
	if (dy === -1) return "up";
	return null;
}

// Clockwise rotation for the base corner sprite (which connects up + right) so
// its two openings face directions `a` and `b`.
function cornerRot(a, b) {
	const has = (d1, d2) => (a === d1 && b === d2) || (a === d2 && b === d1);
	if (has("up", "right")) return 0;
	if (has("right", "down")) return 90;
	if (has("down", "left")) return 180;
	return 270; // {left, up}
}

// Tongue extension (0..1): a quick flick for a fraction of each ~2.2s cycle.
function tongueExt(ts) {
	const period = 2200;
	const dur = 360;
	const p = ts % period;
	if (p > dur) return 0;
	return Math.sin(Math.PI * (p / dur));
}

function drawTongue(seg, dir, ts) {
	const ext = tongueExt(ts);
	if (ext <= 0) return;
	const c = cellCenter(seg);
	ctx.save();
	ctx.translate(c.x, c.y);
	ctx.rotate((ANGLE[dir] * Math.PI) / 180);
	// "Front" is up (-y). The base sits inside the snout (hidden behind the
	// head, which is drawn next); the fork pokes out the top.
	const w = CELL * 0.36;
	const len = CELL * 0.55 * ext;
	const baseY = -CELL * 0.30;
	ctx.drawImage(IMG.tongue, -w / 2, baseY - len, w, len);
	ctx.restore();
}

function drawApple(ts) {
	if (!apple) return;
	const c = cellCenter(apple);
	// Spin about the vertical axis (scale X by cos), with a gentle bob and rock.
	const spin = Math.cos(ts / 600);
	const sx = (spin < 0 ? -1 : 1) * Math.max(Math.abs(spin), 0.22);
	const bob = Math.sin(ts / 480) * CELL * 0.05;
	const size = CELL * 0.86;
	ctx.save();
	ctx.translate(c.x, c.y + bob);
	ctx.rotate(Math.sin(ts / 700) * 0.12);
	ctx.scale(sx, 1);
	ctx.drawImage(IMG.apple, -size / 2, -size / 2, size, size);
	ctx.restore();
}

function drawSnake(ts) {
	const n = snake.length;
	for (let i = 0; i < n; i++) {
		const seg = snake[i];
		if (i === n - 1) {
			// Head: faces its direction of travel.
			const dir = dirBetween(snake[i - 1], seg) || direction;
			drawTongue(seg, dir, ts); // behind the head
			drawRot(IMG.head, seg, ANGLE[dir], 1.04);
		} else if (i === 0) {
			// Tail: tip points away from its only neighbour.
			const dir = dirBetween(snake[1], seg);
			drawRot(IMG.tail, seg, ANGLE[dir]);
		} else {
			// Body: straight when neighbours are opposite, else a corner.
			const dPrev = dirBetween(seg, snake[i - 1]);
			const dNext = dirBetween(seg, snake[i + 1]);
			if (dPrev === OPPOSITE[dNext]) {
				const deg = dPrev === "up" || dPrev === "down" ? 0 : 90;
				drawRot(IMG.body, seg, deg);
			} else {
				drawRot(IMG.corner, seg, cornerRot(dPrev, dNext));
			}
		}
	}
}

function drawEffects(ts) {
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.lineJoin = "round";

	floaters = floaters.filter((f) => ts - f.t0 < 800);
	for (const f of floaters) {
		const a = (ts - f.t0) / 800;
		const x = f.gx * CELL + CELL / 2;
		const y = f.gy * CELL + CELL / 2 - a * CELL * 1.3;
		ctx.globalAlpha = 1 - a;
		ctx.font = `800 ${CELL * 0.8}px ${FONT}`;
		ctx.lineWidth = CELL * 0.12;
		ctx.strokeStyle = "rgba(18,40,24,0.9)";
		ctx.fillStyle = "#fff7c2";
		ctx.strokeText(f.text, x, y);
		ctx.fillText(f.text, x, y);
	}
	ctx.globalAlpha = 1;

	if (flash) {
		const a = (ts - flash.t0) / 1000;
		if (a >= 1) {
			flash = null;
		} else {
			const sc = 1 + a * 0.4;
			ctx.globalAlpha = 1 - a;
			ctx.font = `800 ${CELL * 1.5 * sc}px ${FONT}`;
			ctx.lineWidth = CELL * 0.18;
			ctx.strokeStyle = "rgba(18,40,24,0.9)";
			ctx.fillStyle = "#ffe66d";
			ctx.strokeText(flash.text, viewSize / 2, viewSize / 2);
			ctx.fillText(flash.text, viewSize / 2, viewSize / 2);
			ctx.globalAlpha = 1;
		}
	}
}

function draw(ts) {
	if (!snake) return;
	// Blit the cached background in device pixels (identity transform)...
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0);
	// ...then switch to a CSS-pixel coordinate system for everything else.
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	drawApple(ts);
	drawSnake(ts);
	drawEffects(ts);
}

function loop(ts) {
	draw(ts);
	requestAnimationFrame(loop);
}

// --- Input -----------------------------------------------------------------

const KEY_DIRS = {
	ArrowUp: "up",    w: "up",    W: "up",
	ArrowDown: "down",  s: "down",  S: "down",
	ArrowLeft: "left",  a: "left",  A: "left",
	ArrowRight: "right", d: "right", D: "right",
};

// Queue a heading for the next tick. Reject reversals by comparing against
// `direction` (the heading from the last tick), not `nextDirection`, so
// multiple inputs inside a single tick can never chain into a 180-degree turn
// and an instant self-collision.
function setDirection(dir) {
	if (!running) return;
	if (dir === OPPOSITE[direction]) return;
	nextDirection = dir;
}

document.addEventListener("keydown", (e) => {
	const dir = KEY_DIRS[e.key];
	if (!dir) return;

	e.preventDefault(); // stop arrow keys from scrolling the page
	setDirection(dir);
});

// --- Touch / swipe controls ------------------------------------------------

// A swipe registers as soon as it travels past this many pixels, so turns feel
// immediate rather than waiting for the finger to lift.
const SWIPE_THRESHOLD = 18;

let touchStartX = 0;
let touchStartY = 0;
let tracking = false;

// Translate the swipe vector into a cardinal heading along its dominant axis.
function swipeToDir(dx, dy) {
	if (Math.abs(dx) > Math.abs(dy)) {
		return dx > 0 ? "right" : "left";
	}
	return dy > 0 ? "down" : "up";
}

// Listen on the canvas; `touch-action: none` (CSS) plus preventDefault here
// stop the page from scrolling, pinch-zooming, or double-tap-zooming while a
// finger is on the board. The menu overlay sits above the canvas, so these
// only fire during play.
canvas.addEventListener("touchstart", (e) => {
	const t = e.changedTouches[0];
	touchStartX = t.clientX;
	touchStartY = t.clientY;
	tracking = true;
	e.preventDefault();
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
	e.preventDefault();
	if (!tracking) return;

	const t = e.changedTouches[0];
	const dx = t.clientX - touchStartX;
	const dy = t.clientY - touchStartY;
	if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;

	setDirection(swipeToDir(dx, dy));

	// Re-anchor to the current point so a single continuous gesture can chain
	// turns (e.g. swipe right, then up without lifting the finger).
	touchStartX = t.clientX;
	touchStartY = t.clientY;
}, { passive: false });

canvas.addEventListener("touchend", (e) => {
	tracking = false;
	e.preventDefault();
}, { passive: false });

playBtn.addEventListener("click", start);
restartBtn.addEventListener("click", start);
muteBtn.addEventListener("click", toggleMute);

// Constrain initials to up to three uppercase letters as the player types.
initialsInput.addEventListener("input", () => {
	initialsInput.value = initialsInput.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
});

initialsForm.addEventListener("submit", (e) => {
	e.preventDefault();
	const initials = initialsInput.value.replace(/[^A-Z]/g, "").slice(0, 3) || "AAA";
	addScore(initials, score);
	initialsForm.classList.add("hidden");
	renderLeaderboard(overScoresEl);
	renderLeaderboard(menuScoresEl);
});

window.addEventListener("resize", resize);
window.addEventListener("orientationchange", resize);
if (window.ResizeObserver) {
	new ResizeObserver(resize).observe(canvas);
}

// --- Start -----------------------------------------------------------------

applyMuteUi();
renderLeaderboard(menuScoresEl);
showScreen(menuScreen);

loadAssets().then(async () => {
	// Make sure the display font is ready before the canvas draws text with it.
	if (document.fonts && document.fonts.load) {
		try {
			await Promise.all([
				document.fonts.load(`800 24px "Baloo 2"`),
				document.fonts.load(`700 24px "Baloo 2"`),
			]);
		} catch {
			// Font unavailable (e.g. offline); the fallback stack still renders.
		}
	}
	init();   // set up the board state
	resize(); // size the canvas and build the background
	overlay.classList.remove("hidden");
	requestAnimationFrame(loop);
});
