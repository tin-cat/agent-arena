// Water flow simulation:
//   1. Breached compartments draw water in via Torricelli's law using the
//      pressure head between the sea surface and the (rotating) breach point.
//   2. Compartments with water level above the bulkhead spill into their
//      neighbours via the same fluid-mechanics inflow.
// Water is tracked as a scalar mass per compartment; it does not appear as
// a body, only as added mass on the compartment body.

import * as C from './constants.js';

const SEA_Y = 0;  // sea surface y in world coords

// Vertical position of a point in a body's local frame (lx, ly), in world coords.
function localToWorld(body, lx, ly) {
	const s = Math.sin(body.angle), c = Math.cos(body.angle);
	return {
		x: body.position.x + lx * c - ly * s,
		y: body.position.y + lx * s + ly * c,
	};
}

// Convert water mass to ship-local water level (height from compartment bottom).
function waterMassToLevel(comp) {
	if (comp.waterMass <= 0) return 0;
	const T = C.TITANIC;
	const waterVol = comp.waterMass / C.SEA.density;
	// Footprint (in 2D-out-of-plane sense) = width × beam × block coefficient.
	const footprint = comp.width * T.beam * C.HULL_BLOCK_COEFFICIENT;
	return Math.min(comp.height, waterVol / footprint);
}

export function updateWater(ship, dt) {
	let totalInflowMass = 0;
	let totalWaterMass  = 0;

	// --- 1. inflow from outside through breaches --------------------------
	// Pressure at the breach point (gauge, relative to atmosphere):
	//   outside = ρ · g · max(0, depth_of_breach_below_sea)
	//   inside  = ρ · g · (water column standing above the breach inside)
	// Torricelli velocity v = sqrt(2 · ΔP / ρ) = sqrt(2 · g · Δh).
	for (const comp of ship.compartments) {
		if (!comp.breached) { totalWaterMass += comp.waterMass; continue; }

		comp.waterLevel = waterMassToLevel(comp);

		// Breach point in world coords (bottom-mid of the compartment in local).
		const breach = localToWorld(comp.body, 0, comp.height / 2);
		const depthOutside = Math.max(0, breach.y - SEA_Y);

		// Vertical height of the internal water column standing above the breach.
		// In the body's local frame the water surface is at local-y = H/2 - level.
		// Its world position lets us compare against gravity. The "column above
		// the breach" is the projection of the surface-to-breach distance onto
		// the GLOBAL up-axis (so a tilted compartment still gets hydrostatic
		// pressure equal to the vertical height of water inside).
		const surf = localToWorld(comp.body, 0, comp.height / 2 - comp.waterLevel);
		const internalColumn = Math.max(0, breach.y - surf.y);

		const headDiff = depthOutside - internalColumn;

		if (headDiff > 0) {
			const v = Math.sqrt(2 * C.G * headDiff);
			const Q = comp.breachArea * v;
			let inMass = Q * C.SEA.density * dt;
			const remainingCap = (comp.capacity * C.SEA.density) - comp.waterMass;
			if (inMass > remainingCap) inMass = Math.max(0, remainingCap);
			comp.waterMass += inMass;
			totalInflowMass += inMass;
		}
		// We deliberately do NOT model out-flow through the breach: in the real
		// disaster the breach stayed below the waterline throughout (the ship
		// only ever sank further), so once water entered it did not return.
		// Allowing out-flow here lets the system oscillate around a stable
		// equilibrium instead of progressively flooding.
		totalWaterMass += comp.waterMass;
	}

	// --- 2. overflow between adjacent compartments ------------------------
	// Bulkheads run to "bulkheadHeight" above the keel. In compartment local
	// (height-from-bottom) terms the crest is at:
	const crest = C.TITANIC.bulkheadHeight - ship.dimensions.keelHeight;

	for (let i = 0; i < ship.compartments.length - 1; i++) {
		const a = ship.compartments[i];
		const b = ship.compartments[i + 1];
		const la = waterMassToLevel(a);
		const lb = waterMassToLevel(b);
		a.waterLevel = la;
		b.waterLevel = lb;

		const excessA = Math.max(0, la - crest);
		const excessB = Math.max(0, lb - crest);

		// Broad-crested weir Q = C_d · L · sqrt(g) · h^(3/2). The effective L is
		// the narrow notch where water actually spills (real bulkheads + decks
		// only opened a small slot, not the full beam).
		const L = C.BULKHEAD_OVERFLOW_WIDTH;
		const Cd = C.BULKHEAD_OVERFLOW_CD;
		if (excessA > excessB) {
			const h = excessA - excessB;
			const Q = Cd * L * Math.sqrt(C.G) * Math.pow(h, 1.5);
			let flowMass = Q * C.SEA.density * dt;
			if (flowMass > a.waterMass) flowMass = a.waterMass;
			const bCap = (b.capacity * C.SEA.density) - b.waterMass;
			if (flowMass > bCap) flowMass = Math.max(0, bCap);
			a.waterMass -= flowMass;
			b.waterMass += flowMass;
		} else if (excessB > excessA) {
			const h = excessB - excessA;
			const Q = Cd * L * Math.sqrt(C.G) * Math.pow(h, 1.5);
			let flowMass = Q * C.SEA.density * dt;
			if (flowMass > b.waterMass) flowMass = b.waterMass;
			const aCap = (a.capacity * C.SEA.density) - a.waterMass;
			if (flowMass > aCap) flowMass = Math.max(0, aCap);
			b.waterMass -= flowMass;
			a.waterMass += flowMass;
		}
	}

	// Recompute final levels for rendering.
	for (const comp of ship.compartments) comp.waterLevel = waterMassToLevel(comp);

	return { totalInflowMass, totalWaterMass };
}
