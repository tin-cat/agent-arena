// UI wiring and the main loop: steps the physics according to the adaptive
// time multiplier and renders every animation frame.

import { createSim } from './sim.js';
import { createRenderer } from './render.js';

window.__booted = true;

const canvas = document.getElementById('scene');
const ui = {
	clock: document.getElementById('clock'),
	date: document.getElementById('date'),
	gSpeed: document.getElementById('gSpeed'),
	gWater: document.getElementById('gWater'),
	gRate: document.getElementById('gRate'),
	gTrim: document.getElementById('gTrim'),
	gDepth: document.getElementById('gDepth'),
	stressFill: document.getElementById('stressFill'),
	stressLoc: document.getElementById('stressLoc'),
	phase: document.getElementById('phase'),
	log: document.getElementById('log'),
	btnPause: document.getElementById('btnPause'),
	btnRestart: document.getElementById('btnRestart'),
	autoSpeed: document.getElementById('autoSpeed'),
	slider: document.getElementById('speedSlider'),
	speedVal: document.getElementById('speedVal'),
	hint: document.getElementById('hint'),
};

let sim, renderer;
let paused = false;
let loggedCount = 0;
let lastTime = performance.now();
let stepBudget = 260;          // adaptive physics steps per frame
let achievedMult = 0;

function resize() {
	canvas.width = window.innerWidth * devicePixelRatio;
	canvas.height = window.innerHeight * devicePixelRatio;
	canvas.style.width = window.innerWidth + 'px';
	canvas.style.height = window.innerHeight + 'px';
}
window.addEventListener('resize', resize);
resize();

function restart() {
	sim = createSim();
	renderer = createRenderer(canvas);
	window.__sim = sim;   // dev/test hook
	loggedCount = 0;
	achievedMult = 0;
	ui.log.innerHTML = '';
	if (!ui.autoSpeed.checked) applyManualSpeed();
}

function applyManualSpeed() {
	const mult = Math.round(10 ** Number(ui.slider.value));
	sim.setSpeedMode('fixed');
	sim.setFixedMultiplier(mult);
	ui.speedVal.textContent = `×${mult}`;
}

ui.btnPause.addEventListener('click', () => {
	paused = !paused;
	ui.btnPause.textContent = paused ? 'Resume' : 'Pause';
});
window.addEventListener('keydown', e => {
	if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
		e.preventDefault();
		ui.btnPause.click();
	}
});
ui.btnRestart.addEventListener('click', restart);
ui.autoSpeed.addEventListener('change', () => {
	ui.slider.disabled = ui.autoSpeed.checked;
	if (ui.autoSpeed.checked) {
		sim.setSpeedMode('auto');
		ui.speedVal.textContent = 'auto';
	} else {
		applyManualSpeed();
	}
});
ui.slider.addEventListener('input', applyManualSpeed);

function phaseText(s) {
	if (s.finished) return 'At rest, 3,784 m down';
	if (s.anyLanded) return 'Settling on the seafloor';
	if (s.hullBroken && s.bowDepth > 60) return 'The long fall to the abyss';
	if (s.hullBroken) return 'Broken in two';
	if (s.maxU > 0.8) return 'The hull is failing';
	if (s.trimDeg > 6) return 'The final plunge';
	if (s.trimDeg > 3.2) return 'Down by the head';
	if (s.waterTons > 6000) return 'Flooding forward';
	return 'Holed by the iceberg';
}

function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }

function updateHud() {
	const s = sim.state;
	ui.clock.textContent = sim.clock(s.time);
	const pastMidnight = s.time >= 20 * 60;
	ui.date.textContent = pastMidnight ? 'Monday, April 15, 1912' : 'Sunday, April 14, 1912';
	const shown = sim.getSpeedMode() === 'fixed'
		? sim.getFixedMultiplier()
		: (achievedMult || s.multiplier);
	ui.gSpeed.textContent = s.finished ? '—' : `×${fmtInt(shown)}`;
	ui.gWater.innerHTML = `${fmtInt(s.waterTons)} <em>t</em>`;
	ui.gRate.innerHTML = `${fmtInt(Math.max(0, s.floodRate * 60))} <em>t/min</em>`;
	const tr = s.trimDeg;
	ui.gTrim.innerHTML = `${Math.abs(tr).toFixed(1)}&deg; <em>${tr > 0.2 ? 'by the head' : tr < -0.2 ? 'by the stern' : 'level'}</em>`;
	ui.gDepth.innerHTML = `${fmtInt(Math.max(0, s.bowDepth))} <em>m</em>`;
	ui.stressFill.style.width = `${Math.round(clamp01(s.maxU) * 100)}%`;
	ui.stressLoc.textContent = s.maxU > 0.45 && !s.hullBroken
		? `greatest at: ${s.maxULabel.toLowerCase()}` : '';
	ui.phase.textContent = phaseText(s);

	while (loggedCount < sim.events.length) {
		const e = sim.events[loggedCount++];
		const div = document.createElement('div');
		div.className = 'entry' + (e.kind === 'break' || e.kind === 'impact' ? ' major' : '');
		div.innerHTML = `<span class="t">${e.clock.slice(0, 5)}</span><span class="x"></span>`;
		div.querySelector('.x').textContent = e.text;
		ui.log.appendChild(div);
		ui.log.scrollTop = ui.log.scrollHeight;
	}
}

function clamp01(v) { return Math.min(Math.max(v, 0), 1); }

function frame(now) {
	const wallDt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;

	if (!paused && !sim.state.finished) {
		const t0 = performance.now();
		const res = sim.advanceWall(wallDt, stepBudget);
		const cost = performance.now() - t0;
		achievedMult = wallDt > 0 ? res.simAdvanced / wallDt : 0;
		// adapt the per-frame step budget toward ~60% of the frame time
		if (cost > 24 && stepBudget > 60) stepBudget = Math.round(stepBudget * 0.85);
		else if (cost < 12 && stepBudget < 700) stepBudget = Math.round(stepBudget * 1.12);
	}

	renderer.render(sim, paused ? 0 : wallDt);
	updateHud();

	if (sim.state.time > 30 && ui.hint.style.opacity !== '0') ui.hint.style.opacity = '0';
	requestAnimationFrame(frame);
}

restart();
requestAnimationFrame(frame);
