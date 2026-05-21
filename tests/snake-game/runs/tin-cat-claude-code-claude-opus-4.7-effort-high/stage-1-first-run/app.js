"use strict";

// --- Configuration ---------------------------------------------------------

const GRID = 20;          // 20 x 20 cells
const TICK_MS = 110;      // movement interval

// --- Canvas setup ----------------------------------------------------------

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const CELL = canvas.width / GRID; // pixels per cell (canvas is square)

const scoreEl = document.getElementById("score");
const finalScoreEl = document.getElementById("final-score");
const overlay = document.getElementById("overlay");
const restartBtn = document.getElementById("restart");

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
let running;
let timer = null;

function reset() {
	const mid = Math.floor(GRID / 2);
	snake = [
		{ x: mid - 1, y: mid },
		{ x: mid,     y: mid },
	];
	direction = "right";
	nextDirection = "right";
	score = 0;
	running = true;
	placeApple();
	updateScore();
	overlay.classList.add("hidden");
	draw();

	clearInterval(timer);
	timer = setInterval(tick, TICK_MS);
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
		updateScore();
		placeApple();
	} else {
		snake.shift();
	}

	draw();
}

function gameOver() {
	running = false;
	clearInterval(timer);
	finalScoreEl.textContent = score;
	overlay.classList.remove("hidden");
}

function updateScore() {
	scoreEl.textContent = score;
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

document.addEventListener("keydown", (e) => {
	const dir = KEY_DIRS[e.key];
	if (!dir) return;

	e.preventDefault(); // stop arrow keys from scrolling the page

	if (!running) return;

	// Reject reversals. Compare against `direction` (the heading from the last
	// tick), not `nextDirection`, so multiple key presses inside a single tick
	// can never chain into a 180-degree turn and an instant self-collision.
	if (dir === OPPOSITE[direction]) return;

	nextDirection = dir;
});

restartBtn.addEventListener("click", reset);

// --- Start -----------------------------------------------------------------

reset();
