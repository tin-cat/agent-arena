// Entry point. Owns the Matter.js engine, the simulation loop, and the
// glue between physics state, the renderer, and the UI panel.

import * as C from './constants.js';
import { createShip, WORLD_COLLISION } from './ship.js';
import { applyFluidForces, applyMassChanges, updateJoints, TimeMultiplier, clampBodySpeeds } from './physics.js';
import { updateWater } from './water.js';
import { Camera } from './camera.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';

const { Engine, World, Bodies, Composite, Events, Body } = Matter;

const sharedState = {
	paused: false,
	restartRequested: false,
	manualMultiplier: null, // null = automatic
};

const canvas = document.getElementById('canvas');
const renderer = new Renderer(canvas);
const camera = new Camera();
const ui = new UI(sharedState);

let engine, world, ship, timeMult;
let simTimeSec = 0;
let wallTimeSec = 0;
let firstFunnelFell = false;
let funnelsLost = 0;
let totalWaterMass = 0;
let lastTotalWaterMass = 0;
let inflowRateEMA = 0;
let hullBroken = false;
let breakCompartmentLabel = '';
let breakLocationIdx = -1;

initSimulation();
requestAnimationFrame(loop);

function initSimulation() {
	engine = Engine.create();
	engine.gravity.x = 0;
	engine.gravity.y = C.G;
	engine.gravity.scale = 1; // we pass dt in seconds, units = SI.
	// Disable Matter's built-in positionIterations / velocityIterations defaults
	// for stiffer constraints under heavy load.
	engine.positionIterations = 10;
	engine.velocityIterations = 10;
	engine.constraintIterations = 6;
	world = engine.world;
	world.gravity = engine.gravity;

	// Seafloor.
	const floor = Bodies.rectangle(0, C.SEA.depth + 50, 200000, 100, {
		isStatic: true,
		friction: 0.9,
		label: 'seafloor',
		collisionFilter: WORLD_COLLISION,
	});
	Composite.add(world, floor);

	ship = createShip(world);
	timeMult = new TimeMultiplier();

	simTimeSec = 0;
	wallTimeSec = 0;
	totalWaterMass = 0;
	lastTotalWaterMass = 0;
	inflowRateEMA = 0;
	firstFunnelFell = false;
	funnelsLost = 0;
	hullBroken = false;
	breakCompartmentLabel = '';
	breakLocationIdx = -1;
}

let lastFrameMs = performance.now();
function loop(nowMs) {
	requestAnimationFrame(loop);
	const realDt = Math.min(0.05, (nowMs - lastFrameMs) / 1000);
	lastFrameMs = nowMs;

	if (sharedState.restartRequested) {
		// Reset world.
		Engine.clear(engine);
		World.clear(world, false);
		initSimulation();
		sharedState.restartRequested = false;
		ui.btnPP && (sharedState.paused = false);
	}

	if (!sharedState.paused) {
		stepSimulation(realDt);
		wallTimeSec += realDt;
	}

	// Camera and render
	camera.update(ship, renderer.w, renderer.h);
	renderer.draw(ship, camera, simTimeSec, !sharedState.paused);
	ui.update(buildSnapshot());
}

function stepSimulation(realDt) {
	// Choose multiplier source: manual override if set, else dynamic.
	let multiplier;
	if (sharedState.manualMultiplier != null) {
		multiplier = sharedState.manualMultiplier;
	} else {
		multiplier = timeMult.value;
	}

	const simAdvance = realDt * multiplier;
	let remaining = simAdvance;
	const dt = C.PHYSICS_DT;
	let substeps = 0;
	let maxRate = 0;

	while (remaining > 0 && substeps < C.MAX_SUBSTEPS_PER_FRAME) {
		const step = Math.min(dt, remaining);

		// 1. Compute new water masses (Torricelli inflow + overflow).
		const { totalInflowMass } = updateWater(ship, step);
		// 2. Push the new compartment masses into Matter bodies.
		applyMassChanges(ship);
		// 3. Add buoyancy + drag forces (use the updated geometry & mass).
		applyFluidForces(allDynamicBodies(), step);
		// 4. Step the physics.
		Engine.update(engine, step);
		// 4b. Clamp run-away speeds for numerical safety after fragmentation.
		clampBodySpeeds(allDynamicBodies(), step);
		simTimeSec += step;

		// 5. Joint stress + breakage.
		const { broken, maxStrainRate } = updateJoints(ship, world);
		if (maxStrainRate > maxRate) maxRate = maxStrainRate;
		if (broken.length > 0) handleBrokenJoints(broken);

		// 6. Track funnel detachment & water totals.
		trackFunnels();
		trackWater(totalInflowMass, step);

		remaining -= step;
		substeps++;
	}

	// Refresh dynamic multiplier with this frame's peak strain rate.
	timeMult.update(ship, maxRate);
}

