// Buoyancy, drag, mass update from flooding, joint stress / breakage,
// and the activity-driven time multiplier.

import * as C from './constants.js';

const { Body, Composite, Vector } = Matter;

// ---------------------------------------------------------------------------
// Submerged-region geometry: clip a body's polygon against the sea surface
// (y = 0, positive y is down). Returns the submerged 2D area + centroid.
// ---------------------------------------------------------------------------
export function submergedAreaAndCentroid(body) {
	const verts = body.vertices;
	const clipped = [];
	const n = verts.length;
	for (let i = 0; i < n; i++) {
		const curr = verts[i];
		const next = verts[(i + 1) % n];
		const currBelow = curr.y >= 0;
		const nextBelow = next.y >= 0;
		if (currBelow) clipped.push(curr);
		if (currBelow !== nextBelow) {
			const dy = next.y - curr.y;
			if (Math.abs(dy) > 1e-9) {
				const t = (0 - curr.y) / dy;
				clipped.push({ x: curr.x + t * (next.x - curr.x), y: 0 });
			}
		}
	}
	if (clipped.length < 3) return { area: 0, cx: body.position.x, cy: body.position.y };
	let A = 0, Cx = 0, Cy = 0;
	for (let i = 0; i < clipped.length; i++) {
		const p1 = clipped[i];
		const p2 = clipped[(i + 1) % clipped.length];
		const cross = p1.x * p2.y - p2.x * p1.y;
		A += cross;
		Cx += (p1.x + p2.x) * cross;
		Cy += (p1.y + p2.y) * cross;
	}
	A *= 0.5;
	if (Math.abs(A) < 1e-9) return { area: 0, cx: body.position.x, cy: body.position.y };
	Cx /= (6 * A);
	Cy /= (6 * A);
	return { area: Math.abs(A), cx: Cx, cy: Cy };
}

// ---------------------------------------------------------------------------
// Apply buoyancy + sea drag to every dynamic body. Called once per substep,
// BEFORE Engine.update so the forces accumulate into body.force / body.torque.
//
// dtSeconds is needed because matter.js stores body.velocity in metres-per-step,
// not metres-per-second. We convert to m/s to compute drag in real Newtons.
// ---------------------------------------------------------------------------
export function applyFluidForces(allBodies, dtSeconds) {
	const invDt = 1 / dtSeconds;
	for (const body of allBodies) {
		if (body.isStatic) continue;
		const { area: subA, cx, cy } = submergedAreaAndCentroid(body);
		if (subA <= 0) continue;

		// Buoyancy = ρ · V · g, V = submerged area · beam · block coefficient.
		const buoy = C.SEA.density * subA * C.TITANIC.beam * C.HULL_BLOCK_COEFFICIENT * C.G;
		Body.applyForce(body, { x: cx, y: cy }, { x: 0, y: -buoy });

		// Quadratic drag opposing velocity, in real units (m/s).
		const v = body.velocity;
		const vxSec = v.x * invDt;
		const vySec = v.y * invDt;
		const speedSecSq = vxSec * vxSec + vySec * vySec;
		if (speedSecSq > 1e-3) {
			const speedSec = Math.sqrt(speedSecSq);
			// Cross-section = (body width perpendicular to motion) × beam,
			// weighted by submerged fraction.
			const bb = body.bounds;
			const bodyW = bb.max.x - bb.min.x;
			const bodyH = bb.max.y - bb.min.y;
			const submergedFrac = subA / Math.max(1e-6, body.area);
			const projW = bodyW * Math.abs(vySec) / speedSec; // horizontal cross when moving vertical
			const projH = bodyH * Math.abs(vxSec) / speedSec; // vertical cross when moving horizontal
			const crossA = (projW + projH) * C.TITANIC.beam * submergedFrac;
			const dragMag = 0.5 * C.SEA.density * C.SEA.dragCoeff * crossA * speedSecSq;
			const fx = -dragMag * vxSec / speedSec;
			const fy = -dragMag * vySec / speedSec;
			Body.applyForce(body, { x: cx, y: cy }, { x: fx, y: fy });

			// Rotational drag (quadratic in angular velocity, real units).
			const omegaSec = body.angularVelocity * invDt;
			const rotDragMag = 0.5 * C.SEA.density * 0.5 * crossA * Math.abs(omegaSec) * omegaSec * (bodyW * bodyW + bodyH * bodyH) * 0.25;
			body.torque -= rotDragMag;
		}
	}
}

// ---------------------------------------------------------------------------
// Update a body's mass to reflect added floodwater. Matter.js's setMass
// rescales inertia automatically using the body's geometry.
// ---------------------------------------------------------------------------
export function applyMassChanges(ship) {
	const T = C.TITANIC;
	const dryMass = T.displacement * 0.70 / T.compartmentCount;
	for (const c of ship.compartments) {
		const newMass = dryMass + c.waterMass;
		if (Math.abs(newMass - c.body.mass) > 50) {
			Body.setMass(c.body, newMass);
		}
	}
}

