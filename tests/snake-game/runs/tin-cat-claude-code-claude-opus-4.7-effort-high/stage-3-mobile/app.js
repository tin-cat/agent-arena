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

// --- Canvas setup ----------------------------------------------------------

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const CELL = canvas.width / GRID; // pixels per cell (canvas is square)

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

// --- Game state ------------------------------------------------------------

let snake;          // array of {x, y}; head is the last element
let direction;      // heading applied on the most recent tick
let nextDirection;  // heading queued for the next tick
let apple;          // {x, y}
let score;
let level;
let running;
let timer = null;

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

// Set up a fresh game without starting the loop, and draw the board so it
// sits behind the menu overlay.
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
	placeApple();
	updateHud();
	draw();
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
		const newLevel = levelFor(score);
		if (newLevel !== level) {
			level = newLevel;
			scheduleTick(); // speed up immediately
		}
		updateHud();
		placeApple();
	} else {
		snake.shift();
	}

	draw();
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

function applyMuteUi() {
	muteBtn.textContent = muted ? "🔇" : "🔊";
	muteBtn.setAttribute("aria-pressed", String(muted));
	muteBtn.title = muted ? "Unmute sound" : "Mute sound";
}

function toggleMute() {
	muted = !muted;
	localStorage.setItem(MUTE_KEY, String(muted));
	applyMuteUi();
	if (!muted) resumeAudio();
}

// --- Rendering -------------------------------------------------------------

function draw() {
	// Checkerboard background.
	for (let x = 0; x < GRID; x++) {
		for (let y = 0; y < GRID; y++) {
			ctx.fillStyle = (x + y) % 2 === 0 ? "#19212b" : "#1d2632";
			ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
		}
	}

	// Apple.
	drawCell(apple.x, apple.y, "#e8584f", 0.18);

	// Snake.
	snake.forEach((seg, i) => {
		const isHead = i === snake.length - 1;
		drawCell(seg.x, seg.y, isHead ? "#8bf0ad" : "#5ad17e", 0.12);
	});
}

// Draw a rounded cell, inset slightly so cells read as distinct tiles.
function drawCell(cx, cy, color, insetRatio) {
	const inset = CELL * insetRatio;
	const x = cx * CELL + inset;
	const y = cy * CELL + inset;
	const size = CELL - inset * 2;
	const r = size * 0.25;

	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + size, y, x + size, y + size, r);
	ctx.arcTo(x + size, y + size, x, y + size, r);
	ctx.arcTo(x, y + size, x, y, r);
	ctx.arcTo(x, y, x + size, y, r);
	ctx.closePath();
	ctx.fill();
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

// --- Start -----------------------------------------------------------------

applyMuteUi();
renderLeaderboard(menuScoresEl);
showScreen(menuScreen);
init();         // draw the board behind the menu
overlay.classList.remove("hidden");