function allDynamicBodies() {
	const out = [];
	for (const h of ship.hullSegments) out.push(h.body);
	for (const c of ship.compartments) out.push(c.body);
	for (const f of ship.funnels) out.push(f.body);
	return out;
}

function trackWater(inflowMassThisStep, dt) {
	let sum = 0;
	for (const c of ship.compartments) sum += c.waterMass;
	totalWaterMass = sum;
	// Inflow rate (kg/s), EMA-smoothed for display.
	const rate = inflowMassThisStep / dt;
	inflowRateEMA = inflowRateEMA * 0.95 + rate * 0.05;
}

function trackFunnels() {
	for (const f of ship.funnels) {
		if (f.detached) continue;
		// "Detached" if both of its joints have broken.
		let intact = 0;
		for (const j of ship.joints) {
			if (j.broken) continue;
			if (j.constraint.bodyA === f.body || j.constraint.bodyB === f.body) intact++;
		}
		if (intact === 0) {
			f.detached = true;
			funnelsLost++;
		}
	}
}

function handleBrokenJoints(broken) {
	// Detect the hull break: a top + bottom joint failure at the SAME
	// keel/bulkhead boundary index means the ship has split there.
	if (hullBroken) return;
	// Group remaining joints by anatomical boundary index.
	// Roles: 'keel-top','keel-bot','deck','bulkhead-bot' between compartments i and i+1.
	const boundaryStatus = {};
	for (const j of ship.joints) {
		const role = j.role;
		if (!['keel-top','keel-bot','deck','bulkhead-bot'].includes(role)) continue;
		// Map joint to its boundary index using bodyA's label "...-N" or "...-N-1".
		const a = j.constraint.bodyA;
		const b = j.constraint.bodyB;
		const ia = parseInt((a.label.match(/(\d+)$/) || [])[1]);
		const ib = parseInt((b.label.match(/(\d+)$/) || [])[1]);
		if (isNaN(ia) || isNaN(ib)) continue;
		const idx = Math.min(ia, ib);
		boundaryStatus[idx] = boundaryStatus[idx] || { keelTop:true, keelBot:true, deck:true, bulkBot:true };
		if (j.broken) {
			if (role === 'keel-top') boundaryStatus[idx].keelTop = false;
			if (role === 'keel-bot') boundaryStatus[idx].keelBot = false;
			if (role === 'deck')     boundaryStatus[idx].deck = false;
			if (role === 'bulkhead-bot') boundaryStatus[idx].bulkBot = false;
		}
	}
	for (const idx of Object.keys(boundaryStatus)) {
		const s = boundaryStatus[idx];
		// Fully detached boundary = all 4 main horizontal joints gone.
		const fullyOpen = !s.keelTop && !s.keelBot && !s.deck && !s.bulkBot;
		if (fullyOpen) {
			hullBroken = true;
			breakLocationIdx = parseInt(idx);
			breakCompartmentLabel = `aft of compartment ${breakLocationIdx + 1}`;
			break;
		}
	}
}

function buildSnapshot() {
	// Bow angle: angle of compartment 0 in degrees.
	const bowBody = ship.compartments[0].body;
	const bowAngleDeg = bowBody.angle * 180 / Math.PI;
	const bowDepth = Math.max(0, bowBody.position.y);

	const phase = derivePhase();

	// Count resting fragments (low speed, near seafloor).
	let resting = 0;
	const bodies = allDynamicBodies();
	for (const b of bodies) {
		const s = Math.hypot(b.velocity.x, b.velocity.y);
		if (b.position.y > C.SEA.depth - 8 && s < 0.5) resting++;
	}

	return {
		simTimeSec,
		wallTimeSec,
		multiplier: sharedState.manualMultiplier != null
			? sharedState.manualMultiplier : timeMult.value,
		totalWaterMass,
		inflowRate: inflowRateEMA,
		bowAngleDeg,
		bowDepth,
		hullBroken,
		breakCompartmentLabel,
		funnelsLost,
		restingFragments: resting,
		phase,
	};
}

function derivePhase() {
	// Phase is descriptive only (UI text), derived from physical state.
	// It is NOT used to drive any simulation behavior.
	const c0 = ship.compartments[0].body.position.y;
	const cN = ship.compartments[ship.compartments.length - 1].body.position.y;
	if (!hullBroken) {
		if (c0 < 3 && totalWaterMass < 5e6)   return 'Flooding forward';
		if (c0 < 8)                            return 'Bow settling';
		if (c0 < 18 && cN < 4)                 return 'Bow underwater, stern lifting';
		return 'Stern lifting, hull straining';
	}
	// after break
	if (Math.max(c0, cN) < C.SEA.depth - 50) return 'Hull broken — pieces descending';
	return 'Hull broken — wreck on seafloor';
}