// ---------------------------------------------------------------------------
// Joint stress measurement + breakage. Each joint's "stress" is the world-
// space distance between its two anchor points; with stiffness < 1 this
// distance grows monotonically with the applied force. Joints break when the
// stress exceeds JOINT_BREAK_STRAIN · (a length scale of the joint's owners).
//
// IMPORTANT: every joint uses the same threshold; we never key on time,
// position-along-ship, or scripted events. The break location & moment
// emerge purely from the strain field set up by mass redistribution.
// ---------------------------------------------------------------------------
export function updateJoints(ship, world) {
	const broken = [];
	let maxStrainRate = 0;
	for (const j of ship.joints) {
		if (j.broken) continue;
		const c = j.constraint;
		const a = c.bodyA, b = c.bodyB;
		const sinA = Math.sin(a.angle), cosA = Math.cos(a.angle);
		const ax = a.position.x + c.pointA.x * cosA - c.pointA.y * sinA;
		const ay = a.position.y + c.pointA.x * sinA + c.pointA.y * cosA;
		const sinB = Math.sin(b.angle), cosB = Math.cos(b.angle);
		const bx = b.position.x + c.pointB.x * cosB - c.pointB.y * sinB;
		const by = b.position.y + c.pointB.x * sinB + c.pointB.y * cosB;
		const dx = ax - bx, dy = ay - by;
		const tensile = Math.sqrt(dx * dx + dy * dy);

		const bend = wrapAngle((b.angle - a.angle) - j.initialAngleDiff);
		const bendAbs = Math.abs(bend);
		// Combined "stress" lets bending and tension contribute to the same
		// failure budget. Both are physical measurements derived from body state.
		const stress = tensile + C.BEND_WEIGHT * bendAbs;

		// EMA-smoothed stress used for the break test; rejects transient ringing.
		j.stressEMA = j.stressEMA * (1 - C.STRESS_EMA) + stress * C.STRESS_EMA;

		const rate = Math.abs(stress - j.lastStress);
		if (rate > maxStrainRate) maxStrainRate = rate;

		j.lastStress = stress;
		if (tensile  > j.peakStress) j.peakStress = tensile;
		if (bendAbs  > j.peakBend)   j.peakBend   = bendAbs;

		// Break if smoothed stress passes the strain threshold OR a hard
		// bend limit is exceeded instantaneously (bend can fail without
		// straining tension, e.g. when a body twists in place).
		if (j.stressEMA > j.breakStrain || bendAbs > j.breakBend) {
			j.broken = true;
			Composite.remove(world, c);
			broken.push(j);
		}
	}
	return { broken, maxStrainRate };
}

function wrapAngle(a) {
	while (a >  Math.PI) a -= 2 * Math.PI;
	while (a < -Math.PI) a += 2 * Math.PI;
	return a;
}

// ---------------------------------------------------------------------------
// Numerical safety: only intervene if a body's state goes NaN or its speed
// exceeds an extremely conservative absolute cap (intended only to catch
// integrator blow-ups, not to limit normal motion).
// ---------------------------------------------------------------------------
export function clampBodySpeeds(bodies, dtSeconds) {
	const maxLinPerStep = C.MAX_LINEAR_SPEED  * dtSeconds;
	const maxAngPerStep = C.MAX_ANGULAR_SPEED * dtSeconds;
	for (const body of bodies) {
		if (body.isStatic) continue;
		const v = body.velocity;
		const vmag = Math.hypot(v.x, v.y);
		if (!Number.isFinite(vmag)) {
			Body.setVelocity(body, { x: 0, y: 0 });
		} else if (vmag > maxLinPerStep) {
			const k = maxLinPerStep / vmag;
			Body.setVelocity(body, { x: v.x * k, y: v.y * k });
		}
		const w = body.angularVelocity;
		if (!Number.isFinite(w)) {
			Body.setAngularVelocity(body, 0);
		} else if (Math.abs(w) > maxAngPerStep) {
			Body.setAngularVelocity(body, Math.sign(w) * maxAngPerStep);
		}
	}
}

// ---------------------------------------------------------------------------
// Time multiplier driven by scene activity. Activity combines:
//   - max body speed (m/s)
//   - max joint strain rate (m / substep)
// The multiplier is mult = MAX / (1 + GAIN · activity), low-pass filtered.
// Calm scene -> high multiplier (fast-forward); violent scene -> low (slow-mo).
// ---------------------------------------------------------------------------
export class TimeMultiplier {
	constructor() {
		this.value = C.MULT_MAX;
		this.target = C.MULT_MAX;
		this.lastMaxStrainRate = 0;
	}
	update(ship, maxStrainRate) {
		// If fixed override is set, hold it constantly (used for fast tests).
		if (typeof C.FIXED_TIME_MULTIPLIER === 'number') {
			this.value = C.FIXED_TIME_MULTIPLIER;
			this.target = C.FIXED_TIME_MULTIPLIER;
			return this.value;
		}

		let maxSpeed = 0;
		const bodies = [
			...ship.hullSegments.map(h => h.body),
			...ship.compartments.map(c => c.body),
			...ship.funnels.map(f => f.body),
		];
		for (const b of bodies) {
			const v = b.velocity;
			const s = Math.hypot(v.x, v.y);
			if (s > maxSpeed) maxSpeed = s;
		}

		// Normalize strain rate to per-second by dividing by typical substep.
		const strainRatePerSec = maxStrainRate / C.PHYSICS_DT;
		const activity = maxSpeed + strainRatePerSec * 0.05;

		const raw = C.MULT_MAX / (1 + C.ACTIVITY_GAIN * activity);
		this.target = Math.max(C.MULT_MIN, Math.min(C.MULT_MAX, raw));

		// First-order low pass; smaller MULT_SMOOTHING = more inertia.
		this.value += (this.target - this.value) * C.MULT_SMOOTHING;
		return this.value;
	}
	setFixed(v) {
		this.fixedOverride = v;
	}
}
